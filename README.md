
<p align="center">
  <img src="https://scrollcase.dev/static/png/labeled/neutral-colored.png" alt="Scrollcase logo" width="220">
</p>

[**Scrollcase**](https://scrollcase.dev) turns a declarative **scroll** into a **box**: a portable, locked, self-contained
Python environment for one operating system and accelerator, packed so it runs somewhere other
than where it was built, signed so a consumer can prove what they received, and accompanied by a
dependency licence inventory.

It is built on exactly one substrate: [pixi](https://pixi.sh) solves a committed `pixi.lock`
against [conda-forge](https://conda-forge.org), [conda-pack](https://conda.github.io/conda-pack/)
relocates the resulting prefix, and the tree ships inside the box as `venv/`.

> You can find the official documentation [here](https://scrollcase.dev/getting-started/overview).

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
  own interpreter imports the modules the scroll declares.
- **Runnable locally.** `scrollcase run` verifies a caller-supplied local release and archive,
  executes its declared script or module without a shell, forwards signals, preserves the child
  result, and removes the temporary extraction. It does not download or install persistently.
- **Audited.** `audit` derives a licence inventory per package straight from the lock, and a
  dependency without a declared licence fails the parse.
- **Honest about provenance.** A box records the commit it was built from. Building outside a git
  checkout fails rather than inventing a revision; a dirty tree needs `--allow-dirty` and is
  recorded as such in the box itself.

## Requirements

- Node.js ≥ 20 for the CLI.
- For real builds: `pixi` at the version the scroll pins and `conda-pack` 0.9.2. Point Scrollcase
  at them with `--pixi` / `--conda-pack` or `SCROLLCASE_PIXI` /
  `SCROLLCASE_CONDA_PACK` if they are not on `PATH`. `scrollcase doctor` reports exactly what is
  missing and how to install it. `init` offers to install the pinned toolchain into the project and
  downloads nothing without explicit consent.
- Locking, auditing, signing and verifying an existing archive need no toolchain at all.

## Install

```sh
npm install -g scrollcase
scrollcase --version
```

Python applications that only consume existing local boxes do not need the npm package or Node.js:

```sh
python -m pip install scrollcase-consumer
```

The package is imported as `scrollcase_consumer`. It does not build or download boxes.

Otherwise from a checkout:

```sh
git clone https://github.com/suffro/scrollcase.git
cd scrollcase && npm install && npm link
```

## Quickstart

```sh
scrollcase init                     # workspace, runnable example-box, and consumer API examples
scrollcase new scroll               # guided creation of your own target-specific scroll
scrollcase doctor                   # can this machine build?
scrollcase keygen                   # create a local ed25519 signing key
scrollcase lock my-box/macos-aarch64-metal     # resolve the scroll's pixi manifest into pixi.lock
scrollcase audit my-box/macos-aarch64-metal    # licence inventory, derived from the lock
scrollcase build my-box/macos-aarch64-metal    # install, self-test, archive, sign
scrollcase verify .scrollcase/dist/boxes/<box>/<version>/<target>/<sha256>.release.json --self-test
```

The repository ships a working example, `examples/hello-box/macos-aarch64-metal`: a stdlib-only
Python 3.11 environment that exercises the whole pipeline in about a minute and produces a ~48 MB
archive (191 MB on Linux — see [examples/README.md](examples/README.md)). Its final `verify --self-test` extracts the box and imports `json` and `sqlite3` with the
interpreter *inside* it — the check that proves the environment runs somewhere other than where it
was built. See [examples/README.md](examples/README.md).

`init` also writes a concise `SCROLLCASE.md`, plus `consumer-templates/run-box.ts` and
`consumer-templates/run_box.py`. The templates show the external application side of the boundary
by calling `runBox` from `scrollcase/consumer` or `run_box` from the separately installed
`scrollcase-consumer` Python package. The application executed inside the example box is kept
separately at `box-entrypoints/<boxId>/<targetId>/entrypoint.py`.
If the project has no `package.json`, `init` creates a private one with `"type": "module"` for the
TypeScript consumer; an existing file is never changed.
Interactive initialization separately offers to install the templates' Node/TypeScript
dependencies and the Python consumer from PyPI or conda-forge. It collects every answer first and
then performs the approved installations. If conda-forge is selected but Conda is unavailable,
`init` asks whether to continue with PyPI instead.

## Commands

| Command | What it does |
| --- | --- |
| `init` | Initialize a workspace with a disposable runnable example (`--no-example` for none) |
| `new scroll` | Create one guided target-specific scroll |
| `doctor` | Report whether this machine can build a box |
| `keygen` | Create a local ed25519 signing key |
| `lock [<scroll>]` | Resolve the scroll's pixi manifest into `pixi.lock`; omission opens a terminal menu |
| `audit <scroll>` | Dependency licence inventory, derived from the lock |
| `build [<scroll>]` | Build, self-test, archive, and sign a box; omission opens a terminal menu |
| `verify <release.json>` | Verify signature, archive hash, and layout |
| `run <release.json>` | Verify, temporarily extract, and run a local box |

`scrollcase help` documents every option.
`scrollcase -v` and `scrollcase --version` print the installed version without requiring a
workspace.

Projects that consume the box contract directly can import the full Node surface from
`scrollcase/contract`, or its target/document-shape helpers with no Node built-ins from
`scrollcase/contract/browser`. Generated format types remain under `scrollcase/contract/types`.
Local preparation and shell-free execution are available from `scrollcase/consumer`; the typed
Python package under `python/` exposes the same semantics as `scrollcase_consumer`.

## Workspace

Paths come from the project, not from the tool. A `scrollcase.config.json` at the project root —
discovered by walking up from the working directory — declares where scrolls live and where
builds, artefacts and keys go. Defaults are `scrolls/` and `.scrollcase/{build,dist,keys}`, and
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
SHA-256 in the signed release. The caller's distribution layer materializes those files; the
official consumers do not download them and verify their signed size and hash before execution.

## Accelerator parity

A scroll may declare a `parity` block: a check script inside the box, the accelerators to run it
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

The Python consumer lives under `python/`. Its focused verification is:

```sh
python -m pip install -e './python[test]'
cd python
python -m unittest discover -s tests -t .
mypy src
python scripts/sync_schemas.py --check
python -m build
python scripts/check_distribution.py dist/*
```

## License

[Apache-2.0](LICENSE). The licence covers scrollcase's own source code — the contents of the
boxes it builds (interpreters, conda-forge and PyPI dependencies, model source and weights) carry
their own licences, which is what the licence audit shipped inside every box exists to record.
See [NOTICE](NOTICE).
