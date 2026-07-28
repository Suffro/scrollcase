---
title: Managing Model Weights
description: Declare, verify, embed or defer the assets a box carries.
---

# Managing Model Weights

Model weights are usually the largest thing a box carries, and the only part fetched from a
server nobody controls. Scrollcase treats them the same way it treats everything else: declared
up front, verified before use, and committed to by hash in the signed release.

## Declare an asset

Every asset carries a URL, a destination inside the payload, a size, and a SHA-256:

```jsonc
"assets": [
  {
    "url": "https://huggingface.co/example-org/model/resolve/main/model.safetensors",
    "relativePath": "model-cache/hello/model.safetensors",
    "sizeBytes": 438012416,
    "sha256": "9f2b7c1e04a83d5641b0e7c28a3d95f7c9d1a4e60b8f37c25e9a4d7081da5b3f"
  }
]
```

Get the size and hash from the file you reviewed:

```sh
curl -fL -o model.safetensors "https://…/model.safetensors"
shasum -a 256 model.safetensors     # sha256sum on Linux
wc -c < model.safetensors
```

Nothing enters the payload before **both** match. That is what makes a box reproducible even
though its inputs live on servers outside anyone's control: if an upstream file is moved,
replaced, or silently re-uploaded, the build fails instead of quietly producing a different box
under the same version.

::: tip Resume boundary
A dropped connection is retried inside one download operation, resuming its `.part` file with a
Range request. The partial is renamed only after size and hash match. Build scratch is recreated
at process start, so a new build process does not reuse an earlier partial or provide a persistent
asset cache.
:::

## Archives that need unpacking

When the upstream artefact is a tarball or zip, declare it as an asset and then expand it:

```jsonc
"assets": [
  {
    "url": "https://example.org/model/weights-v1.tar.gz",
    "relativePath": "model-cache/hello/weights.tar.gz",
    "sizeBytes": 1073741824,
    "sha256": "4c7e…9a"
  }
],
"assetArchives": [
  {
    "relativePath": "model-cache/hello/weights.tar.gz",
    "format": "tar.gz",
    "destination": "model-cache/hello",
    "stripComponents": 1,
    "removeAfterExtract": true
  }
]
```

- Entries are listed and validated **before** extraction, so a malicious archive cannot write
  outside its destination.
- `stripComponents` drops the redundant top-level wrapper directory many published archives
  carry. It insists on finding exactly one directory to strip, so a surprising layout fails
  loudly rather than producing a wrong tree.
- Extraction never overwrites a file already present in the destination.
- `removeAfterExtract` defaults to `true`: the compressed original is dead weight inside the
  payload once unpacked.

## Files from your own repository

Runtime shims, licence notices, a parity check script — anything you maintain yourself — go in
`localFiles`, each with a hash so it cannot drift from what was reviewed:

```jsonc
"localFiles": [
  { "sourcePath": "runtime/entrypoint.py", "relativePath": "entrypoint.py", "sha256": "…" },
  { "sourcePath": "legal/MODEL_LICENSE.txt", "relativePath": "MODEL_LICENSE.txt", "sha256": "…" }
]
```

`sourcePath` is relative to the project root; `relativePath` is inside the payload.

## Embed or defer

This is the one real decision, and it is per build:

| | `embed` (default) | `on-demand` |
| --- | --- | --- |
| Assets live | inside the archive | on your asset host |
| Install needs network | no — **works air-gapped** | yes |
| Archive size | large | small |
| Integrity guaranteed by | the archive's own signed hash | the per-asset size + SHA-256 in the signed release |

```sh
scrollcase build my-model --weights embed        # the default
scrollcase build my-model --weights on-demand
```

A scroll may set `"weights": "embed" | "on-demand"` as its own default; the flag overrides it.

### What `on-demand` puts in the release

The assets are left out of the archive, and their descriptors travel in the signed release and in
`box.json`:

```jsonc
"weights": "on-demand",
"assets": [
  { "url": "https://…/model.safetensors", "relativePath": "model-cache/hello/model.safetensors",
    "sizeBytes": 438012416, "sha256": "9f2b…3f" }
]
```

The declared hash is what makes deferring safe: the release **commits to exactly which bytes the
box expects**, whatever host serves them. A consumer fetches each asset, checks size and hash,
and places it at `relativePath` under the box root before first use.

::: warning Two constraints
`on-demand` cannot be combined with `assetArchives` — archives are expanded at build time, so
deferring them would declare a layout that never materialises; the build fails rather than lie.
And a file listed in `selfTest.files` that is a deferred asset is legitimately absent from the
payload, so it is skipped by the post-prune check.
:::

### Choosing

Embedding is the default because air-gapped installation is a property worth keeping unless a
project explicitly trades it away, and because it is the behaviour that surprises nobody: what
you verified is what you install.

Defer when the archive would otherwise be unreasonable to move around, when the same weights are
shared by several boxes, or when your asset host is already the thing your users download from.
Then read [Offline / Air-Gapped Installs](/guides/offline-airgap) to understand what you gave up.

## Keeping the box small

Everything the environment does not need at run time can be pruned before packing:

```jsonc
"prunePaths": [
  "venv/share/doc",
  "venv/lib/python3.11/site-packages/numpy/tests",
  "venv/lib/python3.11/site-packages/scipy/io/tests"
]
```

::: warning Literal paths, not globs
Each entry is a single path removed recursively — there is no pattern matching. A glob such as
`.../**/tests` matches nothing and is removed silently, so list the directories explicitly and
check the resulting archive size to confirm the prune did what you expected.
:::

Guard against over-pruning by listing what must survive:

```jsonc
"selfTest": {
  "imports": ["torch", "numpy"],
  "files": ["model-cache/hello/model.safetensors", "entrypoint.py"]
}
```

A box is a multi-gigabyte download for an end user, so pruning is a user-facing concern rather
than tidiness — but a box that unpacks and cannot run is worse than a large one. The self-test
runs after pruning, with the box's own interpreter, precisely to catch that.

## Where assets live inside the box

`modelCacheSubdir` names the directory holding model assets, relative to the box root
(`model-cache/hello` above). Keep asset `relativePath` values under it so an installed box has
one obvious place where its weights are, and a consumer can find them without parsing anything.
