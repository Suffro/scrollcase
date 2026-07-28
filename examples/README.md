# Examples

## `hello-box/macos-aarch64-metal`

The smallest thing Scrollcase can build: a stdlib-only Python 3.11 environment from conda-forge,
packed into a relocatable box. No model weights, no assets, nothing to download beyond the
interpreter itself — so it exercises the whole pipeline in about a minute and produces a ~48 MB
archive you can inspect by hand.

Run it from the Scrollcase checkout, using `examples/` as the scrolls root:

```sh
scrollcase lock hello-box/macos-aarch64-metal --scrolls-dir examples
scrollcase keygen
scrollcase build hello-box/macos-aarch64-metal --scrolls-dir examples
scrollcase verify .scrollcase/dist/boxes/hello-box/1.0.0/macos-aarch64-metal/*.release.json --self-test
```

The last step extracts the archive and imports `json` and `sqlite3` with the interpreter *inside the
box*, which is the check that matters: it proves the packed environment runs somewhere other than
where it was built.

The committed `pixi.lock` pins the exact packages, so `build` installs rather than resolves and two
builds of the same commit produce byte-identical archives. `platforms` in `pixi.toml` must equal the
target's conda subdirectory — `osx-arm64` for a macOS arm64 target — or the solve produces an
environment that cannot run on the machine the box is for.
