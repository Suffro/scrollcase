# Changelog

All notable changes to Scrollcase are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — 2026-07-26

First public release. Scrollcase was extracted from the runtime packaging builder of a private
application and made project-agnostic: paths are declared by the consuming project, document
namespaces are configurable, and the tool carries no consumer's name.

### Added

- The seven CLI verbs: `init`, `doctor`, `keygen`, `lock`, `audit`, `build`, `verify`.
- The box format contract, frozen at `schemaVersion: 1`: the target model and identity rule, the
  signed-document envelope with project-owned namespacing, seven JSON Schemas, and golden
  fixtures other implementations prove themselves against.
- One build substrate — pixi + conda-pack + conda-forge — with the environment solved from a
  committed `pixi.lock` and never resolved at build time.
- Deterministic archives: normalised timestamps, commit-derived build time, derived rollout
  cohort salt; rebuilding the same commit is byte-identical.
- Relocation repair: prefix-carrying service files removed, symlinks dereferenced, console
  scripts rewritten to resolve Python next to themselves; `conda-unpack` deliberately not run.
- Signing with a local ed25519 key, or through an external `--signer-command` whose output must
  echo the exact payload and is verified locally.
- `verify`: signature, archive size and hash, safe entry names, manifest agreement, and
  `--self-test` extraction that imports the declared modules with the box's own interpreter.
- Licence audit derived from `pixi.lock`; a dependency without a declared licence fails.
- Honest provenance: builds refuse to run outside a git checkout, and a dirty tree requires
  `--allow-dirty` and is recorded as `sourceTreeDirty: true`.
- Optional accelerator parity gate with declared tolerances (`absolute`, `relative`,
  `minimumCosine`).
- Asset handling: `--weights embed` (air-gapped, default) or `on-demand` with size and SHA-256
  committed in the signed release.
- Optional toolchain bootstrap: `init` offers to install `pixi` and `conda-pack` into the
  project's own `.scrollcase/toolchain/`, never without an explicit yes (`--install-toolchain` /
  `--no-install-toolchain`, and never at all without a terminal). The release archive is verified
  against its published SHA-256, and the verified digest is recorded in `scrollcase.config.json`
  so later installs are checked against the committed value.
- TypeScript types for the box format, generated from the JSON Schemas and exported as
  `scrollcase/contract/types`. Generated rather than hand-written so they cannot drift from the
  format; `npm run types` regenerates them and the suite fails if the committed output disagrees
  with the schemas. Types only — there is no build step and no runtime change.
- Typed JSDoc across the exported surface, so an editor gives hover documentation and completion
  for `scrollcase/contract`, `scrollcase/build` and `scrollcase/sign` with no types package.
- Workspace discovery via `scrollcase.config.json`, with per-invocation overrides, including the
  `toolchain` path and `--toolchain-dir`. Tool discovery prefers, in order: an explicit flag, the
  environment override, the project's toolchain, then `PATH`.
- A working example, `examples/hello-box-macos-arm64-metal`, proven end-to-end against a real
  pixi + conda-pack toolchain.
- CI running the test suite on macOS, Linux and Windows across Node.js 20, 22 and 24, plus
  independent package-surface, generated-type, audit, and documentation gates.
- The documentation site with clean production URLs, a generated sitemap, local search, Mermaid
  diagrams, and MathJax equation rendering.

### Fixed

- Use the pinned Node TAR implementation when unpacking the conda environment, removing an
  undeclared dependency on the host's `tar` executable.
- Pin managed toolchains to conda-pack 0.9.2 and use locale-independent ordering for every file and
  licence record that can affect deterministic archive bytes.
- Keep generated-type drift checks portable on Windows by running the generator under Node rather
  than through the test transform.
- Pin a newly scaffolded recipe when the requested pixi is already available, and install the
  requested resolver when a different pixi version is present.
- Preserve quoted external-signer arguments, including empty values and paths containing spaces or
  backslashes, while keeping all subprocesses behind the injectable process runner.
- Exercise hostile ZIP/TAR entries, verified and resumed asset downloads, and external-signer
  payload substitution and signature failures with dedicated regressions.
- Update the direct `tar` dependency to 7.5.22.
- Use GitHub's canonical repository URL in npm metadata, documentation, and status links.
