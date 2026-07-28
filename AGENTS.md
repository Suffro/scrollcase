# AGENTS.md

Operational instructions for AI coding agents working in this repository.
Read this before implementing anything. The reasoning behind each decision lives in
`docs/concepts/design-decisions.md`.

Before planning a multi-step or expensive task, and before delegating to subagents, read
`AGENT-POLICY.md`.

---

## Project context

**Scrollcase** turns a declarative **scroll** into a **box**: a portable, locked, self-contained
Python environment for one operating system and accelerator, packed so it runs somewhere other than
where it was built, signed so a consumer can prove what they received, and accompanied by a
dependency licence inventory.

The substrate is **pixi + conda-pack + conda-forge**, and only that. `pixi` solves a committed
`pixi.lock`, `conda-pack` relocates the resulting prefix, and the tree is extracted into the box's
`venv/`. The released CLI currently has seven verbs: `init`, `doctor`, `keygen`, `lock`, `audit`,
`build`, `verify`. v2 adds `new` and `run`.

Scrollcase is **a library as well as a CLI**. Its public Node surfaces include the contract, build
and signing APIs; v2 adds the local execution API at `scrollcase/consumer`. The Python consumer
exposes the same semantics as `scrollcase_consumer`. A change to any public export is a change to a
public API.

The accepted v2 design is authoritative even while the working tree is migrated in phases. v2 is a
clean break: do not add v1/v2 unions, legacy aliases, or dual code paths. Existing v1 releases remain
historical artefacts for the old Scrollcase versions that produced them.

It is open source and vendor-neutral, and must stay usable by projects that have nothing to do with
the one that first needed it.

## What Scrollcase is NOT

This boundary is the whole point of the project, and it is the thing most likely to erode.
**A change that crosses it is wrong even when it would be convenient.**

- **Not a distribution system.** Scrollcase may prepare and execute a caller-supplied local box, but
  it does not select channels, download boxes, update installations, promote, revoke, publish, or
  serve. Those lifecycle responsibilities belong to whoever consumes it.
- **Not a CI system.** No model catalog, no runner allocation, no cost policy, no build-evidence
  records for someone else's pipeline.
- **Not a scientific validator.** Scrollcase *enforces* a numerical tolerance its user declared (see
  parity); it never decides what is scientifically correct or what a fixture means.
- **Not tied to any consuming project.** It carries no reference to any specific consumer anywhere.

## Hard rules

1. **No consumer's name in the tool.** Not in identifiers, error messages, environment variables,
   default paths, wire strings, or examples. A project-specific value is declared by the project
   (config, scroll, or flag) and Scrollcase stays ignorant. Re-grep after every file move: moved
   files have smuggled such references back in twice already.
2. **The document namespace belongs to the publishing project.** A `kind` is
   `<namespace>.release` / `.channel` / `.revocations`, built by `documentKinds(namespace)` and
   defaulting to `scrollcase.box`. A project with boxes already in the field keeps emitting the
   namespace its clients recognise. Never hard-code one.
3. **One substrate.** No second dependency backend. Two backends means proving every guarantee
   twice, and the guarantees are the product.
4. **Published v1 is immutable; active development is v2-only.** The v2 verifier rejects
   `schemaVersion: 1` clearly instead of reinterpreting it. Never silently edit a `kind` string, the
   payload encoding, the signature algorithm, or a golden fixture. Any future breaking wire change
   needs another new `schemaVersion`.
5. **Determinism is a promise.** Rebuilding the same commit must produce a byte-identical archive.
   Introduce nothing that varies per run: no clock read, no random value, no unsorted directory
   listing.
6. **Provenance is a promise.** A box records the commit it was built from and whether that tree was
   dirty. Never fabricate a revision, and never quietly downgrade a dirty build to look clean.
7. **Verify, never trust.** Assets are size- and hash-checked before entering the payload; a
   downloaded toolchain is checksum-verified before installation; an external signer must echo back
   the exact payload it was given; a reviewed licence audit must still match the lock. An
   inconvenient check is not a check to delete.

## Safety

These actions are expensive, irreversible, or both. **Never perform one from memory or name
inference — read back the exact command and its inputs first, and verify the result immediately
afterwards.**

- **`npm publish` is public and irreversible.** It is the maintainer's call, never an agent's.
- **Force-pushing or rewriting history** breaks every existing clone, and GitHub keeps the old
  objects reachable by SHA afterwards — a rewrite does not un-publish anything by itself. Only on an
  explicit instruction, and record the pre-rewrite ref first.
