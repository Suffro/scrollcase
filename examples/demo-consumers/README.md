# Scrollcase demo box

You unpacked a signed box built by CI from `examples/hello-box/` in the Scrollcase repository. It is
a stdlib-only Python 3.11 environment, and it runs on this machine without pixi, conda-pack, or a
build.

```text
.
├── box/
│   ├── <archive sha256>.zip           the box — leave it zipped and named as it is
│   └── <document sha256>.release.json the signed release document
├── run-box.ts                         run it from Node
├── run_box.py                         run it from Python
└── package.json
```

Both names under `box/` are SHA-256 digests of their own contents. `verify` finds the archive beside
the release document, under the hash that document commits to, so renaming or separating the two
breaks it.

## 1. Get the trust key

It is deliberately not in this archive. A signature only proves where something came from if the key
does not arrive in the same package.

```sh
mkdir keys
curl -o keys/example-signing-public.json \
  https://raw.githubusercontent.com/suffro/scrollcase/main/examples/keys/example-signing-public.json
```

## 2. Run it

Any one of these three. They perform the same checks in the same order.

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

On PowerShell the `box/*.release.json` glob is not expanded for a command like this — use
`(Get-ChildItem box\*.release.json).FullName`, or type the file name you see under `box/`.

`verify` checks the signature, the archive's size and hash, the entry names and the manifest, and
works on any machine. Running the box needs a machine matching its target, because the interpreter
inside it is executed. What it prints is `sys.prefix` — the interpreter answering is the box's own.

## About the signing key

This box is signed with a key that exists **only for this demo**. It signs nothing else, no trust
chain depends on it, and it is not the key for any Scrollcase release. Treat a signature from it as
evidence that the example is intact — never as evidence that anything else is.

Full walkthrough: <https://scrollcase.dev/guides/demo-box>
