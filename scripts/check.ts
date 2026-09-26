/// Check the index: every record names a file that is downloadable from its
/// release with those bytes, and (with BASE, the pull request's base commit)
/// no published record changes. A record goes only after its file: to take
/// a package down, delete its assets (or its release) first, then remove
/// the records in a pull request.
///
///   [BASE=<commit>] node scripts/check.ts

import { spawnSync } from "node:child_process";
import { fail, readIndexDir, releaseAssets, releaseTag, ROOT, type Record } from "./channel.ts";

const git = (args: string[]) => {
  const result = spawnSync("git", args, { cwd: ROOT, encoding: "utf8" });
  if (result.status !== 0) fail(`git ${args.join(" ")}: ${result.stderr}`);
  return result.stdout;
};
const base = process.env.BASE;
if (base) {
  for (const line of git(["diff", "--name-status", "--no-renames", "--diff-filter=DM", base, "HEAD", "--", "index"]).split("\n").filter(Boolean)) {
    const [status, file] = line.split("\t");
    if (status === "M") fail(`${file}: a published record cannot change`);
    const record: Record = JSON.parse(git(["show", `${base}:${file}`]));
    const name = file.split("/").pop()!.replace(/\.json$/, "");
    if (releaseAssets(releaseTag(record))?.has(name)) fail(`${file}: removed while ${releaseTag(record)} still holds ${name}`);
    console.log(`${file}: removed, its file gone`);
  }
}

const tags = new Map<string, [string, Record][]>();
let count = 0;
for (const [subdir, records] of readIndexDir()) {
  for (const [name, record] of records) {
    if (record.subdir !== subdir) fail(`index/${subdir}/${name}.json: its subdir is ${record.subdir}`);
    if (name !== `${record.name}-${record.version}-${record.build}.conda`) fail(`index/${subdir}/${name}.json: named after another file`);
    const list = tags.get(releaseTag(record)) ?? [];
    list.push([name, record]);
    tags.set(releaseTag(record), list);
    count++;
  }
}
for (const [tag, list] of tags) {
  const assets = releaseAssets(tag);
  for (const [name, record] of list) {
    if (assets?.get(name) !== record.sha256) fail(`${tag}/${name}: not in the release with these bytes`);
  }
}
console.log(`${count} records, ${tags.size} releases: every file is downloadable`);
