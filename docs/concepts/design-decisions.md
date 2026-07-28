---
title: Design decisions
description: Why Scrollcase is shaped the way it is, and which alternatives were rejected.
---

# Design decisions

Each entry records the alternative that was rejected, because a decision without its discarded
alternative is just an assertion.

## Version 2 is a clean break

Scrollcase v2 accepts and emits only `schemaVersion: 2`. Published v1 boxes and immutable package
releases remain usable with the old Scrollcase versions that produced them; the v2 verifier rejects
them with a clear unsupported-version error. It does not reinterpret them.

The declarative source is a **scroll**, stored as `scroll.json` under `scrolls/`. The built artefact
remains a **box**. This vocabulary applies across schemas, identifiers, paths, CLI arguments,
fixtures, types, documentation, and errors.

**Rejected:** a v1/v2 union, compatibility aliases, and dual execution paths. They would make every
security check and every consumer carry two meanings indefinitely, while still being unable to
change the already-published v1 wire format.

## Consumers prepare and run local boxes; they do not distribute them

The v2 consumers operate on release documents, archives, trust keys, and destinations supplied by
the caller. They may verify, safely extract, inspect, and execute a box. Verification is ordered so
no box interpreter, script, module, or import runs before the signature, payload shape, archive
size/hash, safe entries, and shared manifest agreement have succeeded.

The official Node API is `scrollcase/consumer`; the Python package is imported as
`scrollcase_consumer`. `scrollcase run` is a thin CLI wrapper over the Node API. The utilities live
in those consumer SDKs, not as a JavaScript helper copied into every box.

This local execution surface does not choose channels, fetch archives, update installations,
promote, revoke, publish, serve, allocate runners, or decide application lifecycle policy.

**Rejected:** folding registry, download, update, and lifecycle policy into the consumer. Those
responsibilities require project-specific trust and rollout choices and would turn a local,
composable verifier into a distribution system.

## One contract, multiple consumer implementations

`src/contract/` and its schemas remain the single source of truth. Node and Python expose the same
verification, extraction, execution, receipt, error, signal, cleanup, and on-demand-asset semantics.
Language-neutral fixtures and expected results prove their parity. The Python package carries
checked generated copies of the canonical schemas; it does not hand-maintain a second format.

**Rejected:** independent Node and Python contracts that merely look similar. Security behavior
drifts at edge cases — links, traversal, collisions, signals, or argument handling — unless both
implementations are held to the same observable cases.

## One substrate: pixi + conda-pack + conda-forge

Scrollcase supports exactly one dependency backend.

A packaging tool's product is its guarantees — this environment installs, relocates, self-tests, and
is reproducible from a lock. Two backends means proving every guarantee twice, on every platform, for
every release. The conda-forge path also solves the problem a wheel-based one cannot: native
libraries. Scientific stacks are mostly compiled code, and conda-forge distributes it as a coherent,
licence-annotated package set rather than as wheels of varying provenance.

**Rejected:** a second backend for projects already on `uv`. Those projects convert their scrolls
once; Scrollcase avoids a permanent double burden.

## conda-pack, and deliberately *not* running conda-unpack

`conda-pack` produces a ready-to-run tree, so a consumer pays no install-time work beyond extraction.
The embedded `conda-unpack` fixer is deliberately **not** run: it would stamp the build machine's
absolute paths into dozens of files that then ship to users — measured on a probe environment, zero
files carried the build prefix before running it and thirty-six after — leaking a developer's
directory layout while still being wrong at the user's install location. Instead the few service
files that do carry the prefix are removed, symlinks are dereferenced, and generated console scripts
are rewritten to resolve Python next to themselves.

**Rejected:** `pixi-pack`, which ships packages rather than a tree and needs a per-user install plus a
bundled unpacker at the other end. The slow step (compression) is better paid once by whoever builds
than on every install.

## The document namespace belongs to the publishing project

Every signed document carries a `kind` like `scrollcase.box.release`. The namespace is configurable
and defaults to `scrollcase.box`.

