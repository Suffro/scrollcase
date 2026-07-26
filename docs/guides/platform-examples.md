---
title: Platform Examples
description: Minimal target and shell examples for macOS CPU, Linux CPU/CUDA, and Windows CPU/CUDA.
---

# Platform Examples

Every box is built natively for one exact target. These snippets show target declarations and shell
syntax; they do not claim that a particular recipe or scientific workload has been validated.
Replace `my-recipe` and use the exact `pixiVersion` pinned by that recipe.

<Tabs :titles="['macOS CPU', 'Linux CPU', 'Linux CUDA', 'Windows CPU', 'Windows CUDA']">
  <Tab title="macOS CPU">

```jsonc
"target": { "platform": "macos", "arch": "aarch64", "accelerator": "cpu" }
```

```sh
scrollcase doctor --recipe my-recipe
scrollcase lock my-recipe
scrollcase audit my-recipe
scrollcase build my-recipe
```

The interpreter is `venv/bin/python`; the target ID is `macos-aarch64-cpu`.

  </Tab>
  <Tab title="Linux CPU">

```jsonc
"target": { "platform": "linux", "arch": "x86_64", "accelerator": "cpu" }
```

```sh
scrollcase doctor --recipe my-recipe
scrollcase lock my-recipe
scrollcase audit my-recipe
scrollcase build my-recipe
```

The interpreter is `venv/bin/python`; the target ID is `linux-x86_64-cpu`.

  </Tab>
  <Tab title="Linux CUDA">

```jsonc
"target": {
  "platform": "linux",
  "arch": "x86_64",
  "accelerator": "cuda",
  "cudaVersion": "12.4"
}
```

```sh
scrollcase doctor --recipe my-recipe
scrollcase lock my-recipe
scrollcase audit my-recipe
scrollcase build my-recipe
```

`12.4` is an example ABI. The generic target suffix is `cuda<major.minor>`. A successful native
build proves packaging and declared gates, not scientific parity with another accelerator.

  </Tab>
  <Tab title="Windows CPU">

```jsonc
"target": { "platform": "windows", "arch": "x86_64", "accelerator": "cpu" }
```

```powershell
scrollcase doctor --recipe my-recipe
scrollcase lock my-recipe
scrollcase audit my-recipe
scrollcase build my-recipe
```

The interpreter is `venv/python.exe`; the target ID is `windows-x86_64-cpu`.

  </Tab>
  <Tab title="Windows CUDA">

```jsonc
"target": {
  "platform": "windows",
  "arch": "x86_64",
  "accelerator": "cuda",
  "cudaVersion": "12.4"
}
```

```powershell
scrollcase doctor --recipe my-recipe
scrollcase lock my-recipe
scrollcase audit my-recipe
scrollcase build my-recipe
```

Windows CUDA is defined by the target contract and is buildable on a matching native host. This
example is not a claim that a specific box, GPU, driver, or scientific workload is supported.

  </Tab>
</Tabs>

`verify --self-test` also requires the matching native OS and architecture. CPU and CUDA boxes
share neither identity nor implied compatibility; build and verify each target independently.
