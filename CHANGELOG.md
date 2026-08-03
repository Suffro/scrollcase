# Changelog

All notable changes to Scrollcase are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Commit new boxes to their extracted payload through the optional signed `payloadDigest` release
  field and the canonical `payload-digest.v1` list inside the archive. Node and Python share golden
  byte vectors for the list format and 59 language-neutral consumer cases. `schemaVersion` remains
  2 because the field is additive: existing v2 releases still verify normally, while an explicit
  installed-payload check refuses a release that carries no digest rather than claiming success.

  Add `attachExtractedBox` / `attach_extracted_box` so an application can install once, restart, and
  mint a fresh process-bound `PreparedBox` without retaining or re-extracting the archive. Attached
  receipts are marked `attached`, assert the native host, re-check execution files and on-demand
  assets, and deliberately do not claim the payload bytes were proved.

  Add the separate `verifyExtractedPayload` / `verify_extracted_payload` integrity operation and
  `scrollcase verify --extracted <dir>`. Verification walks the authenticated list rather than the
  directory, so later extra files are ignored; embedded assets are read, while on-demand assets keep
  their signed per-file checks. The result detects corruption at that moment, not later mutation or
  a live local attacker, and excludes Python bytecode caches by design.

- Store already-compressed payload paths in the box archive instead of deflating them. Every path a
  scroll declares in `assets` is stored automatically, and the new optional `uncompressedPaths`
  names anything else the project knows to be compressed already — the tree an `assetArchives` entry
  expanded into, a bundled corpus — matching a path itself and everything beneath it.

  Weights arrive compressed, and deflating them again is loss on both sides of the trade: measured
  on incompressible bytes, level 6 runs at 47 MB/s and produces an archive 0.03% *larger* than its
  input, and level 1 recovers 4 MB/s because the search fails either way. Lowering the level is not
  a fix; not compressing is. Nothing opens the file or reads its extension — the decision comes from
  the scroll and the path alone, so a rebuild of the same commit stays byte-identical.

### Changed

- Print `run`'s own status lines on stderr, and say on every run that the extraction is temporary.
  Every other verb owns its standard output; `run` hands stdout to the box, so a caller redirecting
  it into a file was receiving a Scrollcase status line mixed into the application's bytes, with no
  way for the box to tell. The second line states what `run` is — one-shot, deleted on exit — rather
  than leaving a caller to read a repeated multi-gigabyte extraction as the tool being slow. A box
  kept across runs is `verifyAndExtractBox` plus `runExtractedBox` from the library, not this verb.

- Publish the demo box as one plainly named archive per operating system —
  `hello-box-1.0.0-macos-aarch64-metal.zip` and its two siblings — that unpacks to a folder which
  already runs. A box archive has to be named for its own SHA-256 and sit beside its release
  document, because that is how `verify` finds it, so publishing the files flat gave the release
  page six hex names and no way to tell which three belonged to your machine before downloading
  them. The pair now keeps those names under `box/`, where `verify` still resolves one from the
  other, while the name outside says which machine it is for.

  Beside it travel `run-box.ts`, `run_box.py` and a `package.json`, so each of the three ways to run
  a box — CLI, Node consumer, Python consumer — is two commands rather than source to copy out of a
  page and save under the right name. Those files come from `examples/demo-consumers/` and the guide
  embeds them from there, so what is documented and what is shipped cannot drift apart. The trust
  key is deliberately not among them and still comes from the repository: a signature proves nothing
  if the key arrives in the same package as what it signs.

  Stored rather than compressed, since the box archive is already deflated: the container costs
  about 9 KB on a 37 MB box.

### Fixed

