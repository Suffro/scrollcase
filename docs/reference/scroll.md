---
title: The Scroll (scroll.json)
description: Every field of a Scrollcase scroll — identity, target, dependencies, assets, self-test, parity.
---

# The Scroll

A scroll is the only input a build accepts. It is a `scroll.json` checked into your repository,
next to the `pixi.toml` that declares its dependencies and the `pixi.lock` that pins them:

```text
scrolls/
└── my-model/
    └── macos-aarch64-metal/
        ├── scroll.json     # this document
        ├── pixi.toml       # dependency declaration, solved by `scrollcase lock`
        └── pixi.lock       # the pinned result — committed, reviewed, and installed verbatim
```

The parent directory is the scroll's declared `boxId`; the child is the canonical ID computed from
its declared `target`. Scrollcase checks both, so the path cannot mislabel the scroll, but neither
value is written twice inside `scroll.json`. Flat source directories are not accepted in v2.

The machine-readable definition is [`scroll.schema.json`](/schema/v2/scroll.schema.json), also shipped
through the package export. See [JSON Schemas](/reference/schemas).

Create a new target-specific input with `scrollcase new scroll`. The interactive wizard and its
non-terminal flags derive the target layout and Python entry point, generate the matching
`pixi.toml`, and refuse to overwrite an existing scroll.

## A complete example

```json
{
  "$schema": "https://scrollcase.dev/schema/v2/scroll.schema.json",
  "schemaVersion": 2,
  "scrollVersion": "1.0.0",
  "boxId": "hello-box",
  "modelId": "example-org-hello",
  "runtimeId": "hello-box-runtime",
  "version": "1.0.0",
  "sourceRevision": "example-hello-v1",
  "target": { "platform": "macos", "arch": "aarch64", "accelerator": "metal" },
  "compatibility": { "minHostAppVersion": "1.0.0", "minMacosVersion": "13.0", "minRamGb": 1 },
  "pythonVersion": "3.11",
  "pixiVersion": "0.73.0",
  "pythonEntryPoint": "venv/bin/python",
  "modelCacheSubdir": "model-cache/hello",
  "assetBaseUrl": "https://assets.example.org/boxes",
  "assets": [],
  "selfTest": { "imports": ["json", "sqlite3"], "files": [] }
}
```

## Identity

