---
title: Why Pixi & Conda-Forge
description: One substrate, chosen for native libraries, licence metadata, and a lock worth trusting.
---

# Why Pixi & Conda-Forge

Scrollcase is built on exactly one substrate: **pixi solves a committed `pixi.lock` against
conda-forge, conda-pack relocates the resulting prefix, and the tree ships inside the box as
`venv/`.** There is no second dependency backend, and adding one is out of scope.

This page explains what that choice buys, and what it costs.

## One substrate, on purpose

Supporting a second backend — `uv` with a standalone Python distribution, say — was considered and
rejected.

A packaging tool's product is its **guarantees** — this environment installs, relocates,
self-tests, and is reproducible from a lock. Two backends means proving every guarantee twice, on
every platform, for every release: two relocation strategies, two lock formats, two licence
parsers, two sets of platform quirks. The guarantees are the product, so Scrollcase keeps exactly
one way of producing them.

Projects already on `uv` convert their scrolls once. Scrollcase avoids a permanent double burden.

## Why conda-forge

**Native libraries are the actual problem.** Scientific stacks are mostly compiled code — BLAS,
CUDA runtimes, HDF5, Arrow, image and compression codecs — and the interesting failures are
linkage failures, not Python ones. conda-forge distributes that compiled code as a coherent,
centrally built package set with real dependency metadata for the native pieces, rather than as
wheels of varying provenance that each vendor their own copy of a shared library.

**Licences come with the packages.** conda-forge records an SPDX licence per package, and it ends
up in the lock. That is what makes Scrollcase's [licence audit](/reference/cli#audit) a pure
function of a committed file rather than a scraping exercise: the inventory can be produced,
reviewed and checked into a repository long before any box exists, and a package with no declared
licence fails the parse outright.

**The interpreter is just another package.** Python itself comes from the same channel, solved
together with everything else, so there is no separate "which standalone Python build?" question
and no mismatch between the interpreter's ABI and the wheels around it.

## Why pixi

**A lock worth trusting.** `pixi.lock` pins every package, for the exact target platform declared
in the manifest, so resolution is independent of the machine doing it. Scrollcase splits that
into two verbs on purpose:

```sh
scrollcase lock my-model/linux-x86_64-cpu     # resolve — a human step, reviewed and committed
scrollcase build my-model/linux-x86_64-cpu    # install --frozen — never resolves
```

`pixi install --frozen` installs exactly the locked packages without touching or re-checking the
lock, so **what ships is byte-for-byte what was reviewed**.

**The resolver version is part of the scroll.** A scroll pins `pixiVersion`, and both `lock` and
`build` refuse any other version — a different resolver can select different packages and
silently change the box. Determinism is not just about the lock; it is about everything that
touched it.

**One target per environment.** The manifest declares a single `platforms` entry matching the
box's target (`osx-arm64`, `linux-64`, `win-64`). One environment, one target, one box — nothing
multiplexed, nothing to disambiguate at install time.

## Why conda-pack, and why `conda-unpack` is never run

conda-pack produces a **ready-to-run tree**, so a consumer pays no install-time work beyond
extraction. That is what makes an install an unzip.

Its embedded `conda-unpack` fixer is deliberately **not** run. Running it would stamp the build
machine's absolute paths into dozens of files that then ship to users — measured on a probe
environment, zero files carried the build prefix before running it and thirty-six after — leaking
a developer's directory layout while still being wrong at the user's install location.

Instead the few service files that do carry the prefix are removed, symlinks are dereferenced,
and generated console scripts are rewritten to resolve Python next to themselves. The result runs
from any location with no activation, no environment variables, and no fixer. Details in
[Architecture](/concepts/architecture#relocation).

### Rejected: pixi-pack

`pixi-pack` ships *packages* rather than a tree, and needs a per-user install step plus a bundled
unpacker at the other end. Scrollcase's position is that the slow step — compression — is better
paid once by whoever builds than on every install, and that the fewer moving parts a consumer needs,
the better. An archive plus a hash is the smallest possible install contract.

## What this costs

Being honest about the trade-offs:

- **PyPI-only packages need care.** pixi can install PyPI dependencies alongside conda ones, and
  the licence parser reads both, but the further you go from conda-forge the weaker the native
  dependency metadata gets.
- **Archives are large.** A full conda prefix with a CUDA stack is measured in gigabytes. Pruning
  and `--weights on-demand` exist for this — see
  [Managing Model Weights](/guides/managing-weights).
- **Builds are native.** No cross-building: a Windows box is built on Windows. The self-test runs
  the box's own interpreter, and that only proves anything on matching hardware.
- **Two tools must be present.** `pixi` at the scroll's pinned version, and `conda-pack` 0.9.2.
  Scrollcase installs that exact conda-pack release itself; for externally managed executables,
  `doctor` can confirm only that conda-pack runs because its version output is unreliable.

## Not a container

A box is not an image and there is no runtime. Nothing is layered, no daemon is involved, and
installing does not require root, a virtualisation stack, or a registry login. Containers solve
process isolation; Scrollcase solves *this environment, verifiably, on this machine* — including
machines where a container runtime is not available or not permitted.

## Further reading

- [Architecture](/concepts/architecture) — how the pipeline holds its guarantees.
- [Design Decisions](/concepts/design-decisions) — each decision with the alternative it rejected.