- Accept a box whose interpreter is reached through a payload link in the Python consumer, which
  rejected every macOS and Linux box built since 0.6.0 with `Archive is missing venv/bin/python`.
  Carrying links made `venv/bin/python` a link to the versioned binary beside it, and while the
  Python extractor learned that rule, its verifier still asked for the entry point and the execution
  files among regular files only — so `scrollcase_consumer` refused boxes the Node consumer ran, and
  the published demo box could not be run from Python at all. Windows boxes stay link-free and were
  never affected.

  The shared conformance suite had a link case, but only for the rejection it exists to enforce: a
  link climbing out of the payload. Both implementations agreed there and diverged on the accepting
  side, which nothing exercised. `linked-interpreter` now covers it, and cases may declare
  `requiresSymlinks` so a host that cannot create one skips rather than weakening the rule.

- Name the `tar` release a box was actually written with in every target adapter's `archive`
  descriptor. The pin moved to 7.5.22 and the descriptor kept reporting 7.5.20, so a consumer
  reading a box was told about a release that never touched its bytes. The three backend versions
  are now checked against the package's own dependency pins by
  `tests/unit/contract-targets.test.mjs`, so they cannot drift apart again.

## [0.6.0] — 2026-07-31

### Added

- Carry a symbolic link in a box payload when it provably resolves, inside that payload, to a
  regular file. A conda prefix stores every large shared library two or three times through the
  soname convention, and materialising all of it made most of an extracted Linux box duplicates of
  its own bytes: the example box drops from 191 MB to 90 MB archived and 483 MB to 228 MB
  extracted, and on macOS from 48 MB to 36 MB and 126 MB to 94 MB. Windows targets stay link-free,
  because creating a link there needs elevation.

  Directory links are refused outright. They are the only way an entry could be written *through* a
  link and land somewhere its own name does not describe, and refusing them costs one duplicated
  standard library while removing that class of escape entirely. The rule — relative targets only,
  resolved inside the payload, ending at a file, no cycles — lives in `src/contract/links.mjs` with
  a Python mirror, and is applied by the builder, by the archive writer, and again by each consumer
  against the archive as received. No consumer trusts the builder.

  `schemaVersion` is unchanged: the signed document is identical, and a consumer that predates this
  rejects a link entry with a clear error rather than misreading it.

- Publish a signed demo box for Linux, macOS and Windows from a manually triggered workflow, so a
  newcomer can verify and run a real box with nothing installed but the CLI. Building needs a
  toolchain; consuming never did, and until now nothing made that visible. The boxes are signed by
  CI with a key scoped to the example alone — a Linux or Windows box cannot be built on a macOS
  machine, since conda-pack packs the host's own environment.

## [0.5.0] — 2026-07-31

### Added

- Ship the `hello-box` example for all three supported operating systems —
  `linux-x86_64-cpu` and `windows-x86_64-cpu` alongside the existing
  `macos-aarch64-metal` — each with its own solved `pixi.lock` and lock-derived licence
  inventory. Previously only a macOS ARM target could be built from a checkout.
- Give every `hello-box` example a `python-script` entry point, carried into the payload
  through `localFiles` with its declared hash, so `scrollcase run` is exercised by the shipped
  example rather than only documented. The script prints `sys.prefix`, which is where a reader
  can see that the answering interpreter is the one inside the box.
- Build the example for real on Linux, macOS and Windows in CI, then self-test it, run its
  entry point, and rebuild it to confirm the archive is byte-identical. The unit suite stubs
  the environment solve, so this is the only check covering the solve, relocation and the
  per-platform interpreter layouts.

### Changed

- **Breaking (next major):** adopt the v2-only contract and canonical **scroll** authoring model.
  The declarative source becomes `scroll.json` under `scrolls/`; v2 does not accept v1 documents,
  legacy input aliases, or dual code paths. Existing v1 boxes remain historical artefacts for the
  Scrollcase versions that produced them.
- Add the typed Node/TypeScript consumer at `scrollcase/consumer`: it verifies signed local
  releases, safely extracts into collision-free destinations, returns opaque prepared receipts,
  executes script/module entry points without a shell, verifies caller-materialized on-demand
  assets, forwards termination signals, and guarantees one-shot temporary cleanup. Distribution,
  download, update, registry, channel, revocation, publication, runner, and application-lifecycle
  responsibilities remain out of scope.