| Field | Required | Meaning |
| --- | --- | --- |
| `schemaVersion` | yes | Always `2`. See [versioning](/reference/box-format#versioning) |
| `scrollId` | no | Provenance identity. When omitted, Scrollcase derives `<boxId>-<targetId>` |
| `scrollVersion` | yes | Version of the scroll itself — bump it when you change how the box is built |
| `boxId` | yes | Identity of the box across versions. Appears in archive names, object keys, and the channel pointer |
| `modelId` | yes | Identity of the packaged model |
| `runtimeId` | yes | Identity of the runtime environment the box provides |
| `version` | yes | Version of the box this scroll produces, as it appears in the release manifest |
| `sourceRevision` | yes | Upstream revision of the packaged source, recorded verbatim into provenance |

`boxId`, `modelId` and `runtimeId` are lowercase identifiers (`^[a-z0-9]+(?:[-.][a-z0-9]+)*$`) in
the published manifests — keep them to that shape.

An explicit `scrollId` lets a project choose its source identity. It may be omitted because `boxId`
and `target` already contain the meaningful identity and the derived value is deterministic.

::: tip Three identifiers, three questions
`boxId` answers *which artefact is this a version of?*, `modelId` answers *what model is inside?*,
and `runtimeId` answers *what environment does it provide?* Several boxes may package the same
model with different runtimes, or the same runtime for different models; keeping the three
separate is what lets a consumer reason about that.
:::

## Target

```jsonc
"target": { "platform": "linux", "arch": "x86_64", "accelerator": "cuda", "cudaVersion": "12.4" }
```

The supported combinations are closed — a target outside this matrix has no defined identifier
and cannot be built, signed, or routed:

| `platform` | `arch` | `accelerator` |
| --- | --- | --- |
| `macos` | `aarch64` | `metal`, `cpu` |
| `linux` | `x86_64` | `cpu`, `cuda` |
| `windows` | `x86_64` | `cpu`, `cuda` |

`cudaVersion` (a `major.minor` string) is **required for and only for** CUDA targets: it is part
of the box's identity, so a CUDA 12.4 build can never be mistaken for a 12.8 one. See
[The Box Format](/reference/box-format#targets) for the resulting target IDs, and
[Packaging CUDA Boxes](/guides/packaging-cuda) for what a CUDA scroll declares.

## Environment

| Field | Required | Meaning |
| --- | --- | --- |
| `pythonVersion` | yes | Python version the box carries, recorded into provenance |
| `pixiVersion` | yes | The exact pixi release used to solve and install. `lock` and `build` refuse any other version |
| `pythonEntryPoint` | yes | Interpreter path relative to the box root. Fixed per target: `venv/bin/python` on macOS and Linux, `venv/python.exe` on Windows — a mismatch is rejected |
| `modelCacheSubdir` | yes | Directory relative to the box root holding model assets |
| `condaDependencyLicenseAudit` | no | Path (from the project root) to the reviewed licence inventory. When declared, the build fails if the lock no longer matches what was reviewed |

The dependencies themselves live in `pixi.toml`, not here:

```toml
[workspace]
name = "hello-box-macos-aarch64-metal"
channels = ["conda-forge"]
platforms = ["osx-arm64"]

[dependencies]
python = "3.11.*"
```

`platforms` must equal the target's conda subdirectory — `osx-arm64`, `linux-64`, or `win-64` —
or the solve produces an environment that cannot run on the machine the box is for.

## Execution intent

`execution` records how a consumer may start the box:

```jsonc
"execution": {
  "kind": "python-script",
  "script": "app/main.py",
  "defaultArgs": ["--serve"]
}
```

or:

```jsonc
"execution": {
  "kind": "python-module",
  "module": "example_model.main",
  "defaultArgs": []
}
```

Omit `execution` for a library-only box. `scrollcase new scroll` presents the three authoring
choices as `python-script`, `python-module`, and `library-only`; the last one deliberately emits no
execution object.

Script authoring either hashes an existing regular project file or generates a minimal starter.
The exact SHA-256 is recorded in `localFiles`, the payload path is traversal-checked, and neither an
existing source nor an existing scroll is overwritten.

The builder copies this object unchanged into both the signed release and `box.json`, then checks
that the script or module is present after staging and pruning. A script must be a safe relative
regular-file path. A module must use strict dotted syntax and resolve to runnable module content in
the box root or the target's Python environment; discovery inspects files and never imports the
application. `verify` repeats the schema, agreement, interpreter, and archive-presence checks
before an optional self-test can run box code.

## Compatibility

Constraints the installing host must satisfy. Scrollcase copies them into the release manifest
**verbatim and never interprets them**, so a project may add its own fields alongside these:

| Field | Meaning |
| --- | --- |
| `minHostAppVersion` | Lowest version of the installing application this box supports |
| `maxHostAppVersionExclusive` | Upper bound, exclusive |
| `minMacosVersion` | Minimum macOS version |
| `minRamGb` | Installed memory in decimal GB (1 GB = 1,000,000,000 bytes) |
| `minNvidiaDriverVersion` | Minimum NVIDIA driver version |

A consumer that cannot evaluate a constraint must refuse the box rather than assume it passes.

## Assets and payload contents

### `assets`

Files fetched over the network during the build. Every entry is size- and hash-checked before it
enters the payload, so a moved or replaced upstream file fails the build instead of quietly
producing a different box under the same version.

```jsonc
"assets": [
  {
    "url": "https://huggingface.co/example-org/model/resolve/main/model.safetensors",
    "relativePath": "model-cache/hello/model.safetensors",
    "sizeBytes": 438012416,
    "sha256": "9f2b…c1"
  }
]
```

Retries inside one download operation resume from a partial file, and a partial transfer is
renamed into place only after its size and hash match. The build scratch tree is recreated at
process start, so there is no cross-process cache. See [Managing Model
Weights](/guides/managing-weights).

### `assetArchives`

Downloaded archives to expand into the payload. Extraction preserves files already present and
refuses to overwrite them.

```jsonc
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

`format` is `zip` or `tar.gz`. Archives are expanded at build time, so they **cannot be combined
with `on-demand` weights** — the build fails rather than declaring a layout that never
materialises.

### `localFiles`

Files copied from your own repository into the payload, each verified against a declared hash so
a licence notice or runtime shim cannot drift from what was reviewed.

```jsonc
"localFiles": [
  { "sourcePath": "runtime/entrypoint.py", "relativePath": "entrypoint.py", "sha256": "4c7e…9a" }
]
```

### `prunePaths`

Payload paths deleted before packing, to keep the box to what it actually needs at run time — a
box is a multi-gigabyte download for an end user, so pruning is a user-facing concern rather than
tidiness.

```jsonc
"prunePaths": ["venv/share/doc", "venv/lib/python3.11/site-packages/numpy/tests"]
```

Each entry is a **literal path** removed recursively — there is no glob support, and a path that
matches nothing is skipped silently. Over-pruning is caught by `selfTest.files`, below.

::: warning Payload paths
Every path inside the payload (`relativePath`, `destination`, `prunePaths`, `selfTest.files`) is
relative and may never escape the payload root. Absolute paths, `..` segments, and drive letters
are rejected.
:::

### `assetBaseUrl`

Base URL the built archive and its objects are published under. It is what the signed release and
channel documents point at. Required unless passed per build with `--asset-base-url`.

## Self-test

Builder checks run with the payload's **own interpreter** before the box is archived. Schema
version 2 signs the import subset for a consumer to repeat; it does not carry the richer file or
`pythonCode` assertions.

```jsonc
"selfTest": {
  "imports": ["torch", "transformers"],
  "files": ["model-cache/hello/model.safetensors"],
  "pythonCode": "import torch; assert torch.backends.mps.is_available()"
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `imports` | yes | One or more modules imported with the box's interpreter. These names are signed and repeated by `verify --self-test` |
| `files` | yes | Files that must still exist after pruning — this is what stops an over-aggressive prune from shipping a broken box. May be empty |
| `pythonCode` | no | Extra Python executed after the imports succeed, for checks a bare import cannot make |

The target's own platform assertion is prepended automatically, and the run happens under the
accelerator's validation environment. A file listed in `files` that is a deliberately deferred
on-demand asset is not required to be present. After pruning, the builder checks required files,
then runs the target assertion, imports, optional `pythonCode`, and finally optional parity. A
consumer runs the target assertion and signed imports only.

## Weights mode

```jsonc
"weights": "embed"
```

`embed` (the default) packs assets into the archive: the box installs with no network and works
air-gapped, at the cost of a large artefact. `on-demand` leaves them out and carries their URL,
path, size and SHA-256 in the signed release. A caller must materialize those files; the local
consumers verify them before execution and do not download them. A build may override this with
`--weights`. See
[Managing Model Weights](/guides/managing-weights).

## Parity (optional)

An optional numerical gate: run a check inside the box on more than one accelerator and require
the results to agree.

```jsonc
"parity": {
  "script": "checks/parity.py",
  "accelerators": ["cpu", "metal"],
  "tolerances": { "absolute": 1e-4, "relative": 1e-3, "minimumCosine": 0.9999 }
}
```

| Field | Meaning |
| --- | --- |
| `script` | Path inside the box, run with the box's own interpreter. Must print a JSON array of numbers, or an object with a `values` array |
| `accelerators` | At least two, each run under its target's validation environment. **The first is the reference** the others are compared against — conventionally `cpu` |
| `tolerances` | At least one bound. `absolute` and `relative` are finite numbers greater than zero; `minimumCosine` is finite and at most 1 |

Every declared threshold is enforced conjunctively: passing one never excuses breaching another.
Scrollcase runs the check and enforces the thresholds; what the check computes, and what closeness
is acceptable, belong to your project. Full treatment in
[Accelerator Parity](/guides/accelerator-parity).

## Validation summary

Validation is ordered so malformed input cannot trigger a process, fetch, or build-directory
mutation:

1. Parse `scroll.json` and validate its complete nested structure against the shipped scroll and
   target schemas.
2. For a nested scroll, require the parent and child directories to match `boxId` and the
   canonical target; reject invalid target/entry-point combinations and default on-demand weights
   with `assetArchives`. Flat scrolls skip only the path-shape check.
3. Resolve a build-time `--weights` override and repeat the archive/policy check.
4. Require a matching native host, discover the exact tools, and require `pixi.lock`.
5. Record Git provenance and reject a dirty tree unless `--allow-dirty` was explicit.
6. Only then recreate build state, install from the lock, download verified assets, and enforce
   semantic checks whose inputs appear later, including lock/audit agreement.