This exists because a project that already has boxes installed in the field cannot have a tool rename
its documents underneath it — its clients would stop recognising them. Making the namespace the
project's own declaration means byte-compatibility for existing publishers and a tool that carries
nobody's brand.

**Rejected:** hard-coding a single namespace. Byte-compatibility for existing publishers turned out to
cost nothing, and independence from any one consumer is not negotiable.

## Signing is built in; key custody is not

Scrollcase signs with a local ed25519 key out of the box, so anyone gets verifiable boxes without
infrastructure. An operator with real key custody — a KMS, an HSM, a signing service — configures an
external signer command instead: it receives the payload on stdin and returns the signed document on
stdout. Any language, any credential mechanism, no plugin API to keep compatible.

An external signer is not trusted on its word. The returned document must echo back the exact payload
it was given, and its signature is verified locally before the build continues. A signer that
substitutes a payload fails the build instead of producing a box nobody can install.

**Rejected:** a provider-specific integration. Cloud-specific authentication in a packaging tool ages
badly and excludes everyone using something else.

## Verification is not optional

`verify` checks signature, archive size and hash, safe entry names, recursive agreement of every
shared schema-v2 field, and the declared interpreter. With `--self-test` it extracts temporarily and
runs the signed import subset. Scroll-only Python and file assertions remain builder checks because
they are not part of the signed release.

## Weights: embedded by default, on demand when asked

`embed` packs assets into the archive: the box installs with no network and works air-gapped, at the
cost of a large artefact. `on-demand` leaves them out and carries their url, path, size and SHA-256 in
the signed release and in `box.json`, so a consumer fetches and verifies them at install time.

The declared hash is what makes deferring safe: the release commits to exactly which bytes the box
expects, whatever host serves them.

**Rejected:** making on-demand the default. Air-gapped installation is a property worth keeping
unless a project explicitly trades it away, and it is the behaviour that surprises nobody.

## Accelerator parity is a packaging concern

A scroll may declare a `parity` block: a check script inside the box, the accelerators to run it
under, and tolerances (`absolute`, `relative`, `minimumCosine`). Scrollcase runs the check once per
accelerator using each target's validation environment, compares every run against the first, and
fails the build on a breach.

The question — *does this box compute the same thing on the GPU as on the CPU?* — sounds scientific
but is not. It catches the failures a packaging tool is responsible for: the wrong wheels solved in, a
CPU-only build shipped as CUDA, a broken BLAS.

The division of labour is deliberate. Scrollcase owns the mechanism and enforces the declared
threshold; the project owns the check script, the fixture, and what closeness means for its model.
Non-finite output is rejected explicitly, being the classic symptom of a broken accelerator build, and
relative error is only counted where the reference has magnitude — the absolute bound guards entries
near zero, where relative error is meaningless.

**Rejected:** hard-coding tolerances inside Scrollcase. What counts as close enough is a property of
the model, not of the packaging step, so it is declared per scroll rather than assumed.

## The toolchain is installed on request, and pinned once installed

`init` can install `pixi` and `conda-pack`, but only after asking, and only into the project's own
toolchain directory. Nothing is added to `PATH`, nothing is installed system-wide, and deleting the
directory undoes it. Without a terminal to answer the question — CI, a pipe — nothing is installed
at all: silence is not consent.

The download is verified before use. The release archive's SHA-256 is checked against the checksum
the publisher ships beside it, and the verified digest is then recorded in the project's config, so
every later install is checked against a value the project committed rather than against whatever
the server offers that day. A mismatch aborts before anything is installed. The conda-pack
dependency is installed as the exact `conda-pack==0.9.2` match specification and that version is
recorded beside the pixi pin; floating it would let the same Scrollcase release produce different
payload bytes over time.

**Rejected:** installing silently, and the `curl | sh` convention it would imitate. A packaging tool
whose whole product is verified artefacts cannot begin by running unverified bytes it fetched
without being asked.

## Paths come from the project, not from Scrollcase

A workspace is declared by a `scrollcase.config.json` at the project root, discovered by walking up
from the working directory, with per-invocation flag overrides. Defaults are `scrolls/` and
`.scrollcase/{build,dist,keys}`.