- Add the typed Python consumer package imported as `scrollcase_consumer`, mirroring local
  verification, collision-free safe ZIP extraction, immutable prepared receipts, script/module
  execution, on-demand asset checks, signal forwarding, child terminal results, and one-shot
  cleanup without a Node runtime dependency. The distribution bundles generated, drift-checked
  copies of the canonical schemas, uses maintained `cryptography` Ed25519 verification, and is
  released independently to PyPI as `scrollcase-consumer`.
- Hold the Node and Python consumers to one language-neutral conformance matrix covering trust,
  tampering, hostile archives, execution, streams, signals, cleanup, on-demand assets, and all
  supported interpreter layouts. ZIP path collisions are now rejected during inspection in both
  implementations, before extraction writes any bytes.
- Add `scrollcase run <release.json> [--archive <box.zip>] -- [application args]` as a thin
  terminal wrapper over `runBox`. It displays signed box identity, preserves argument strings and
  child exit status without a shell, forwards termination signals, and removes its temporary
  extraction on every terminal path. It never downloads or persistently installs a box.
- Improve human CLI readability with restrained, TTY-aware coloured status symbols across setup,
  diagnostics, locking, auditing, and building. Successful builds now end with one relative-path
  summary naming the box directory and channel document that must be distributed.
- Add workspace-independent `scrollcase -v` and `scrollcase --version` flags that print the
  installed package version.
- Check signing readiness before `build` starts expensive work. Missing local keys fail immediately
  with an explicit `scrollcase keygen` remedy; `build` never generates identity material itself.
  Incomplete pairs and missing external-signer trust keys also fail without overwriting anything.
- Present target, weights, and suggested channel choices as navigable arrow-key menus. Channel
  choices are closed to `nightly`, `beta`, and `stable`, with `beta` remaining the build default.
- Keep real authoring separate while restoring a useful first-run example. `scrollcase init` now
  creates a disposable runnable `example-box` for the native host by default, without overwriting
  existing files, a concise linked `SCROLLCASE.md`, and TypeScript/Python examples under
  `consumer-templates/` that run a caller-supplied local release through the public APIs. When the
  project has none, it also creates a private `package.json` with `"type": "module"` so the
  TypeScript consumer runs with ESM semantics;
  the Python template and workspace guide explain the separate PyPI installation explicitly.
  When those templates are generated, interactive initialization separately offers to install
  their Node/TypeScript dependencies or the Python consumer from PyPI or conda-forge. It collects
  every answer before starting any installer and visually separates each question. A PEP 668
  managed Python falls back to a user-scoped pip installation, leaving the managed prefix intact.
  If conda-forge is selected without Conda installed, `init` asks whether to use PyPI instead.
  `--no-example` omits the box and consumer examples while retaining the workspace guide.
  `scrollcase new scroll` still gathers complete project metadata interactively or from explicit
  non-terminal flags. Generated application starters are grouped under
  `box-entrypoints/<boxId>/<targetId>/entrypoint.py`.
- Organise new scrolls as `scrolls/<boxId>/<targetId>/`, validating both path components against
  the scroll's declared `boxId` and canonical target. `scrollId` is now optional input and is
  derived as `<boxId>-<targetId>` for release provenance; the flat v1 layout is rejected.
- Let `lock`, `audit`, `build`, and scroll-aware `doctor` select a nested target through
  `<boxId>/<targetId>`, `--target`, or a navigable keyboard menu. A sole host target is the default,
  and Metal is preferred on macOS; other non-terminal ambiguities fail with an explicit `--target`
  remedy. `new scroll` uses the target menu; the fixed init example deterministically selects Metal
  on Apple Silicon and CPU on Linux or Windows.
