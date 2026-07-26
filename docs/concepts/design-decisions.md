---
title: Design decisions
description: Why Scrollcase is shaped the way it is, and which alternatives were rejected.
---

# Design decisions

Each entry records the alternative that was rejected, because a decision without its discarded
alternative is just an assertion.

## One substrate: pixi + conda-pack + conda-forge

Scrollcase supports exactly one dependency backend.

A packaging tool's product is its guarantees — this environment installs, relocates, self-tests, and
is reproducible from a lock. Two backends means proving every guarantee twice, on every platform, for
every release. The conda-forge path also solves the problem a wheel-based one cannot: native
libraries. Scientific stacks are mostly compiled code, and conda-forge distributes it as a coherent,
licence-annotated package set rather than as wheels of varying provenance.

**Rejected:** a second backend for projects already on `uv`. Those projects convert their recipes
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

`verify` mirrors what an installing client does: signature, archive size and hash, safe entry names,
`box.json` agreeing field-for-field with the signed release, the declared interpreter present, and —
with `--self-test` — a real extraction whose own interpreter imports the declared modules. The point
is that a box which would fail on a user's machine fails on the builder's first.

## Weights: embedded by default, on demand when asked

`embed` packs assets into the archive: the box installs with no network and works air-gapped, at the
cost of a large artefact. `on-demand` leaves them out and carries their url, path, size and SHA-256 in
the signed release and in `box.json`, so a consumer fetches and verifies them at install time.

The declared hash is what makes deferring safe: the release commits to exactly which bytes the box
expects, whatever host serves them.

**Rejected:** making on-demand the default. Air-gapped installation is a property worth keeping
unless a project explicitly trades it away, and it is the behaviour that surprises nobody.

## Accelerator parity is a packaging concern

A recipe may declare a `parity` block: a check script inside the box, the accelerators to run it
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
the model, not of the packaging step, so it is declared per recipe rather than assumed.

## Paths come from the project, not from Scrollcase

A workspace is declared by a `scrollcase.config.json` at the project root, discovered by walking up
from the working directory, with per-invocation flag overrides. Defaults are `recipes/` and
`.scrollcase/{build,dist,keys}`.

A tool that derives its paths from its own location on disk only works while it lives inside the
project it serves. Making the layout the project's declaration is what lets Scrollcase run from
anywhere against any project that declares one.

## Provenance refuses to lie

A box records the commit it was built from and whether that working tree was dirty. Building outside a
git checkout fails rather than inventing a revision, and building from a dirty tree requires
`--allow-dirty` and is recorded as `sourceTreeDirty: true` in the box itself. A build that cannot be
reproduced from its recorded revision says so.

Rebuilding the same commit produces a byte-identical archive: timestamps are normalised, the build
time comes from the commit rather than the clock, and the rollout cohort salt is derived from box and
version rather than randomly, so a rebuild does not reshuffle which users receive it.

## The licence audit is derived from the lock

The inventory is a pure function of the committed `pixi.lock`, which carries an SPDX licence per
package, and `pixi install --frozen` guarantees the installed set equals it. So `audit` runs without
building anything, and licence review can happen when dependencies change rather than at the end of a
multi-gigabyte build. A package with no declared licence fails the parse outright: an unlicensed
dependency is a legal problem, not a reporting gap.

## Deliberately out of scope

Publishing to object storage, serving or promoting a channel, revoking a release, allocating CI
runners, and model-specific scientific validation all belong to whoever consumes Scrollcase, which
stops at a signed, verified box on disk.

The boundary is what keeps the guarantees provable. A packaging tool that also serves a registry has
to keep proving both sets of guarantees at once; one that stops at a file on disk composes with any
distribution mechanism a project already has.
