
<div align="center">
  <a href="https://scrollcase.dev" target="_blank">
    <img src="docs/public/static/svg/logo-color.svg" alt="Scrollcase logo" width="42">
  </a>
  <h1 style="margin-top: -8px;">
    Scrollcase
  </h1>
</div>


[![CI](https://github.com/Suffro/scrollcase/actions/workflows/ci.yml/badge.svg)](https://github.com/Suffro/scrollcase/actions/workflows/ci.yml)

Scrollcase turns a declarative **recipe** into a **box**: a portable, locked, self-contained
Python environment for one operating system and accelerator, packed so it runs somewhere other
than where it was built, signed so a consumer can prove what they received, and accompanied by a
dependency licence inventory.

It is built on exactly one substrate: [pixi](https://pixi.sh) solves a committed `pixi.lock`
against [conda-forge](https://conda-forge.org), [conda-pack](https://conda.github.io/conda-pack/)
relocates the resulting prefix, and the tree ships inside the box as `venv/`.

Find out more [here](https://scrollcase.dev).

## What you get

- **Locked.** The environment is a pure function of a committed `pixi.lock`; `build` installs,
  it never resolves.
- **Deterministic.** Rebuilding the same commit produces a byte-identical archive: timestamps are
  normalised, the build time comes from the commit rather than the clock, and the rollout cohort
  salt is derived rather than random.
- **Relocatable.** The packed tree is repaired so nothing depends on the build machine's paths:
  prefix-carrying service files are removed, symlinks dereferenced, and console scripts rewritten
  to find Python next to themselves.
- **Signed.** Every release is a signed document — with a local ed25519 key out of the box, or
  through any external signer you already trust.
- **Verified.** `verify` mirrors what an installing client does: signature, archive size and
  hash, safe entry names, manifest agreement, and — with `--self-test` — a real extraction whose
  own interpreter imports the modules the recipe declares.
- **Audited.** `audit` derives a licence inventory per package straight from the lock, and a
  dependency without a declared licence fails the parse.
- **Honest about provenance.** A box records the commit it was built from. Building outside a git
  checkout fails rather than inventing a revision; a dirty tree needs `--allow-dirty` and is
  recorded as such in the box itself.

## Requirements

- Node.js ≥ 20 for the CLI.
- For real builds: `pixi` (at the version the recipe pins) and `conda-pack`. Point Scrollcase at
  them with `--pixi` / `--conda-pack` or `SCROLLCASE_PIXI` / `SCROLLCASE_CONDA_PACK` if they are
  not on `PATH`. `scrollcase doctor` reports exactly what is missing and how to install it.
- Locking, auditing, signing and verifying an existing archive need no toolchain at all.

## Install

```sh
npm install -g scrollcase
```

Otherwise from a checkout:

```sh
git clone https://github.com/Suffro/scrollcase.git
cd Scrollcase && npm install && npm link
```

## Quickstart

```sh
scrollcase init                     # scaffold scrollcase.config.json, an example recipe, ignore rules
scrollcase doctor                   # can this machine build?
scrollcase keygen                   # create a local ed25519 signing key
scrollcase lock my-recipe           # resolve the recipe's pixi manifest into pixi.lock
scrollcase audit my-recipe          # licence inventory, derived from the lock
scrollcase build my-recipe          # install, self-test, archive, sign
scrollcase verify .scrollcase/dist/<box>.release.json --self-test
```

The repository ships a working example, `examples/hello-box-macos-arm64-metal`: a stdlib-only
Python 3.11 environment that exercises the whole pipeline in about a minute and produces a ~48 MB
archive. Its final `verify --self-test` extracts the box and imports `json` and `sqlite3` with the
interpreter *inside* it — the check that proves the environment runs somewhere other than where it
was built. See [examples/README.md](examples/README.md).

## Commands

| Command | What it does |
| --- | --- |
| `init` | Scaffold a config, an example recipe, and ignore rules |
| `doctor` | Report whether this machine can build a box |
| `keygen` | Create a local ed25519 signing key |
| `lock <recipe>` | Resolve the recipe's pixi manifest into `pixi.lock` |
| `audit <recipe>` | Dependency licence inventory, derived from the lock |
| `build <recipe>` | Build, self-test, archive, and sign a box |
| `verify <release.json>` | Verify signature, archive hash, and layout |

`scrollcase help` documents every option.

## Workspace

Paths come from the project, not from the tool. A `scrollcase.config.json` at the project root —
discovered by walking up from the working directory — declares where recipes live and where
builds, artefacts and keys go. Defaults are `recipes/` and `.scrollcase/{build,dist,keys}`, and
every path can be overridden per invocation.

## Signing and key custody

The tool signs with a local ed25519 key so anyone gets verifiable boxes without infrastructure.
An operator with real key custody — a KMS, an HSM, a signing service — plugs it in through
`--signer-command`: the command receives the payload on stdin and returns the signed document on
stdout. The returned document must echo back the exact payload it was given and its signature is
verified locally, so a signer that substitutes a payload fails the build.

Document kinds are namespaced (`<namespace>.release`, `.channel`, `.revocations`), defaulting to
`scrollcase.box`. A project with boxes already installed in the field sets `--namespace` to keep
emitting the kinds its clients recognise.

## Model weights

`--weights embed` (the default) packs assets into the archive: the box installs with no network
and works air-gapped. `--weights on-demand` leaves them out and carries their URL, path, size and
SHA-256 in the signed release, so a consumer fetches and verifies them at install time — the
declared hash commits to exactly which bytes the box expects, whatever host serves them.

## Accelerator parity

A recipe may declare a `parity` block: a check script inside the box, the accelerators to run it
under, and tolerances (`absolute`, `relative`, `minimumCosine`). The tool runs the check once per
accelerator, compares every run against the first, and fails the build on a breach. It catches the
failures a packaging tool is responsible for — the wrong wheels solved in, a CPU-only build
shipped as CUDA, a broken BLAS — while the project owns the check script and what closeness means
for its model.

## What Scrollcase is not

Scrollcase stops at a signed, verified box on disk. Uploading to object storage, serving a
registry, promoting or revoking releases, allocating CI runners, and model-specific scientific
validation all belong to whoever consumes the tool. The reasoning behind this boundary — and
every other decision that looks arbitrary — lives in
[docs/concepts/design-decisions.md](docs/concepts/design-decisions.md).

## Development

```sh
npm install
npm test        # vitest; no network, no toolchain required
```

The pipeline tests stub the environment solve, so the suite runs anywhere; everything after the
solve is the real implementation.

## License

[Apache-2.0](LICENSE). The licence covers scrollcase's own source code — the contents of the
boxes it builds (interpreters, conda-forge and PyPI dependencies, model source and weights) carry
their own licences, which is what the licence audit shipped inside every box exists to record.
See [NOTICE](NOTICE).
