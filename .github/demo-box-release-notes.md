# Demo box

A signed `hello-box` for each supported operating system: a stdlib-only Python 3.11 environment,
built by CI from `examples/hello-box/` in this repository. It exists so you can see Scrollcase work
before installing anything beyond the CLI — `verify` and `run` need no pixi, no conda-pack, and no
build.

Download the pair matching your machine, keeping both files in the same directory, plus
[`examples/keys/example-signing-public.json`](../blob/main/examples/keys/example-signing-public.json)
from the repository:

```sh
npm install -g scrollcase
scrollcase verify <sha>.release.json --public-key example-signing-public.json
scrollcase run    <sha>.release.json --public-key example-signing-public.json
```

`verify` checks the signature, the archive's size and hash, the entry names and the manifest.
Adding `--self-test` extracts the box and imports with the interpreter inside it, and `run` executes
its entry point — both need the machine to match the box's target. `verify` on its own works
anywhere.

The file names are SHA-256 digests of their own contents: two builds of the same commit produce the
same names, which is what makes the archive verifiable in the first place.

## About the signing key

These boxes are signed with a key that exists **only for this demo**. It signs nothing else, no
trust chain depends on it, and it is not the key for any Scrollcase release. Treat a signature from
it as evidence that the example is intact — never as evidence that anything else is.