- Let interactive `scrollcase lock` and `scrollcase build` calls omit the scroll argument and choose
  from every valid `<boxId>/<targetId>` in the workspace. Non-interactive callers still fail unless
  they name the scroll explicitly.
- Publish one editor-oriented v2 execution schema and reference it from scroll, signed release, and
  `box.json`. Generated scrolls self-associate through `$schema`; the schema supplies closed
  script/module alternatives, target conditionals, defaults, examples, safe paths, and strict
  SHA-256 shapes without an editor extension.
- Carry optional shell-free execution metadata through the deterministic builder into both signed
  manifests. Script files and dotted modules must be present in the final payload after staging and
  pruning; `verify` checks their schema, recursive manifest agreement, interpreter layout, and
  archive presence before any optional self-test can execute box code.
- Complete the repository-wide v2 migration across public guides, examples, CLI references,
  package API documentation, generated schema routes, and contributor instructions. Documentation
  now distinguishes caller-owned retrieval from consumer verification, uses content-addressed
  output names, and a tracked-tree guard prevents the retired product terminology from returning.

### Fixed

- Stop Git's line-ending conversion from breaking a `localFiles` hash. The declared SHA-256 covers
  a file's bytes, so a Windows checkout that rewrote a text file to CRLF failed the build on a
  clean tree. The example entry points are marked in `.gitattributes`, and `scroll.md` tells
  projects to do the same for the files their own scrolls name.
- Install the pixi binary when the staging directory and the project's toolchain directory sit on
  different filesystems. The download is staged in the OS temp location and moved with `rename`,
  which cannot cross a volume boundary — so on Windows, where `TEMP` is on `C:` and a checkout
  commonly is not, `init --install-toolchain` failed with `EXDEV` and installed nothing. It now
  falls back to a copy on that path.

> **Gap in this record.** Versions 0.2.0 through 0.4.11 were published without changelog entries.
> What they contained is recoverable from the commit history between the `v0.1.3` and `v0.5.0`
> tags; nothing has been reconstructed here, because a plausible guess in a changelog is worse
> than an acknowledged hole.

## [0.1.3] — 2026-07-27

### Fixed

- Ship conda's per-package records reduced to which binary it is and how it is licensed — name,
  version, build, licence — and drop `conda-meta/history` entirely. As written by the installer
  those records varied between two installs of the identical lock (a per-file `sha256_in_prefix`
  recorded on one run and not the next), so rebuilding a commit produced a different archive hash
  and no third party could reproduce a box to check it. They also carried the build machine's
  package-cache paths in `extracted_package_dir` and `link`: on a minimal `python` environment,
  fourteen files inside the box named the builder's home directory. The kept fields are
  copied verbatim and chosen by allowlist, so a field a later pixi starts writing cannot reintroduce
  either problem. Nothing in a box reads these records — conda is never shipped inside one, and
  package versions stay readable from `site-packages`.

- Unpack a packed environment whose symlinks chain through other symlinks. The extractor refuses to
  create a link whose target passes through another one — a defence against writing file content
  through a link — and conda-forge now ships exactly that shape in a plain `python` environment
  (`libsqlite` 3.53.4 pulls in `icu`, which lays out `current -> <version>` and then
  `pkgdata.inc -> current/pkgdata.inc`). Any environment locked after that release failed to build
  at all. Links are now created in a second pass, once every regular entry is on disk and nothing can
  be written through one; targets are still resolved afterwards, and a link that dangles or leaves
  the tree is still dropped rather than pulling a host file into the box.

### Changed

- Lay `dist` out as the two things a publisher does with it: `boxes/<boxId>/<version>/<targetId>/`
  holds the archive and release document under the hashes they are published as, and
  `channels/<boxId>/<channel>/<targetId>.json` holds the pointer. A channel is filed by channel
  rather than by version because it moves to the next release instead of accumulating one stale
  copy per version. The `objects/` staging tree and the identity-named duplicates of the archive and
  release document are gone — the build no longer writes the same bytes under two names, and
  `dist/boxes` uploads verbatim. **`verify` resolves the archive by the hash its release document
  commits to**, falling back to the old identity-based name so releases built before this still
  verify.
