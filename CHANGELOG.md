# Changelog

All notable changes to Scrollcase are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] — Unreleased

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
- Workspace discovery via `scrollcase.config.json`, with per-invocation overrides.
- A working example, `examples/hello-box-macos-arm64-metal`, proven end-to-end against a real
  pixi + conda-pack toolchain.
- CI running the test suite on macOS, Linux and Windows.
