---
title: Security and Trust
description: Threat model, trust anchors, verification order, key custody, rotation, and consumer responsibilities.
---

# Security and Trust

Scrollcase protects the identity and bytes of a box after a project has decided what to build. It
does not decide whether a model is scientifically correct, whether a release should be promoted,
or whether a host is authorised to install it.

## Threat model

The format is designed to detect a modified or substituted archive, a modified signed document,
unsafe archive paths, a signer that returns a different payload, dependency or local-file drift,
and incomplete or corrupted downloaded assets. It records the source commit and dirty state so a
builder cannot silently present an uncommitted build as reproducible.

The format does not protect a consumer that trusts an attacker's public key, a compromised signing
key, a malicious scroll approved by the project, or a client that skips compatibility,
revocation, rollout, and path-safety policy. Scrollcase is not a registry, transport, promotion
service, revocation authority, or host installer.

## The five objects

| Object | Role | Trust property |
| --- | --- | --- |
| archive | Deterministic ZIP containing the payload | Size and SHA-256 are committed by the release |
| `box.json` | Self-description inside the archive | Shared fields must agree recursively with the release |
| release | Immutable identity, target, archive digest, consumer import check, and provenance | Signed |
| channel | Mutable pointer to one or more releases | Signed independently |
| revocations | Signed statements identifying withdrawn releases | Defined and verifiable; distribution and enforcement are consumer policy |

A signature is carried by the adjacent release document, not embedded in the archive.

## Bootstrap a trust anchor

Obtain the project's public key through a channel independent of the box download: a reviewed
source repository, managed device configuration, a pinned application release, or another
authenticated administrative path. Copy only the public key into a tracked project-owned trust
directory and pass it explicitly:

```sh
scrollcase verify release.json --public-key trust/scrollcase-signing-public.json
```

Never treat a public key downloaded beside the archive as trusted merely because it arrived
together. Never commit the private key under `.scrollcase/keys/`.

## Verification order

`scrollcase verify` performs these checks in order:

1. Decode the envelope, confirm its payload SHA-256, and verify at least one ed25519 signature
   against the trusted key file.
2. Require a release document, resolve its exact target adapter, and validate its interpreter path.
3. Locate the archive and compare its byte size and SHA-256 with the signed release.
4. List ZIP entries defensively, rejecting traversal, links, and special entries before extraction.
5. Require `box.json` and recursively compare every shared schema-v2 field: identity and version,
   complete target, entry point, cache subdirectory, consumer self-test, weights/assets policy,
   and provenance.
6. Require the declared interpreter entry inside the archive.
7. With `--self-test`, require a matching native host, extract to a temporary directory, compare
   the logical extracted payload size, and run the signed import check with the box's interpreter.

The builder's richer scroll checks—optional `pythonCode` and post-prune file assertions—are not
part of the signed release and therefore cannot be repeated by a consumer. See
[The Scroll](/reference/scroll#self-test).

## Key custody

A local key is suitable for controlled development, but the private PEM remains on the build
machine. An external signer is the supported custody boundary for CI: Scrollcase sends the exact
payload on stdin, requires a complete signed envelope on stdout, checks that the returned payload
bytes are identical, and verifies the signature locally before continuing.

For rotation, preserve and identify the outgoing public key first. Generate the incoming key at a
different explicit path, distribute a trust bundle containing both public keys, switch signing
only after consumers trust the incoming key, then retire the outgoing key after the compatibility
window. `keygen --force` is not rotation: it can destroy the only signing identity at a path and
invalidate every document that depended on it.

If a key may be compromised, stop signing with it, distribute a new trust bundle through the
bootstrap channel, and let the consuming project publish and enforce revocation policy. Scrollcase
defines and verifies the document format; it does not distribute or globally enforce it.

## Consumer responsibilities

A conforming consumer still owns transport, archive storage, enough disk headroom, host
compatibility evaluation, safe final extraction, on-demand asset retrieval and hash verification,
channel freshness/anti-replay state, rollout selection, revocation enforcement, activation, and
rollback. If it cannot evaluate a compatibility constraint, it must refuse the box rather than
assume the constraint passes.
