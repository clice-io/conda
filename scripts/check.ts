/// Check the index: every record names a file that is downloadable from its
/// release with those bytes, and (with BASE, the pull request's base commit)
/// no published record is changed or removed.
///
///   [BASE=<commit>] node scripts/check.ts

import { spawnSync } from "node:child_process";
import { fail, readIndexDir, releaseAssets, releaseTag, ROOT, type Record } from "./channel.ts";

const base = process.env.BASE;
if (base) {
  const diff = spawnSync("git", ["diff", "--name-status", "--diff-filter=DMR", base, "HEAD", "--", "index"], { cwd: ROOT, encoding: "utf8" });
  if (diff.status !== 0) fail(`git diff: ${diff.stderr}`);
  if (diff.stdout.trim()) fail(`published records cannot change:\n${diff.stdout}`);
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
