---
title: Installation
description: Install the Scrollcase CLI, and the pixi + conda-pack toolchain real builds need.
---

# Installation

Scrollcase is a Node.js command line tool. The CLI itself has no native dependencies; building a
box for real additionally needs `pixi` and `conda-pack` on the machine that builds.

## Requirements at a glance

| You want to… | You need |
| --- | --- |
| Run the CLI (`init`, `keygen`, `audit`, `verify`) | Node.js ≥ 20 |
| Resolve a lock (`lock`) or build a box (`build`) | Node.js ≥ 20, `pixi` at the version the recipe pins, `conda-pack` |
| Verify with `--self-test` | The same OS and architecture the box targets |

Locking, auditing, signing, and verifying an existing archive need no toolchain at all — only
`build` and `lock` invoke pixi, and only `build` invokes conda-pack.

## Install the CLI

```sh
npm install -g scrollcase
```

Check the install:

```sh
scrollcase help
```

## Install the toolchain

### pixi

[pixi](https://pixi.sh) solves and installs the conda-forge environment. Every recipe **pins the
exact pixi version** it was locked with (`pixiVersion` in `recipe.json`), and Scrollcase refuses
to run `lock` or `build` with any other version — a different resolver can select different
packages and silently change the box.

Install it following the [pixi installation docs](https://pixi.sh/latest/#installation), for
example:

```sh
curl -fsSL https://pixi.sh/install.sh | sh
```

If you need a specific release to match a recipe's pin, download the matching release from the
pixi GitHub releases page, or use the version-pinned form of the install script documented by
pixi.

### conda-pack

[conda-pack](https://conda.github.io/conda-pack/) turns the installed environment into a
relocatable tree. The recommended install is through pixi itself:

```sh
pixi global install conda-pack
```

## Point Scrollcase at the toolchain

If `pixi` and `conda-pack` are on `PATH`, nothing more is needed. If they live elsewhere — a
dedicated toolchain directory, a CI cache — point Scrollcase at them per invocation:

```sh
scrollcase build my-recipe --pixi /opt/toolchain/bin/pixi --conda-pack /opt/toolchain/bin/conda-pack
```

or once, through the environment:

```sh
export SCROLLCASE_PIXI=/opt/toolchain/bin/pixi
export SCROLLCASE_CONDA_PACK=/opt/toolchain/bin/conda-pack
```

A `--pixi` / `--conda-pack` flag wins over the environment variable, which wins over `PATH`.

## Check the machine

`doctor` reports whether this machine can build, and says exactly what to do about anything
missing. It only reads; it never writes and never touches the network.

```sh
scrollcase doctor --pixi-version 0.73.0
# or take the required pixi version from a recipe:
scrollcase doctor --recipe my-recipe
```

Sample output:

```text
ok    workspace   config /work/my-project/scrollcase.config.json
ok    recipes     /work/my-project/recipes
ok    git         HEAD 3f9c2ab17d42
ok    pixi        pixi at 0.73.0
ok    conda-pack  conda-pack
```

Every check reports rather than aborting at the first failure, so a machine missing both tools
learns both in one run.

::: tip Builds are native
A box is always built on the OS and architecture it ships for: macOS arm64 boxes on an Apple
Silicon Mac, Linux x86_64 boxes on Linux, Windows boxes on Windows. There is no cross-building —
the self-test runs the box's own interpreter, which only proves anything on matching hardware.
:::

## Next

Continue with the [Quickstart](/getting-started/quickstart) to scaffold a project and build your
first box.
