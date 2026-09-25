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
