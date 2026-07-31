---
title: Offline / Air-Gapped Installs
description: Build once, carry the archive across, verify and install with no network at all.
---

# Offline / Air-Gapped Installs

An embedded box is self-contained: everything it needs is inside the archive. A consumer verifies
the signed release and archive, then performs its own safe extraction and activation. Nothing is
fetched or resolved, and no daemon or container runtime is involved.

This guide covers what makes that true, and what to check before relying on it.

## What has to be true

| Requirement | How to satisfy it |
| --- | --- |
| Assets are inside the archive | Build with `--weights embed` (the default) |
| No install-time relocation step | Guaranteed by the format — see [relocation](#why-no-install-step) |
| The trust anchor is on the isolated machine | Copy `signing-public.json` across, out of band |
| The verifier runs offline | `scrollcase verify` never touches the network |

The one thing that breaks air-gapped installation is `--weights on-demand`, which deliberately
leaves the assets out for the caller's distribution layer to materialize. That is why `embed` is
the default: air-gapped installation is a property worth keeping unless a project explicitly
trades it away.

## Build on the connected side

```sh
scrollcase build my-model/linux-x86_64-cpu --weights embed
scrollcase verify .scrollcase/dist/boxes/my-model/1.0.0/linux-x86_64-cpu/*.release.json --self-test
```

Verify **before** transferring, on a machine matching the target. `--self-test` extracts the
archive and imports the declared modules with the box's own interpreter — the check that proves
the environment runs somewhere other than where it was built. Doing it now means a broken box
never makes the trip.

## Transfer

Three files travel:

```text
<archive sha256>.zip                  # the box
<release document sha256>.release.json # the signed release document
signing-public.json                    # the trust anchor
```

The trust anchor should travel by a **different route** than the box, or be already present on
the isolated machine. A signature checked against a key that arrived alongside the artefact
proves only that they were produced together.

Keep the archive beside the release document under its content-addressed filename. `verify` reads
the archive SHA-256 from the signed release and resolves `<archive sha256>.zip`; if the files are
stored separately, pass `--archive`.

## Verify on the isolated side

```sh
scrollcase verify RELEASE_DOCUMENT_SHA256.release.json \
  --archive ARCHIVE_SHA256.zip \
  --public-key ./signing-public.json \
  --self-test
```

This validates through a temporary extraction and runs with no network:

- at least one signature verifies against the trusted key;
- the archive's size and SHA-256 match what the signed release commits to;
- entry names are safe — no traversal, no links, no special entries;
- every shared `box.json` field agrees recursively with the signed release;
- the declared interpreter is present;
- with `--self-test`, the extracted payload size matches and the declared modules import with the
  box's own Python.

Scrollcase does not install or extract into an arbitrary final destination. After verification,
the consuming project may extract into a fresh destination using a path-safe extractor:

```sh
unzip ARCHIVE_SHA256.zip -d /opt/boxes/my-model-1.0.0
/opt/boxes/my-model-1.0.0/venv/bin/python -c "import torch; print(torch.__version__)"
```

::: warning Verification is not final installation
`verify --self-test` extracts only into a temporary directory and removes it afterwards. A generic
`unzip` command is illustrative, not a Scrollcase-managed installation. The consumer must preserve
the same path-safety checks and extract only after signature, size, and hash verification.
:::

## Why there is no install step {#why-no-install-step}

Three properties of the format make extraction sufficient:

1. **The tree is packed ready to run.** conda-pack produces a complete prefix, so a consumer pays
   no install-time work beyond extraction and decompression.
2. **`conda-unpack` is deliberately never run.** Running it would stamp the *build machine's*
   absolute paths into dozens of files that then ship to users — measured on a probe environment,
   zero files carried the build prefix before running it and thirty-six after — leaking a
   developer's directory layout while still being wrong at the user's install location. Instead
   the few service files that carry the prefix are removed at build time.
3. **Launchers resolve Python next to themselves.** Generated console scripts are rewritten so
   they find the interpreter relative to their own location, symlinks point only inside the box,
   so the extracted tree does not depend on where it landed.

The result: the same archive works at `/opt/boxes/…`, in a user's home directory, or on a
read-only mount, with no fixer, no activation, and no environment variables.

## Verifying without Scrollcase

An isolated machine may not have Node. The checks are simple enough to reimplement, and the
format is specified precisely so that reimplementation stays honest — see
[The Box Format](/reference/box-format). The minimum a client must do:

1. Decode `payloadBase64`, check its SHA-256 against `payloadSha256`.
2. Verify at least one ed25519 signature over **those decoded bytes** against a trusted key.
3. Parse the payload; check the archive's size and SHA-256 against `archive.sizeBytes` and
   `archive.sha256`.
4. Validate every ZIP entry name before extracting; reject links and special entries.
5. Compare all shared `box.json` fields recursively against the release manifest.

The JSON Schemas and golden fixtures ship in the package for exactly this purpose.

## Offline builds

Building itself is not offline: `lock` resolves against conda-forge, and `build` needs the
packages the lock names. On a machine that cannot reach conda-forge, populate pixi's cache from a
connected machine or an internal mirror before building — `build` installs strictly from the
committed `pixi.lock` and never resolves, so nothing new is chosen, but the package files still
have to come from somewhere.

Assets declared in the scroll are downloaded at build time too. The payload directory is wiped at
the start of every build, so pre-staging files there does not help — mirror the assets behind a
URL the build machine can reach and point the scroll's `url` at it. The declared size and SHA-256
are what keep that safe: a mirror serving different bytes fails the build.
