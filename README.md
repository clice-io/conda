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

- The packages are assets of one GitHub release per subdir, tagged
  `channel-<subdir>` (`channel-linux-64`, `channel-win-64`, `channel-noarch`,
  ...). Publishing appends to that release.
- `<subdir>/repodata.json` lives on the `gh-pages` branch, served at
  https://conda.clice.io. Its `info.base_url`
  ([CEP-15](https://github.com/conda/ceps/blob/main/cep-0015.md)) points at
  the release of that subdir, so clients read the index from Pages and
  download the packages from GitHub.

A published file name never changes content. Publishing the same name with
different bytes is refused; bump the build number instead. Installs are
reproducible through the sha256 recorded in `pixi.lock`.
