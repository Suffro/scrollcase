---
title: Workspace Configuration
description: scrollcase.config.json — where recipes live and where builds, artefacts and keys go.
---

# Workspace Configuration

Paths come from the project, not from Scrollcase. A `scrollcase.config.json` at the project root
declares where recipes live and where Scrollcase writes what it builds; the CLI discovers it by
walking up from the working directory, so every command works from anywhere inside the project.

A project that declares nothing gets sensible defaults — the config file exists for projects that
already keep their recipes elsewhere, or that adopted Scrollcase after building their own
convention.

## The file

```json
{
  "version": 1,
  "paths": {
    "recipes": "recipes",
    "build": ".scrollcase/build",
    "dist": ".scrollcase/dist",
    "keys": ".scrollcase/keys",
    "toolchain": ".scrollcase/toolchain"
  }
}
```

| Key | Default | What lives there |
| --- | --- | --- |
| `paths.recipes` | `recipes` | One directory per recipe, each holding `recipe.json`, `pixi.toml`, and the committed `pixi.lock` |
| `paths.build` | `.scrollcase/build` | Payload scratch space, wiped and regenerated on every build |
| `paths.dist` | `.scrollcase/dist` | Built artefacts: archives, signed documents, and the content-addressed `objects/` staging tree |
| `paths.keys` | `.scrollcase/keys` | Local signing keys (`signing-private.pem`, `signing-public.json`) |
| `paths.toolchain` | `.scrollcase/toolchain` | `pixi` and `conda-pack`, when `init` installed them for the project |

Rules:

- `version` is optional, but when present must be `1`.
- Every `paths` entry is optional; an omitted entry falls back to its default.
- Unknown `paths` keys, non-string values, and malformed JSON are hard errors — a typo fails
  loudly rather than being silently ignored behind defaults.
- Relative paths in the config resolve **against the project root** (the config's directory), so
  the file is portable across machines and checkouts.

Commit the config and the recipes; never commit `.scrollcase/` (build state and artefacts are
regenerated, and the private key must not enter history — `init` writes the ignore rules for
you).

## Discovery and precedence

The project root is chosen with this precedence, highest first:

1. `--project-root <dir>` — treat this directory as the root.
2. The directory of an explicit `--config <file>`. A named config that does not exist is a hard
   error.
3. The nearest `scrollcase.config.json` found walking up from the working directory.
4. The working directory itself (defaults apply).

Each individual path is then resolved with its own precedence, highest first:

1. **CLI flag** — `--recipes-dir`, `--build-dir`, `--out-dir`, `--keys-dir`. Flag values resolve
   against the **current working directory**, which is what a shell user expects.
2. **Config value** — resolves against the **project root**.
3. **Built-in default** — resolves against the project root.

| Flag | Overrides |
| --- | --- |
| `--config <file>` | Use this workspace config explicitly |
| `--project-root <dir>` | Treat this directory as the project root |
| `--recipes-dir <dir>` | `paths.recipes` |
| `--build-dir <dir>` | `paths.build` |
| `--out-dir <dir>` | `paths.dist` |
| `--keys-dir <dir>` | `paths.keys` |
| `--toolchain-dir <dir>` | `paths.toolchain` |

## Examples

Run against the example recipes shipped in the Scrollcase repository, from your own project:

```sh
scrollcase build hello-box-macos-arm64-metal --recipes-dir ../scrollcase/examples
```

A monorepo that keeps packaging assets under `packaging/`:

```json
{
  "version": 1,
  "paths": {
    "recipes": "packaging/recipes",
    "build": "packaging/.build",
    "dist": "packaging/dist",
    "keys": "packaging/keys"
  }
}
```

Note that the git checkout the build records its provenance from is the **project root** — the
box's `builderRevision` is the HEAD of the repository the workspace resolves to.

## The toolchain pin {#toolchain}

When [`init` installs the toolchain](/reference/cli#the-toolchain-step) it adds a `toolchain`
block recording the digest it verified:

```json
{
  "version": 1,
  "paths": { "…": "…" },
  "toolchain": {
    "pixi": {
      "version": "0.73.0",
      "assets": {
        "pixi-aarch64-apple-darwin.tar.gz": "63e7cc91ef10eda71765c42e951362a084b2cbcbc93fb55c375c4f3acbfd7d00"
      }
    }
  }
}
```

**Commit this block.** The first install trusts the checksum published beside the release; every
install after it is checked against the value recorded here, so a teammate or a CI runner cannot
silently receive different bytes under the same version. One entry accumulates per host asset, so
a team on mixed platforms ends up with a pin for each.

Scrollcase writes the block itself; you never have to author it. Changing the pinned version means
deleting the entry (or the `.scrollcase/toolchain/` directory) and re-running `init`.
