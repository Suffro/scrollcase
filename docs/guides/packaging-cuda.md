---
title: Packaging CUDA Boxes
description: Build a GPU box whose CUDA ABI is part of its identity, and prove it is really a GPU build.
---

# Packaging CUDA Boxes

A CUDA box is an ordinary box with one extra property: the CUDA ABI it was built against is part
of its identity, so a CUDA 12.4 build can never be mistaken for a 12.8 one. This page covers what
a CUDA recipe declares, and how to prove the result is genuinely a GPU build rather than CPU
wheels wearing a CUDA name.

## Supported CUDA targets

| `platform` | `arch` | `accelerator` | Target ID |
| --- | --- | --- | --- |
| `linux` | `x86_64` | `cuda` | `linux-x86_64-cuda<major.minor>` |
| `windows` | `x86_64` | `cuda` | `windows-x86_64-cuda<major.minor>` |

macOS has no CUDA target — use `metal`. The `12.4` values below are one concrete example, not the
only CUDA ABI the contract accepts.

## The recipe

```json
{
  "schemaVersion": 1,
  "recipeVersion": "1.0.0",
  "boxId": "my-model",
  "modelId": "example-org-my-model",
  "runtimeId": "my-model-runtime",
  "version": "1.0.0",
  "sourceRevision": "my-model-v1.2.0",
  "target": {
    "platform": "linux",
    "arch": "x86_64",
    "accelerator": "cuda",
    "cudaVersion": "12.4"
  },
  "compatibility": {
    "minHostAppVersion": "1.0.0",
    "minNvidiaDriverVersion": "550.54.14",
    "minRamGb": 16
  },
  "pythonVersion": "3.11",
  "pixiVersion": "0.73.0",
  "pythonEntryPoint": "venv/bin/python",
  "modelCacheSubdir": "model-cache/my-model",
  "assetBaseUrl": "https://assets.example.org/boxes",
  "assets": [],
  "selfTest": {
    "imports": ["torch"],
    "files": [],
    "pythonCode": "import torch; assert torch.cuda.is_available(), 'CUDA runtime not usable'; assert torch.version.cuda.startswith('12.4')"
  }
}
```

Three things are CUDA-specific:

1. **`cudaVersion`** — `major.minor`, required for a CUDA target and forbidden on any other. It
   becomes part of the target ID, the archive name, and the object key.
2. **`minNvidiaDriverVersion`** in `compatibility` — copied verbatim into the release manifest for
   the installing host to check. Scrollcase never interprets it.
3. **A `pythonCode` self-test that actually exercises the GPU** — see below.

## The pixi manifest

The solve is where a CUDA box is really made or broken. `platforms` must be the target's conda
subdirectory, and the CUDA version is declared both as a package pin and as a system requirement,
so the solver picks the GPU build rather than the CPU one:

```toml
[workspace]
name = "my-model-linux-x86_64-cuda12.4"
channels = ["conda-forge"]
platforms = ["linux-64"]

[system-requirements]
cuda = "12.4"

[dependencies]
python = "3.11.*"
pytorch = { version = "2.*", build = "cuda*" }
cuda-version = "12.4.*"
```

Then resolve and commit the lock:

```sh
scrollcase lock my-model/linux-x86_64-cuda12.4
git add recipes/my-model/linux-x86_64-cuda12.4/pixi.lock
```

Run those commands with Pixi `0.73.0`, because that is the exact version this example recipe pins;
do not substitute another resolver version.

::: warning `cuda-version` pins the ABI, not the driver
The `cuda-version` package constrains which CUDA runtime the conda-forge packages are built
against. The host still needs a driver new enough for that ABI — that is what
`minNvidiaDriverVersion` communicates to the installer.
:::

## Building

CUDA boxes, like all boxes, are **built natively**: a `linux-x86_64-cuda12.4` box is built on
Linux x86_64. There is no cross-building, because the self-test runs the box's own interpreter,
and that only proves anything on matching hardware.

```sh
scrollcase doctor --recipe my-model/linux-x86_64-cuda12.4
scrollcase build my-model/linux-x86_64-cuda12.4
```

The self-test runs under the target's CUDA validation environment
(`CUDA_VISIBLE_DEVICES=0`), so a `torch.cuda.is_available()` assertion is meaningful.

::: tip A GPU is needed to build, not just to run
Solving a CUDA environment does not require a GPU, but a self-test that asserts
`torch.cuda.is_available()` does. Build CUDA boxes on a GPU machine — otherwise weaken the
self-test to something that passes without a device, and you lose the check that matters most.
:::

## Proving it is really a GPU build

The failure this guide exists to prevent is a box that solves, packs, installs, and then runs on
the CPU — CPU-only wheels shipped under a CUDA target ID. Three layers catch it:

**1. The self-test.** The cheapest and most direct:

```jsonc
"pythonCode": "import torch; assert torch.cuda.is_available(); assert torch.version.cuda.startswith('12.4')"
```

**2. The parity gate.** Run a real computation on CPU and on CUDA and require the results to
agree within a declared tolerance:

```jsonc
"parity": {
  "script": "checks/parity.py",
  "accelerators": ["cpu", "cuda"],
  "tolerances": { "absolute": 1e-4, "relative": 1e-3, "minimumCosine": 0.9999 }
}
```

This catches a broken BLAS, a mis-solved kernel, and a GPU path that silently falls back — see
[Accelerator Parity](/guides/accelerator-parity).

**3. `verify --self-test`.** Extracts the built archive and re-runs the signed imports with the
box's own interpreter, on a matching native host:

```sh
scrollcase verify .scrollcase/dist/boxes/my-model/1.0.0/linux-x86_64-cuda12.4/*.release.json --self-test
```

This consumer check does **not** repeat recipe `pythonCode`, so it does not by itself prove
`torch.cuda.is_available()`. That stronger assertion and parity are builder gates. Building a
target proves packaging and declared gates; it never proves scientific parity unless the recipe
declares and passes a suitable parity check.

## One box per CUDA ABI

Because `cudaVersion` is part of the identity, supporting two ABIs means two recipes, two locks,
two boxes:

```text
recipes/
└── my-model/
    ├── linux-x86_64-cuda12.4/
    └── linux-x86_64-cuda12.8/
```

They share a `boxId` and `version` and differ in target, so they publish under distinct object
keys and a client picks the one matching its driver:

```text
boxes/my-model/1.0.0/linux-x86_64-cuda12.4/…
boxes/my-model/1.0.0/linux-x86_64-cuda12.8/…
```

## Size

CUDA environments are large — the runtime libraries alone can dominate the archive. Prune what
the box does not need at run time, and let the self-test guard the prune:

```jsonc
"prunePaths": [
  "venv/share/doc",
  "venv/lib/python3.11/site-packages/torch/test",
  "venv/lib/python3.11/site-packages/torch/include"
],
"selfTest": { "imports": ["torch"], "files": [], "pythonCode": "import torch; assert torch.cuda.is_available()" }
```

See [Managing Model Weights](/guides/managing-weights#keeping-the-box-small) for the general
approach, and consider `--weights on-demand` when the weights, rather than the runtime, are what
makes the archive unwieldy.
