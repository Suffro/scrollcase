---
title: Troubleshooting
description: Safe diagnosis and correction for common Scrollcase build, signing, and verification failures.
---

# Troubleshooting

Start with the exact one-line error and `scrollcase doctor --scroll <boxId>/<targetId>`. Do not delete a guard,
replace a lock opportunistically, or overwrite a key to make an error disappear.

## Toolchain

### Missing or wrong Pixi version

- **Symptom:** `pixi not found` or `Scroll requires pixi X, found Y`.
- **Cause:** discovery found no executable, or not the scroll's `pixiVersion`.
- **Diagnose:** run `scrollcase doctor --scroll <boxId>/<targetId>` and inspect flag, environment,
  project-toolchain, then `PATH` precedence.
- **Correct:** install or select the exact pinned release, then relock only if intentionally
  changing that pin.
- **Never:** use a different resolver version for a supposedly unchanged lock.

### Missing conda-pack

- **Symptom:** doctor or build reports that conda-pack is unavailable.
- **Cause:** no executable was found through flag, environment, project toolchain, or `PATH`.
- **Correct:** let `init` install it with explicit consent, or point `--conda-pack` at a managed
  executable.
- **Never:** replace the pixi/conda-pack substrate with a second backend.

## Workspace and lock

### Dirty or non-git workspace

- **Symptom:** build refuses a dirty tree or says it cannot record a commit.
- **Cause:** tracked changes, untracked source/build inputs, or no Git checkout.
- **Diagnose:** run `git status --short --untracked-files=all` at the resolved project root.
- **Correct:** review and commit inputs, or use `--allow-dirty` only for deliberate local work; the
  release will truthfully record `sourceTreeDirty: true`.
- **Never:** hide an input or fabricate a revision.

### Missing or outdated `pixi.lock`

- **Symptom:** `Missing dependency lock`, or a reviewed licence audit no longer matches.
- **Cause:** the scroll has not been locked, or dependency declarations changed.
- **Correct:** run `scrollcase lock <boxId>/<targetId>`, review and commit the lock, then run
  `scrollcase audit <boxId>/<targetId> --write` only after reviewing the new inventory.
- **Never:** let a production build resolve dependencies on the fly.

### Licence audit drift

- **Symptom:** build or audit reports that the reviewed inventory differs from the lock.
- **Cause:** the lock changed after review.
- **Correct:** inspect package and licence changes, approve them, then rewrite the reviewed audit.
- **Never:** delete the check or label unknown licence data as reviewed.

## Assets

### Size/hash mismatch or interrupted download

- **Symptom:** asset size/SHA-256 mismatch, or retry messages after a dropped connection.
- **Cause:** partial transport, a server ignoring ranges, corruption, or upstream bytes changed.
- **Correct:** verify the authoritative bytes and update the scroll only if the project intends to
  accept new content. Retries within one download resume from `.part`.
- **Never:** promote a partial file or change the expected digest merely to match a mirror.

The build scratch directory is recreated on process start. There is no cross-process asset cache;
an interrupted process may need to download again.

## Signing and verification

### Public/private key mismatch

- **Symptom:** signing reports that the private key does not match the public metadata.
- **Cause:** paths identify different key pairs.
- **Correct:** resolve the intended pair and pass both paths explicitly.
- **Never:** run `keygen --force`; it can destroy the only copy of the established signing identity.

### Native-host mismatch

- **Symptom:** build or `verify --self-test` refuses the current OS/architecture.
- **Cause:** the box target differs from the host.
- **Correct:** run on a matching native host, or omit `--self-test` when only signature/hash/layout
  verification is intended.
- **Never:** bypass the native guard and report the result as target validation.

### External signer payload mismatch

- **Symptom:** Scrollcase rejects an external signer's result even though it contains a signature.
- **Cause:** the signer re-serialised, wrapped, or otherwise changed `payloadBase64`.
- **Correct:** echo the exact payload fields supplied on stdin and sign the decoded payload bytes.
- **Never:** accept a signature over a different representation.

## Windows specifics

Use PowerShell syntax, preserve forward slashes in scroll payload paths, and declare
`venv/python.exe` as the interpreter. Windows launchers and native-library inspection differ from
POSIX targets; do not copy a macOS/Linux entry point or assume `venv/bin/`. Build and self-test on
native Windows x86_64.
