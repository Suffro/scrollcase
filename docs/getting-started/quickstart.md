---
title: Quickstart
description: From an empty directory to a signed, verified box in seven commands.
---

# Quickstart

This walkthrough goes from an empty directory to a signed, verified box on disk. It uses the
example recipe `init` scaffolds — an environment containing nothing but Python — so it runs in
about a minute and produces a ~48 MB archive you can inspect by hand.

Prerequisites: the CLI and toolchain from [Installation](/getting-started/installation).

## 1. Create a project

A box records the commit it was built from, so a Scrollcase project **must be a git checkout** —
building outside one fails rather than inventing a revision.

```sh
mkdir my-boxes && cd my-boxes
git init
```

## 2. Install the CLI

```sh
npm install -g scrollcase
```

Check the install:

```sh
scrollcase help
```

For more details check the [installation page](/getting-started/installation).


## 3. `init` — scaffold the project

```sh
scrollcase init
```

`init` writes three things and never overwrites anything that already exists:

- `scrollcase.config.json` — the [workspace declaration](/reference/configuration): where recipes
  live and where builds, artefacts and keys go.
- `recipes/example-box-<platform>-<arch>-<accelerator>/` — an example
  [recipe](/reference/recipe) (`recipe.json`) and its pixi manifest (`pixi.toml`), targeting this
  machine by default.
- `.gitignore` rules for `.scrollcase/`, the regenerated build state that must never be
  committed.

Then, if `pixi` or `conda-pack` is missing, `init` **asks** whether to install it:

```text
This project needs pixi and conda-pack to build a box.
Install them into /work/my-boxes/.scrollcase/toolchain? [y/N]
```

Answer yes and both land inside the project, with the pixi download checksum-verified, conda-pack
pinned to 0.9.2, and the installed pixi version pinned into the recipe for you. Answer no and
nothing is downloaded — install them yourself as described in
[Installation](/getting-started/installation), and set `pixiVersion` in the recipe by hand. Either
way `init` never downloads anything you did not agree to, which is what makes it safe to re-run.

Use `--install-toolchain` or `--no-install-toolchain` to answer up front in a script.

## 4. `doctor` — check the machine

```sh
scrollcase doctor --recipe example-box-macos-aarch64-metal
```

Every failing check comes with a remedy. Fix what it names and re-run; `doctor` never modifies
anything, so it is always safe.

::: info Recipe names
The recipe name on the command line is the name of its directory under `recipes/` — here
`example-box-macos-aarch64-metal`, assuming an Apple Silicon Mac. Substitute the name `init`
printed on your machine throughout.
:::

## 5. `lock` — resolve dependencies, once

```sh
scrollcase lock example-box-macos-aarch64-metal
```

`lock` runs the pinned pixi against the recipe's `pixi.toml` and writes `pixi.lock` next to it.
This is the only step that resolves anything: `build` later *installs* exactly what the lock
pins, and never resolves. Commit the lock — it is what makes a build reproducible and what the
licence audit reads.

```sh
git add . && git commit -m "Example box recipe and lock"
```

Committing now also matters for the next steps: `build` refuses a dirty tree without
`--allow-dirty`, because an artefact built from uncommitted changes is reproducible by nobody.

## 6. `keygen` — create a signing key

```sh
scrollcase keygen
```

This writes a private ed25519 key (`.scrollcase/keys/signing-private.pem`, owner-only
permissions) and the matching public key file (`signing-public.json`). Every document the build
emits is signed; `verify` checks signatures against the public key file. For production custody —
a KMS, an HSM — see [Signing & Key Custody](/guides/signing-and-custody).

## 7. `build` — install, self-test, archive, sign

```sh
scrollcase build example-box-macos-aarch64-metal
```

The pipeline, in order: install the locked environment, pack and relocate it with conda-pack,
stage declared assets, prune, self-test **with the interpreter inside the box**, normalise
timestamps, zip deterministically, and sign. The result lands in `.scrollcase/dist/`:

```text
.scrollcase/dist/
├── boxes/example-box/1.0.0/macos-aarch64-metal/   # upload this tree as it stands
│   ├── <archive sha256>.zip                       # the box archive
│   └── <document sha256>.release.json             # signed release document
└── channels/example-box/beta/macos-aarch64-metal.json   # signed channel pointer
```

The build prints both paths and what to do with each. Files are named for their own hash because
that is the name they are published under — see [Distributing Boxes](/guides/distributing-boxes).

Rebuilding the same commit produces a byte-identical archive — see
[Architecture](/concepts/architecture#determinism) for what makes that true.

## 8. `verify` — prove what you built

```sh
scrollcase verify .scrollcase/dist/boxes/example-box/1.0.0/macos-aarch64-metal/*.release.json --self-test
```

`verify` mirrors the format checks available to an installing client: trusted signature, archive
size and SHA-256, safe entry names, recursive agreement between `box.json` and the signed release,
and the declared interpreter. With `--self-test` it extracts to a temporary directory and imports
the signed modules **with the box's own Python**. Recipe-only `pythonCode` and file assertions ran
on the builder but are not carried by schema version 1.

## Where to go next

- Package something real: declare model weights and data files —
  [Managing Model Weights](/guides/managing-weights).
- Understand every field you just used: [The Recipe](/reference/recipe) and
  [CLI Commands](/reference/cli).
- Review dependency licences before building: run `scrollcase audit <recipe>` — see
  [CLI Commands](/reference/cli#audit).
- See how the whole pipeline fits together: [Architecture](/concepts/architecture).

The repository also ships a proven example,
[`examples/hello-box-macos-aarch64-metal`](https://github.com/suffro/scrollcase/tree/main/examples),
with a committed lock — the same walkthrough with nothing left to fill in.
