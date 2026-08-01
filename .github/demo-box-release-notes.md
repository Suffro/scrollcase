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

Unpack it and you get two files: the box and its signed release document. Keep them in a directory of
their own, and take the trust key from the repository rather than from this page — a signature only
proves where something came from if the key does not travel with it:

```sh
npm install -g scrollcase
mkdir scrollcase-demo && cd scrollcase-demo
unzip ../hello-box-1.0.0-<target>.zip -d box
mkdir keys
curl -o keys/example-signing-public.json \
  https://raw.githubusercontent.com/suffro/scrollcase/main/examples/keys/example-signing-public.json

scrollcase verify box/*.release.json --public-key keys/example-signing-public.json
scrollcase run    box/*.release.json --public-key keys/example-signing-public.json
```

On PowerShell that glob is not expanded for a command like this — use
`(Get-ChildItem box\*.release.json).FullName`, or simply type the file name you see after unpacking.

`verify` checks the signature, the archive's size and hash, the entry names and the manifest.
Adding `--self-test` extracts the box and imports with the interpreter inside it, and `run` executes
its entry point — both need the machine to match the box's target. `verify` on its own works
anywhere.

An application would not shell out to the CLI: the same box runs through the Node and Python
consumer libraries, which is covered in the
[demo box guide](https://scrollcase.dev/guides/demo-box).

The two unpacked names are SHA-256 digests of their own contents: two builds of the same commit
produce the same names, which is what makes the archive verifiable in the first place. Keep them as
they are and side by side — `verify` finds the box by the hash its release document commits to, and
renaming or separating them breaks that. The enclosing zip exists only so the download says which
machine it is for.

## About the signing key

These boxes are signed with a key that exists **only for this demo**. It signs nothing else, no
trust chain depends on it, and it is not the key for any Scrollcase release. Treat a signature from
it as evidence that the example is intact — never as evidence that anything else is.
