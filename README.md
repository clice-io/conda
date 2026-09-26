# conda

The conda channel for [clice](https://github.com/clice-io/clice): toolchain
packages we build ourselves and do not publish to conda-forge, starting with
[xclang](https://github.com/clice-io/xclang).

```toml
[workspace]
channels = ["conda-forge", "https://conda.clice.io"]
```

Needs pixi >= 0.40, conda >= 24.5 or mamba >= 2.0.

## How it works

The channel is static files, no server:

- Every version of every package is one GitHub release, tagged
  `<name>-<version>`, holding that version's files for all platforms.
- `<subdir>/repodata.json` lives on the `gh-pages` branch, served at
  https://conda.clice.io. Its `info.base_url`
  ([CEP-15](https://github.com/conda/ceps/blob/main/cep-0015.md)) is
  `https://dl.clice.io/<subdir>/`, a Cloudflare Worker that redirects each
  file to the release holding it.

Lock files record the `dl.clice.io` URL, never the GitHub one, so the files
can move to other storage later without breaking them.

A published file name never changes content. Publishing the same name with
different bytes is refused; bump the build number instead.

## Publishing

A repository publishes its packages with this repository's action and the
organization's `UPLOAD_CONDA` token:

```yaml
- uses: clice-io/conda@main
  with:
    packages: dist/*.conda
    token: ${{ secrets.UPLOAD_CONDA }}
```

Any repository of the organization can publish any number of packages, for
any subdir; every run gets its own pull request, so publishers never wait
on or overwrite each other. The action uploads each file to its release and
commits its repodata record
to `index/<subdir>/<file>.json` through a pull request that merges itself
once `check` has passed: every record must name a file its release holds
with those bytes, and no published record may change. On `main`, `pages`
rebuilds `<subdir>/repodata.json` on gh-pages from `index/`.

To take a package down, delete its files from the release (or the release
itself), then remove their records in a pull request; `check` refuses a
removal while the file is still there.

```
action.yml          the action
scripts/publish.ts  upload and write the records
scripts/check.ts    the check pull requests wait for
scripts/pages.ts    index/ -> <subdir>/repodata.json
index/              one record per published file
```
