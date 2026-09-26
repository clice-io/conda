/// Write `<subdir>/repodata.json` for every subdir, from index/, into a
/// gh-pages checkout. Every subdir a client may ask for gets one, empty or
/// not.
///
///   node scripts/pages.ts <gh-pages checkout>

import fs from "node:fs";
import path from "node:path";
import { DOWNLOADS, fail, readIndexDir } from "./channel.ts";

const SUBDIRS = ["noarch", "linux-64", "linux-aarch64", "osx-64", "osx-arm64", "win-64", "win-arm64"];

const out = process.argv[2];
if (!out) fail("node scripts/pages.ts <gh-pages checkout>");
const index = readIndexDir();
for (const subdir of new Set([...SUBDIRS, ...index.keys()])) {
  const records = index.get(subdir) ?? new Map();
  const repodata = {
    info: { subdir, base_url: `${DOWNLOADS}/${subdir}/` },
    packages: {},
    "packages.conda": Object.fromEntries([...records].sort(([a], [b]) => (a < b ? -1 : 1))),
    repodata_version: 2,
  };
  fs.mkdirSync(path.join(out, subdir), { recursive: true });
  fs.writeFileSync(path.join(out, subdir, "repodata.json"), JSON.stringify(repodata, null, 1) + "\n");
  console.log(`${subdir}: ${records.size} packages`);
}
