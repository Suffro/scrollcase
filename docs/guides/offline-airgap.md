---
title: Offline / Air-Gapped Installs
description: Build once, carry the archive across, verify and install with no network at all.
---

# Offline / Air-Gapped Installs

An embedded box is self-contained: everything it needs is inside the archive, and installing it
is extraction plus a signature check. Nothing is fetched, nothing is resolved, no daemon or
container runtime is involved. That makes an isolated workstation an ordinary target rather than
a special case.

This guide covers what makes that true, and what to check before relying on it.

## What has to be true

| Requirement | How to satisfy it |
| --- | --- |
| Assets are inside the archive | Build with `--weights embed` (the default) |
| No install-time relocation step | Guaranteed by the format — see [relocation](#why-no-install-step) |
| The trust anchor is on the isolated machine | Copy `signing-public.json` across, out of band |
| The verifier runs offline | `scrollcase verify` never touches the network |

The one thing that breaks air-gapped installation is `--weights on-demand`, which deliberately
leaves the assets out for a consumer to fetch. That is why `embed` is the default: air-gapped
installation is a property worth keeping unless a project explicitly trades it away.

## Build on the connected side

```sh
scrollcase build my-model --weights embed
scrollcase verify .scrollcase/dist/my-model-1.0.0-linux-x86_64-cpu.release.json --self-test
```

Verify **before** transferring, on a machine matching the target. `--self-test` extracts the
archive and imports the declared modules with the box's own interpreter — the check that proves
the environment runs somewhere other than where it was built. Doing it now means a broken box
never makes the trip.

## Transfer

Three files travel:

```text
my-model-1.0.0-linux-x86_64-cpu.zip            # the box
my-model-1.0.0-linux-x86_64-cpu.release.json   # the signed release document
signing-public.json                            # the trust anchor
```

The trust anchor should travel by a **different route** than the box, or be already present on
the isolated machine. A signature checked against a key that arrived alongside the artefact
proves only that they were produced together.

Note the naming convention: the archive and its release document share a stem, so `verify` finds
the archive next to the document without being told. Keep them together, or pass `--archive`.

## Verify and install on the isolated side

```sh
scrollcase verify my-model-1.0.0-linux-x86_64-cpu.release.json \
  --archive my-model-1.0.0-linux-x86_64-cpu.zip \
  --public-key ./signing-public.json \
  --self-test
```

This is the whole install-time check, and it runs with no network:

- at least one signature verifies against the trusted key;
- the archive's size and SHA-256 match what the signed release commits to;
- entry names are safe — no traversal, no links, no special entries;
- `box.json` inside the archive agrees field-for-field with the signed release;
- the declared interpreter is present;
- with `--self-test`, the extracted payload size matches and the declared modules import with the
  box's own Python.

Then installing is extraction:

```sh
unzip my-model-1.0.0-linux-x86_64-cpu.zip -d /opt/boxes/my-model-1.0.0
/opt/boxes/my-model-1.0.0/venv/bin/python -c "import torch; print(torch.__version__)"
```

::: tip Prefer Scrollcase's own extraction
`scrollcase verify` validates entry names before extracting anything. If you extract with a
generic tool, do it into a fresh directory and after verifying the archive hash — that is what
the hash check is for.
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
   they find the interpreter relative to their own location, and every symlink is dereferenced,
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
5. Compare the extracted `box.json` against the release manifest field for field.

The JSON Schemas and golden fixtures ship in the package for exactly this purpose.

## Offline builds

Building itself is not offline: `lock` resolves against conda-forge, and `build` needs the
packages the lock names. On a machine that cannot reach conda-forge, populate pixi's cache from a
connected machine or an internal mirror before building — `build` installs strictly from the
committed `pixi.lock` and never resolves, so nothing new is chosen, but the package files still
have to come from somewhere.

Assets declared in the recipe are downloaded at build time too. The payload directory is wiped at
the start of every build, so pre-staging files there does not help — mirror the assets behind a
URL the build machine can reach and point the recipe's `url` at it. The declared size and SHA-256
are what keep that safe: a mirror serving different bytes fails the build.