- **`keygen --force` silently invalidates every document signed with the previous key**, with no way
  to tell which. Never pass it to make a key mismatch go away.
- **A real build downloads gigabytes and takes minutes**, as does a real toolchain install. Do not
  trigger one casually. Never poll a long-running process: wait for a completion signal, or check
  once after a meaningful interval, and report only real transitions.
- **Never print, log, or commit a private key.** They live under `.scrollcase/keys/`.
- **`build` refuses to run outside a git checkout, and refuses a dirty tree without `--allow-dirty`.
  `verify --self-test` runs only on a matching native host.** These are deliberate. Do not route
  around them.

## Repository continuity

- The public reasoning lives in `docs/concepts/design-decisions.md`; contributor rules in
  `CONTRIBUTING.md`; every user-visible change in `CHANGELOG.md`.
- **Durable project knowledge must live in tracked repository documentation.** Machine-local agent
  memory is a convenience, never the only source for information needed to continue the work.
- The folder `.local-memory` in the root holds memory files, kept updated and git-ignored. If it
  does not exist and you need to update local memory, create it in the root.
- `docs/` is a VitePress site and part of the deliverable. A behaviour change not reflected there is
  unfinished.

## Naming (canonical terms — use exactly these)

- **box** — the built artefact. Never "image", never "container", never a consumer's product term.
- **scroll** — the declarative input (`scroll.json`), the only input a build accepts.
- **target** — the `(platform, arch, accelerator)` triple, plus `cudaVersion` for CUDA.
- **payload** — the tree assembled before archiving.
- **release / channel / revocations** — the three signed document types.
- **self-test** — the import check run with the box's *own* interpreter.
- **parity** — the optional cross-accelerator numerical gate.

**Casing is functional, not cosmetic.** Write **Scrollcase** in prose, and `scrollcase` lowercase
wherever it is an identifier: the command, the npm package, the exports, `scrollcase.config.json`,
the `scrollcase.box` namespace, temp-directory prefixes, and the `.gitignore` marker. A blanket
capitalisation pass has already broken printed commands and an idempotency marker; never apply one
without reading each hit.

## Architecture rules

- **`src/contract/` is the single source of truth for the box format.** Other languages *mirror* the
  rules and prove the mirror against `fixtures/target-id-contract.json`; they do not import it.
- **The schemas are the source of truth for box-format types.** They are generated (`npm run types`
  → `src/contract/types/index.d.ts`), never hand-written, and a test fails if the two disagree.
  Runtime declarations are generated by the same command from the typed JSDoc beside the
  JavaScript implementation; never hand-edit either generated surface.
- **One contract, multiple implementations.** The Node consumer at `scrollcase/consumer` and the
  Python `scrollcase_consumer` package implement the same local verification, extraction, execution,
  receipt, and error semantics. They prove parity against shared language-neutral conformance
  fixtures; neither maintains a second format definition.
- **Verification precedes execution.** Consumer code may not run a box interpreter, script, module,
  or import before signature, payload shape, archive size/hash, safe-entry, and manifest-agreement
  checks succeed.
- **`src/cli.mjs` stays thin.** Argument parsing and I/O only. User interaction such as a prompt
  lives at the CLI edge; modules take consent as an injected dependency, never by reading a terminal.
- **Paths come from the project.** A workspace is declared by `scrollcase.config.json` and resolved
  through `workspace.mjs`. Never derive a path from the tool's own location on disk.
- **Keep the dependency surface small.** The runtime depends on `tar`, `yauzl` and `yazl` and
  nothing else. Reach for a Node built-in before adding a package.
- **Injection is the test seam.** Subprocesses go through `run` / `runResult`, network access through
  an injectable `fetch`. Preserve those seams when adding code.

### Layout

- `src/contract/` — the format: target model and identity rule (`targets.mjs`), signed-document
  envelope and namespacing (`documents.mjs`), `schema/`, `fixtures/`, generated `types/`.
- `src/build/` — solving and packing (`pixi.mjs`), toolchain bootstrap (`toolchain.mjs`), relocation
  repair (`launchers.mjs`), archive and filesystem primitives, the lock-derived licence audit,
  workspace resolution, scroll reading and provenance, asset staging, the build core (`box.mjs`),
  `verify.mjs`, `audit.mjs`, `project.mjs` (init/doctor), and the parity gate.
