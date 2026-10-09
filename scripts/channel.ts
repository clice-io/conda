/// What the scripts share: the channel's layout, reading a package's
/// record out of its file, and GitHub releases through the gh CLI.
///
/// The channel is static files. Every version of every package is one
/// GitHub release of this repository, tagged `<name>-<version>`, holding that
/// version's files for all subdirs. `index/<subdir>/<file>.json` is the
/// repodata record of every file ever published, committed through pull
/// requests; `<subdir>/repodata.json` on gh-pages is built from them, with
/// `info.base_url` (CEP-15) at https://dl.clice.io/<subdir>/, a Cloudflare
/// Worker that redirects each file to its release.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

export const REPO = "clice-io/conda";
export const DOWNLOADS = "https://dl.clice.io";
export const ROOT = path.resolve(import.meta.dirname, "..");
export const INDEX = path.join(ROOT, "index");

export interface Record {
  name: string;
  version: string;
  build: string;
  build_number: number;
  subdir: string;
  sha256: string;
  md5: string;
  size: number;
  [key: string]: unknown;
}

export function fail(message: string): never {
  console.error(`error: ${message}`);
  process.exit(1);
}

/// Must match the Worker, which takes the tag from the file name.
export function releaseTag(record: Record): string {
  return `${record.name}-${record.version}`;
}

/// info/index.json of a .conda: a zip whose info-*.tar.zst member holds it.
function readIndex(file: string): Record {
  if (!file.endsWith(".conda")) fail(`${file}: only .conda packages are published`);
  const zip = fs.readFileSync(file);
  let end = zip.length - 22;
  while (end >= 0 && zip.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) fail(`${file}: not a zip`);
  let entry = zip.readUInt32LE(end + 16);
  for (let i = zip.readUInt16LE(end + 10); i > 0; i--) {
    const nameLength = zip.readUInt16LE(entry + 28);
    const extraLength = zip.readUInt16LE(entry + 30);
    const name = zip.toString("utf8", entry + 46, entry + 46 + nameLength);
    if (name.startsWith("info-") && name.endsWith(".tar.zst")) {
      if (zip.readUInt16LE(entry + 10) !== 0) fail(`${file}: ${name} is compressed in the zip`);
      const [size, local] = sizeAndOffset(zip, entry, zip.subarray(entry + 46 + nameLength, entry + 46 + nameLength + extraLength));
      const data = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      return fromTar(zlib.zstdDecompressSync(zip.subarray(data, data + size)), file);
    }
    entry += 46 + nameLength + extraLength + zip.readUInt16LE(entry + 32);
  }
  fail(`${file}: no info-*.tar.zst`);
}

/// A member's size in the zip and the offset of its local header. rattler-build
/// writes them as zip64 (0xffffffff, the values in the entry's zip64 extra
/// field, 0x0001, which holds the uncompressed size, the compressed size and
/// the offset, each only if its own field is 0xffffffff). A size too large
/// takes the central directory into the zstd input, which fails or not by
/// chance (`Unknown frame descriptor`).
function sizeAndOffset(zip: Buffer, entry: number, extra: Buffer): [number, number] {
  const uncompressed = zip.readUInt32LE(entry + 24);
  let size = zip.readUInt32LE(entry + 20);
  let local = zip.readUInt32LE(entry + 42);
  for (let at = 0; at + 4 <= extra.length; at += 4 + extra.readUInt16LE(at + 2)) {
    if (extra.readUInt16LE(at) !== 0x0001) continue;
    let field = at + 4;
    if (uncompressed === 0xffffffff) field += 8;
    if (size === 0xffffffff) {
      size = Number(extra.readBigUInt64LE(field));
      field += 8;
    }
    if (local === 0xffffffff) local = Number(extra.readBigUInt64LE(field));
  }
  return [size, local];
}

function fromTar(tar: Buffer, file: string): Record {
  for (let at = 0; at + 512 <= tar.length && tar[at] !== 0;) {
    const field = (from: number, length: number) => tar.toString("utf8", at + from, at + from + length).replace(/\0.*$/s, "");
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const size = parseInt(field(124, 12).trim() || "0", 8);
    if (name === "info/index.json") return JSON.parse(tar.toString("utf8", at + 512, at + 512 + size));
    at += 512 + Math.ceil(size / 512) * 512;
  }
  fail(`${file}: no info/index.json`);
}

/// The repodata record of a package file: its index.json, hashes and size.
export function readRecord(file: string): Record {
  const record = readIndex(file);
  const bytes = fs.readFileSync(file);
  record.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  record.md5 = crypto.createHash("md5").update(bytes).digest("hex");
  record.size = bytes.length;
  return record;
}

/// Every published record, subdir -> file name -> record.
export function readIndexDir(): Map<string, Map<string, Record>> {
  const subdirs = new Map<string, Map<string, Record>>();
  if (!fs.existsSync(INDEX)) return subdirs;
  for (const subdir of fs.readdirSync(INDEX)) {
    const records = new Map<string, Record>();
    for (const file of fs.readdirSync(path.join(INDEX, subdir)).filter((f) => f.endsWith(".json"))) {
      records.set(file.slice(0, -".json".length), JSON.parse(fs.readFileSync(path.join(INDEX, subdir, file), "utf8")));
    }
    subdirs.set(subdir, records);
  }
  return subdirs;
}

export function gh(args: string[], options: { allowFailure?: boolean } = {}): { ok: boolean; stdout: string; stderr: string } {
  const result = spawnSync("gh", args, { encoding: "utf8" });
  const ok = result.status === 0;
  if (!ok && !options.allowFailure) fail(`gh ${args.join(" ")}: ${result.stderr}`);
  return { ok, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/// Asset name -> sha256 of a release, or undefined when there is none.
export function releaseAssets(tag: string): Map<string, string> | undefined {
  const result = gh(["release", "view", tag, "-R", REPO, "--json", "assets"], { allowFailure: true });
  if (!result.ok) {
    if (/release not found/.test(result.stderr)) return undefined;
    fail(`gh release view ${tag}: ${result.stderr}`);
  }
  const assets: { name: string; digest?: string }[] = JSON.parse(result.stdout).assets;
  return new Map(assets.map((a) => [a.name, (a.digest ?? "").replace(/^sha256:/, "")]));
}