- `build` asks which channel and which weights mode when neither flag is given, offering `beta` and
  `embed` as defaults. Guards are deliberately not asked about: `--allow-dirty` and `keygen --force`
  stay explicit flags, because a question nobody reads is not a guard. With no terminal to ask, the
  default is taken and reported.
- The bundled example build input declares `condaDependencyLicenseAudit`, so a box built by following
  the quickstart ships the dependency licence inventory rather than silently omitting it. The
  reviewed inventory is committed beside that input.

### Removed

- Google Analytics, the third-party sharing widget, and the consent banner are gone from the
  documentation site, which now sets no cookies and loads no third-party script. The banner told
  readers the site used only essential cookies while both trackers loaded ahead of it. The privacy
  page states the new position, and a test fails if any script tag returns to the site config.

## [0.1.2] — 2026-07-26

### Fixed

- Export `scrollcase/contract/browser`, a platform-neutral target/document-helper surface with
  generated TypeScript declarations and no Node built-in dependency. Browser and Worker consumers
  can now derive target IDs and inspect signed-envelope shapes without bundling the Node-only
  cryptographic payload decoder.
- Keep the existing `scrollcase/contract` API unchanged while sharing its namespacing and envelope
  shape implementation with the browser-safe entry point.

## [0.1.1] — 2026-07-26

### Fixed

- Ship source-derived TypeScript declarations for the public `scrollcase/contract`,
  `scrollcase/build`, and `scrollcase/sign` runtime modules. The package export map now routes
  TypeScript to those declarations while Node keeps executing the same JavaScript, and a strict
  consumer regression covers all public entry points.
- Extend `npm run types` and the prepublish gate to regenerate and verify runtime declarations
  alongside the schema-derived box-format types.

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
- Public `/schema/*.json` routes generated byte-for-byte from the shipped contract, plus security,
  troubleshooting, schema-usage, platform, privacy, and trust-model documentation.
- Documentation contract tests covering the CLI surface, public module exports, full JSON
  examples, public schemas, required routes, and links emitted by custom Vue components.

### Fixed

- Use the pinned Node TAR implementation when unpacking the conda environment, removing an
  undeclared dependency on the host's `tar` executable.
- Pin managed toolchains to conda-pack 0.9.2 and use locale-independent ordering for every file and
  licence record that can affect deterministic archive bytes.
- Keep generated-type drift checks portable on Windows by running the generator under Node and
  normalising checkout-dependent CRLF/LF line endings before comparison.
- Pin a newly scaffolded build input when the requested pixi is already available, and install the
  requested resolver when a different pixi version is present.
- Preserve quoted external-signer arguments, including empty values and paths containing spaces or
  backslashes, while keeping all subprocesses behind the injectable process runner.
- Exercise hostile ZIP/TAR entries, verified and resumed asset downloads, and external-signer
  payload substitution and signature failures with dedicated regressions.
- Update the direct `tar` dependency to 7.5.22.
- Use GitHub's canonical repository URL in npm metadata, documentation, and status links.
- Validate the complete declarative input from the shipped schemas before probing tools, fetching, or
  mutating build state, while keeping the runtime dependency surface unchanged.
- Treat untracked files as dirty provenance while respecting Git ignore rules.
- Compare every shared schema-v1 field recursively between `box.json` and the signed release,
  including target, cache layout, self-test, asset policy, and provenance.
- Distinguish builder-only Python/file assertions from the signed consumer import check, document
  the single-process asset-resume boundary, and remove unsafe key-rotation and unsigned-build
  guidance.
- Complete tab keyboard/ARIA semantics, remove unused ShareThis and Patreon theme components, and
  restore visible scrollbars for accessible navigation.
