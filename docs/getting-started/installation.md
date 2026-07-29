---
title: Installation
description: Install the Scrollcase CLI, and the pixi + conda-pack toolchain real builds need.
---

# Installation

Scrollcase is a Node.js command line tool. The CLI itself has no native dependencies; building a
box for real additionally needs `pixi` and `conda-pack` on the machine that builds — and
`scrollcase init` can install those for you, after asking.

The Python consumer is a separate PyPI package. Installing `scrollcase` through npm does not provide
the `scrollcase_consumer` Python module.

## Requirements at a glance

| You want to… | You need |
| --- | --- |
| Scaffold, audit, keygen, or verify without a self-test | Node.js ≥ 20 |
| Resolve a lock (`lock`) | Node.js ≥ 20 and `pixi` at the scroll's pinned version |
| Build a box (`build`) | Node.js ≥ 20, pinned `pixi`, conda-pack, and a local key or external signer |
| Verify with `--self-test` | The same OS and architecture the box targets |
| Consume an existing local box from Python | Python ≥ 3.10 and `scrollcase-consumer` |

Auditing, key generation, signing primitives, and verification need no dependency toolchain.
`lock` invokes pixi; `build` invokes both pixi and conda-pack.

## Install the CLI

```sh
npm install -g scrollcase
```

Check the install:

```sh
scrollcase help
```

## Install the Python consumer

A Python application that only verifies and runs caller-supplied local boxes does not need the
Scrollcase CLI or a Node.js runtime:

```sh
python -m pip install scrollcase-consumer
```

The import name uses an underscore:

```python
from scrollcase_consumer import run_box
```

This package does not build or download boxes. The publishing project builds the box; the consuming
application supplies the local release document, archive, and trusted public key.

## Let Scrollcase install the toolchain

`scrollcase init` initializes a workspace and then **offers** to install what is missing:

```text
This project needs pixi and conda-pack to build a box.
Install them into /work/my-project/.scrollcase/toolchain? [y/N]
```

Nothing is downloaded before you answer, and the default is no. Say yes and Scrollcase installs
both **inside the project**, under `.scrollcase/toolchain/` — nothing is added to `PATH`, nothing
is installed system-wide, and deleting the directory undoes it. Later commands find the tools
there on their own.

What you get is verified, not just fetched:

- the release archive's SHA-256 is checked against the checksum pixi publishes beside it, and a
  mismatch aborts before anything is installed;
- the verified digest is recorded under `toolchain` in `scrollcase.config.json`, so the next
  machine — a teammate's, a CI runner's — is checked against the value **your project committed**
  rather than whatever the server offers that day;
- the generated example and managed toolchain share the same pixi pin; every project scroll created
  by `scrollcase new scroll` still declares its own exact `pixiVersion`.

For unattended setups, answer up front:

```sh
scrollcase init --install-toolchain      # install without asking
scrollcase init --no-install-toolchain   # never install; just report what is missing
scrollcase init --no-example             # initialize without example-box
```

With no terminal to prompt — CI, a pipe — Scrollcase never installs anything and simply reports
what is missing. Silence is not consent.

::: tip Pin the version you want
`--pixi-version 0.73.0` uses exactly that release for both the generated example and an approved
managed install. With `--no-example`, omitting the flag uses the installed release or newest
available release for the workspace toolchain. `new scroll` asks which exact version each project
scroll requires.
:::

## Install the toolchain yourself

If you would rather manage the toolchain — a shared machine, a company mirror, an existing pixi
install — Scrollcase is happy to use it. Install both tools and skip the step above.

### pixi

[pixi](https://pixi.sh) solves and installs the conda-forge environment. Every scroll **pins the
exact pixi version** it was locked with (`pixiVersion` in `scroll.json`), and Scrollcase refuses
to run `lock` or `build` with any other version — a different resolver can select different
packages and silently change the box.

Install it following the [pixi installation docs](https://pixi.sh/latest/#installation), for
example:

```sh
curl -fsSL https://pixi.sh/install.sh | sh
```

If you need a specific release to match a scroll's pin, download the matching release from the
pixi GitHub releases page, or use the version-pinned form of the install script documented by
pixi.

### conda-pack

[conda-pack](https://conda.github.io/conda-pack/) turns the installed environment into a
relocatable tree. The recommended install is through pixi itself:

```sh
pixi global install "conda-pack==0.9.2"
```

Scrollcase's managed installer uses this exact release. `conda-pack --version` currently reports
`0.0.0` regardless of the installed package release, so Scrollcase can pin what it installs but
cannot reliably validate the version of an executable supplied through a flag, environment
variable, or `PATH`.

## Point Scrollcase at the toolchain

If `pixi` and `conda-pack` are on `PATH`, nothing more is needed. If they live elsewhere — a
dedicated toolchain directory, a CI cache — point Scrollcase at them per invocation:

```sh
scrollcase build my-box/linux-x86_64-cpu \
  --pixi /opt/toolchain/bin/pixi \
  --conda-pack /opt/toolchain/bin/conda-pack
```

or once, through the environment:

```sh
export SCROLLCASE_PIXI=/opt/toolchain/bin/pixi
export SCROLLCASE_CONDA_PACK=/opt/toolchain/bin/conda-pack
```

A `--pixi` / `--conda-pack` flag wins over the environment variable, which wins over the
project-local toolchain, which wins over `PATH`.

## Upgrade Pixi intentionally

Changing resolver versions is a dependency change, not a tool repair:

1. edit the scroll's `pixiVersion` to the intended release;
2. initialise or install that exact version with explicit consent, or point `--pixi` at it;
3. run `scrollcase lock <scroll>` and review the new `pixi.lock`;
4. run `scrollcase audit <scroll>` and review/write any intentional licence change;
5. commit the scroll, lock, audit, and toolchain digest;
6. rebuild the box.

Do not delete the pin and accept whichever resolver happens to be newest.

## Check the machine

`doctor` reports whether this machine can build, and says exactly what to do about anything
missing. It only reads; it never writes and never touches the network.

```sh
scrollcase doctor --pixi-version 0.73.0
# or take the required pixi version from a scroll:
scrollcase doctor --scroll my-box/linux-x86_64-cpu
```

Sample output:

```text
ok    workspace   config /work/my-project/scrollcase.config.json
ok    scrolls     /work/my-project/scrolls
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

Continue with the [Quickstart](/getting-started/quickstart) to initialize a workspace, author a
scroll, and build your
first box.