- `src/sign/` — key generation, local signing, external-signer dispatch, verification.
- `src/cli.mjs` — argument parsing and dispatch. `scripts/` — dev tooling, not shipped.
- `examples/` — a working scroll that builds in about a minute. `docs/` — the VitePress site.

This list is not complete; read the files for more.

## Conventions

- **Language:** comments, code, CLI output and developer-facing docs are always in **English**.
- **Comments:** this repository has a distinctive voice — module headers explain *why* the module is
  shaped as it is, and a decision is recorded together with the alternative it rejected. Match the
  surrounding density and voice. Explain non-obvious logic; do not generate comment noise.
- **DRY:** the archive extractor, the path-safety helper and the process runner already exist. Reuse
  them rather than writing a parallel implementation.
- **Errors:** every validation failure goes through `fail()`, so the CLI exits non-zero with one
  clear line. Do not invent a second error path.
- **No fake fallbacks or architectural shortcuts.** A check that is hard to satisfy is not a check to
  delete.
- **Commits:** carry no tool attribution trailers.

## Build / test / run

The commands, in full — there are only five:

| Purpose | Command |
| --- | --- |
| Unit suite | `npm test` |
| Regenerate the contract types from the schemas | `npm run types` |
| Build the docs site — also the dead-link check | `cd docs && npm run build` |
| Docs dev server | `cd docs && npm run dev` |
| The CLI surface | `node src/cli.mjs help` |

If one of these fails or no longer exists, read the `scripts` section of the relevant
`package.json`, use what is there, and **update this file**.

Building a box for real additionally needs `pixi` at the version the scroll pins, plus `conda-pack`.
`scrollcase doctor` reports what is missing; `scrollcase init` offers to install them and must never
do so without explicit consent.

Run, at every change that could affect them:

1. **Always** — `npm test`. Never report completion from inference.
2. **When docs changed** — `cd docs && npm run build`. VitePress fails on a dead link.
3. **When a schema changed** — `npm run types`, then `npm test`: the drift test is what keeps the
   generated types honest.
4. **When `package.json` exports or `files` changed** — the package-surface test covers it, but
   confirm it can still fail by breaking one entry deliberately.
5. **A real build, or a real toolchain install** — expensive and network-bound. Ask the user first.

### Paths that break silently

The suite runs on one host with the toolchain stubbed, so it cannot cover these. When a change could
affect them, read it against each — even the ones you cannot execute here.

1. **The three targets.** macOS, Linux and Windows differ in interpreter layout (`venv/bin/python`
   vs `venv/python.exe`), scripts directory, launcher repair and native-library inspection. Anything
   touching packing, relocation or path handling must be checked against all three.
2. **`embed` vs `on-demand` weights.** The second leaves assets out of the archive, carries their
   descriptors in the signed release, and refuses `assetArchives`. Asset staging and manifest
   changes affect both.
3. **Local key vs external signer.** The external path must still echo back the exact payload it was
   given and verify locally before the build continues.
4. **Toolchain from `PATH` vs the project's own.** Discovery is flag > env > project toolchain >
   `PATH`; check discovery changes with and without an installed project toolchain.

## Testing conventions

- **Exercise the real path, not just the import.** A module that loads is not a module that works:
  an early refactor dropped a constant the licence parser used, and every `audit` threw
  `ReferenceError` while the suite stayed green, because nothing called that function end to end.
- Prefer a test that asserts a behaviour someone depends on — a tampered archive is rejected, a
  rebuild is byte-identical, a dirty tree is refused, a checksum mismatch installs nothing — over
  one that asserts an implementation detail.
- **Prove a new guard can fail.** A test never seen red is not yet a guard: break what it protects
  once, confirm the failure, then restore.
- **Never let a test reach the network**, and never let one write outside its temporary directory.

## Boundaries — do not touch

The four you cannot deduce from the code:

- `src/contract/types/index.d.ts` and `src/**/*.d.mts` — generated. Regenerate with
  `npm run types`; never hand-edit.
- The golden fixtures in `src/contract/fixtures/` unless the format itself is changing, with a
  version bump.
- The `kind` strings, payload encoding and signature algorithm (hard rule 4).
- `launcherKind: 'uv-windows-pe'` in `src/contract/targets.mjs` — it reads like a stale reference to
  a tool this project does not use. It is a frozen wire string. Do not "clean" it.

Off-limits for the usual reasons: `package-lock.json` (unless the task is explicitly a dependency
change), secrets and signing keys, and generated state (`.scrollcase/`, `docs/.vitepress/dist/`,
`docs/.vitepress/cache/`).
