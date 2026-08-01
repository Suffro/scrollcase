# Demo box

A signed `hello-box` for each supported operating system: a stdlib-only Python 3.11 environment,
built by CI from `examples/hello-box/` in this repository. It exists so you can see Scrollcase work
before installing anything beyond the CLI — `verify` and `run` need no pixi, no conda-pack, and no
build.

Download the one archive matching your machine:

| Your machine | Download |
| --- | --- |
| Linux, Intel or AMD | `hello-box-1.0.0-linux-x86_64-cpu.zip` |
| macOS, Apple silicon | `hello-box-1.0.0-macos-aarch64-metal.zip` |
| Windows, Intel or AMD | `hello-box-1.0.0-windows-x86_64-cpu.zip` |

Unpacking it gives a folder that already runs: the box under `box/`, plus `run-box.ts` and
`run_box.py` for driving it from an application instead of the terminal.

```text
scrollcase-demo/
├── box/
│   ├── <archive sha256>.zip           the box — leave it zipped and named as it is
│   └── <document sha256>.release.json
├── run-box.ts
├── run_box.py
└── package.json
```

The trust key is deliberately **not** in that archive. A signature only proves where something came
from if the key does not arrive in the same package, so it is fetched from the repository:

```sh
unzip hello-box-1.0.0-<target>.zip -d scrollcase-demo
cd scrollcase-demo
mkdir keys
curl -o keys/example-signing-public.json \
  https://raw.githubusercontent.com/suffro/scrollcase/main/examples/keys/example-signing-public.json
```

Then any one of these three — they perform the same checks in the same order:

```sh
# Terminal
npm install -g scrollcase
scrollcase verify box/*.release.json --public-key keys/example-signing-public.json
scrollcase run    box/*.release.json --public-key keys/example-signing-public.json

# Node
npm install && npx tsx run-box.ts

# Python
python -m pip install scrollcase-consumer && python run_box.py
```

On PowerShell that glob is not expanded for a command like this — use
`(Get-ChildItem box\*.release.json).FullName`, or simply type the file name you see under `box/`.

`verify` checks the signature, the archive's size and hash, the entry names and the manifest.
Adding `--self-test` extracts the box and imports with the interpreter inside it, and `run` executes
its entry point — both need the machine to match the box's target. `verify` on its own works
anywhere.

The two names under `box/` are SHA-256 digests of their own contents: two builds of the same commit
produce the same names, which is what makes the archive verifiable in the first place. Keep them as
they are and side by side — `verify` finds the box by the hash its release document commits to, and
renaming or separating them breaks that. The enclosing zip carries no guarantee of its own; it holds
the pair and the examples, and its name says which machine they are for.

Full walkthrough: [the demo box guide](https://scrollcase.dev/guides/demo-box).

## About the signing key

These boxes are signed with a key that exists **only for this demo**. It signs nothing else, no
trust chain depends on it, and it is not the key for any Scrollcase release. Treat a signature from
it as evidence that the example is intact — never as evidence that anything else is.
