/// Publish .conda packages: upload each file to its release
/// (`<name>-<version>`, created if need be), then write its record under
/// index/. action.yml commits the records through a pull request that merges
/// itself once check.yml has passed; pages.yml then rebuilds the repodata.
///
///   node scripts/publish.ts <package.conda>...
///
/// A file name, once published, keeps its bytes: publishing it again with
/// other bytes is refused (bump the build number instead), with the same
/// bytes it is a no-op. Every package is checked before anything changes.

import fs from "node:fs";
import path from "node:path";
import { fail, gh, INDEX, readIndexDir, readRecord, releaseAssets, releaseTag, REPO, type Record } from "./channel.ts";

const files = process.argv.slice(2);
if (!files.length) fail("node scripts/publish.ts <package.conda>...");

const index = readIndexDir();
const releases = new Map<string, Map<string, { file: string; record: Record }>>();
for (const file of files) {
  const name = path.basename(file);
  const record = readRecord(file);
  const expected = `${record.name}-${record.version}-${record.build}.conda`;
  if (name !== expected) fail(`${file}: named ${name}, its record says ${expected}`);
  const known = index.get(record.subdir)?.get(name);
  if (known && known.sha256 !== record.sha256) fail(`${record.subdir}/${name}: published with other bytes`);
  const packages = releases.get(releaseTag(record)) ?? new Map();
  const twin = packages.get(name);
  if (twin && twin.record.sha256 !== record.sha256) fail(`${name}: two different files of this name`);
  packages.set(name, { file, record });
  releases.set(releaseTag(record), packages);
}

const existing = new Map<string, Map<string, string> | undefined>();
for (const [tag, packages] of releases) {
  const assets = releaseAssets(tag);
  for (const [name, { record }] of packages) {
    const digest = assets?.get(name);
    if (digest && digest !== record.sha256) fail(`${tag}/${name}: the release holds other bytes`);
  }
  existing.set(tag, assets);
}

/// Files first, records last: the index never names a file that cannot be
/// downloaded yet. The upload host drops connections now and then, so what
/// did not arrive whole is uploaded again.
for (const [tag, packages] of releases) {
  if (!existing.get(tag)) {
    gh(["release", "create", tag, "-R", REPO, "--title", tag, "--notes", `conda packages of ${tag}`]);
  }
  for (let attempt = 1; ; attempt++) {
    const assets = releaseAssets(tag) ?? new Map();
    const pending = [...packages.values()].filter(({ file, record }) => assets.get(path.basename(file)) !== record.sha256);
    if (!pending.length) break;
    if (attempt > 3) fail(`${tag}: upload failed`);
    for (const { file } of pending) {
      if (assets.has(path.basename(file))) gh(["release", "delete-asset", tag, path.basename(file), "-R", REPO, "--yes"]);
    }
    gh(["release", "upload", tag, "-R", REPO, ...pending.map(({ file }) => file)], { allowFailure: true });
  }
  for (const [name, { record }] of packages) {
    const out = path.join(INDEX, record.subdir, `${name}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(sortKeys(record), null, 1) + "\n");
    console.log(`${record.subdir}/${name}: published`);
  }
}

function sortKeys(record: Record): Record {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1))) as Record;
}