A tool that derives its paths from its own location on disk only works while it lives inside the
project it serves. Making the layout the project's declaration is what lets Scrollcase run from
anywhere against any project that declares one.

## Workspace setup and scroll authoring are separate

`scrollcase init` creates only project structure and may offer the shared verified toolchain.
`scrollcase new scroll` owns box identity, target, versions, compatibility, weights, and execution
intent. A non-terminal authoring call must provide every material value and fails before writing
when one is missing; an interactive terminal uses the same finite-choice menus as the rest of the
CLI. Neither path overwrites an existing scroll or source script.

**Rejected:** having `init` invent an example box and target. A workspace can carry many unrelated
boxes, so setup has no principled answer for product identity or execution behavior. The placeholder
made the first real scroll an edit of guessed metadata and coupled toolchain installation to one
arbitrary input.

## Scrolls are grouped by box, then target

The default layout is `scrolls/<boxId>/<targetId>/`. Both directory names are checked against the
meaningful fields in `scroll.json`: `boxId` and the canonical ID computed from `target`. This makes
all target variants of one box visible together without making a directory name the source of the
box's identity.

`scrollId` is optional input. Release schema version 2 requires a provenance `scrollId`, so a scroll
that omits it derives the value deterministically as `<boxId>-<targetId>`. Source directories are
always nested; the flat v1 layout is deliberately not a compatibility path.

At the CLI edge, a box name expands to its target scrolls and a terminal presents them as a
navigable menu. One target matching the current host may be the default; on macOS, Metal is the
explicit preference when CPU and Metal both match. A non-interactive process uses that same policy
and fails on any remaining ambiguity instead of silently choosing CPU or CUDA.

**Rejected:** requiring `scrollId` to repeat the directory name. That check made the filesystem a
second identity layer and encouraged product-plus-machine directory names even though the scroll
already declares both facts.

## Provenance refuses to lie

A box records the commit it was built from and whether that working tree was dirty, including
untracked files while respecting Git ignore rules. Building outside a git checkout fails rather
than inventing a revision, and building from a dirty tree requires
`--allow-dirty` and is recorded as `sourceTreeDirty: true` in the box itself. A build that cannot be
reproduced from its recorded revision says so.

Rebuilding the same commit produces a byte-identical archive: timestamps are normalised, the build
time comes from the commit rather than the clock, and the channel cohort salt is derived from box
and version rather than randomly.

## Documentation audit decisions (2026-07-26)

The public-contract audit resolved six implementation choices:

- The maintainer chose to preserve the existing privacy banner and analytics behavior. The linked
  `/privacy` route documents that behavior; consent controls were not added.
- Public schema URLs are deterministic copies of `src/contract/schema/`, guarded byte for byte.
- Verification compares all security-, identity-, target-, asset-policy-, self-test-, and
  provenance fields duplicated by schema version 2.
- Consumer self-test is documented as the signed import subset; scroll `pythonCode` and file
  assertions stay builder-only until a future wire version can carry them.
- Scroll structure is validated at runtime from the shipped schemas by a dependency-free internal
  validator before tool discovery or build-directory mutation.
- Asset resume is limited to retries within one download operation. There is no persistent cache
  and the documentation makes that process boundary explicit.

## The licence audit is derived from the lock

The inventory is a pure function of the committed `pixi.lock`, which carries an SPDX licence per
package, and `pixi install --frozen` guarantees the installed set equals it. So `audit` runs without
building anything, and licence review can happen when dependencies change rather than at the end of a
multi-gigabyte build. A package with no declared licence fails the parse outright: an unlicensed
dependency is a legal problem, not a reporting gap.

## Deliberately out of scope

Publishing to object storage, downloading boxes, selecting or promoting a channel, updating an
installation, revoking a release, serving a registry, allocating CI runners, application lifecycle
policy, and model-specific scientific validation all belong to the consuming project. Scrollcase
stops at building a signed box or preparing and running caller-supplied local box inputs.

The boundary is what keeps the guarantees provable. A packaging tool that also serves a registry has
to keep proving both sets of guarantees at once; one that stays local composes with any distribution
mechanism a project already has.
