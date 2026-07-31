# Examples

## `hello-box`

The smallest thing Scrollcase can build: a stdlib-only Python 3.11 environment from conda-forge,
packed into a relocatable box. No model weights, no assets, nothing to download beyond the
interpreter itself — so it exercises the whole pipeline in about a minute and produces a ~48 MB
archive you can inspect by hand.

The same box is declared for three targets, one per supported operating system. Build the one that
matches the machine you are on; the other two are what the CI builds elsewhere.

| Scroll | conda subdir | Interpreter in the box |
| --- | --- | --- |
| `hello-box/macos-aarch64-metal` | `osx-arm64` | `venv/bin/python` |
| `hello-box/linux-x86_64-cpu` | `linux-64` | `venv/bin/python` |
| `hello-box/windows-x86_64-cpu` | `win-64` | `venv/python.exe` |

Run it from the Scrollcase checkout, using `examples/` as the scrolls root:

```sh
scrollcase lock hello-box/macos-aarch64-metal --scrolls-dir examples
scrollcase keygen
scrollcase build hello-box/macos-aarch64-metal --scrolls-dir examples
scrollcase verify .scrollcase/dist/boxes/hello-box/1.0.0/macos-aarch64-metal/*.release.json --self-test
scrollcase run .scrollcase/dist/boxes/hello-box/1.0.0/macos-aarch64-metal/*.release.json
```

`verify --self-test` extracts the archive and imports `json` and `sqlite3` with the interpreter
*inside the box*, which is the check that matters: it proves the packed environment runs somewhere
other than where it was built. `run` then executes `entrypoint.py` — a stdlib-only script that
prints `sys.prefix`, so you can see for yourself that the interpreter answering is the one from the
box and not the one on your `PATH`.

The committed `pixi.lock` pins the exact packages, so `build` installs rather than resolves and two
builds of the same commit produce byte-identical archives. `platforms` in `pixi.toml` must equal the
target's conda subdirectory — the middle column above — or the solve produces an environment that
cannot run on the machine the box is for.

`entrypoint.py` reaches the payload through `localFiles`, which carries its SHA-256: editing the
script without updating that hash fails the build rather than silently shipping something nobody
reviewed.

That hash is taken over the file's bytes, which is worth knowing on Windows. Git converts line
endings on checkout by default, and a file rewritten to CRLF no longer matches the hash the scroll
declares — the build stops with a mismatch on a checkout that looks perfectly clean. This repository
marks the affected paths in [`.gitattributes`](../.gitattributes); a project declaring its own
`localFiles` needs the same for the files it names.
