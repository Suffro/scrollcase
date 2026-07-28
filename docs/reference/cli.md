---
title: CLI Commands
description: Every Scrollcase command, flag, environment variable, and exit convention.
---

# CLI Commands

```text
scrollcase <command> [options]
```

Seven verbs: `init`, `doctor`, `keygen`, `lock`, `audit`, `build`, `verify`. `scrollcase help`
(or no command) prints the full usage text.

Human-facing status lines use a small set of symbols (`✓`, `→`, `·`, `⚠`, `✗`). Their symbols are
coloured only in an interactive terminal; redirected output remains free of ANSI escapes, and
setting `NO_COLOR` disables colour explicitly.

**Flag syntax.** Flags accept `--name value` or `--name=value`; a bare `--name` means `true`.

**Exit convention.** Every failure, anywhere in the pipeline, exits non-zero with a single
`scrollcase: <message>` line on stderr — safe to rely on from shell scripts and CI.

**Workspace flags** (`--config`, `--project-root`, `--recipes-dir`, `--build-dir`, `--out-dir`,
`--keys-dir`, `--toolchain-dir`) apply to every command and are resolved before anything else runs. They are
documented in [Workspace Configuration](/reference/configuration).

## Recipe arguments and target selection

`lock`, `audit` and `build` accept an exact nested reference:

```sh
scrollcase build hello-box/macos-aarch64-metal
```

They also accept a box ID, with an optional target flag:

```sh
scrollcase build hello-box --target macos-aarch64-metal
```

With only `hello-box`, a terminal shows a navigable target menu for the recipes under
`recipes/hello-box/`: use ↑/↓ and Enter. Exactly one target matching the host OS and architecture is
offered as the default; on macOS, Metal is preferred when both CPU and Metal are available. With no
terminal, the same default is selected and reported; any other ambiguous selection fails and tells
the caller to pass `--target`. An existing flat `recipes/<recipe>/recipe.json` remains an exact,
unambiguous recipe reference.

## `init`

Scaffold a project: a `scrollcase.config.json`, one example recipe (with its `pixi.toml`), and
`.gitignore` rules for `.scrollcase/`. Scaffolding **never overwrites** — existing files are
reported as `Kept`, so re-running on a half-configured project completes it.

`init` then offers to install `pixi` and `conda-pack` if they are missing. It downloads nothing
before you say yes.

```sh
scrollcase init [--target <targetId>]
                [--platform macos|linux|windows] [--accelerator cpu|metal|cuda]
                [--cuda-version <major.minor>] [--box-id <name>]
                [--pixi-version <version>]
                [--install-toolchain | --no-install-toolchain]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--target` | ask | Complete canonical target, such as `macos-aarch64-metal` or `linux-x86_64-cuda12.4` |
| `--platform` | this machine | Restrict an interactive target choice to this platform |
| `--accelerator` | ask | Restrict the target choice to one accelerator |
| `--cuda-version` | ask for CUDA | Required `major.minor` ABI component of a CUDA target |
| `--pixi-version` | none | Pin the example recipe to this pixi release, and install exactly that one. Without it, the installed version is pinned for you; declining the install leaves `pixiVersion` for you to set |
| `--box-id` | `example-box` | Box directory and declared `boxId` |
| `--recipe-id` | none | Legacy alias for `--box-id` |
| `--install-toolchain` | ask | Install missing tools without prompting |
| `--no-install-toolchain` | ask | Never install; just report what is missing |

Without `--target`, `init` applies the same target-choice rule described above. On macOS, Metal is
the default; on another host with multiple matching targets, a non-terminal invocation supplies
`--target` or fails before writing anything. The scaffold lands at
`recipes/<boxId>/<targetId>/`.

### The toolchain step

With neither flag and a terminal attached, `init` prompts, defaulting to **no**. Without a
terminal — CI, a pipe — it never installs and simply reports what is missing: silence is not
consent.

When you agree, `init`:

1. resolves the pixi version — `--pixi-version`, else the installed pixi's, else the newest
   release;
2. downloads the release for this host and checks its SHA-256 against the checksum pixi publishes
   beside it. **A mismatch aborts and installs nothing**;
3. installs pixi into the workspace's toolchain directory, then uses it to run
   `pixi global install "conda-pack==0.9.2"` with `PIXI_HOME` pointing there, so both land in the
   project;
4. records the verified pixi digest and the conda-pack version under `toolchain` in
   `scrollcase.config.json`, so later pixi installs are checked against the committed digest — see
   [Workspace Configuration](/reference/configuration#toolchain);
5. writes the installed version into the recipe's `pixiVersion` if it had none.

Nothing is added to `PATH` and nothing is installed system-wide; later commands find the tools
because [tool discovery](#tool-discovery) looks in the toolchain directory. Deleting
`.scrollcase/toolchain/` undoes the whole thing.

Hosts pixi publishes builds for: macOS (arm64, x64), Linux (x64, arm64) and Windows (x64, arm64).
On anything else `init` says so and leaves the install to you.

## `doctor`

Report whether this machine can build a box. Reads only; never writes. Each failing check prints
a remedy, and all checks run even when an early one fails.

```sh
scrollcase doctor [--recipe <name>] [--target <targetId>] [--pixi-version <version>]
                  [--pixi <path>] [--conda-pack <path>]
```

Checks: the workspace resolution, the recipes directory, being inside a git checkout, pixi at the
required version (from `--pixi-version` or `--recipe`; skipped when neither is given), and
conda-pack. The managed installer pins conda-pack 0.9.2; because its `--version` output is not
reliable, `doctor` can only prove that an externally supplied conda-pack executable runs. Exits
non-zero if any check fails.

## `keygen`

Create a local ed25519 signing key pair: a private PEM written with owner-only permissions, and a
public key JSON file used as the trust anchor by `verify`.

```sh
scrollcase keygen [--key-id <id>] [--force]
                  [--private-key <path>] [--public-key <path>]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--key-id` | `scrollcase-<first 16 hex of key hash>` | Identifier recorded in every signature |
| `--force` | off | Overwrite an existing key. Guarded because rotating silently would invalidate every previously signed document |
| `--private-key` | `<keys>/signing-private.pem` | Where the private key is written |
| `--public-key` | `<keys>/signing-public.json` | Where the public key file is written |

See [Signing & Key Custody](/guides/signing-and-custody) for rotation and external signers.
`--force` is not a rotation workflow or a safe way to repair mismatched paths: it can overwrite
the only copy of an established signing identity.

## `lock`

Resolve the recipe's `pixi.toml` into a fully pinned `pixi.lock`, written next to the manifest.
Run by a human when dependencies change; the lock is committed and reviewed, and `build` then
only installs from it. Requires pixi at the recipe's pinned version.

```sh
scrollcase lock <recipe> [--target <targetId>] [--pixi <path>]
```

The manifest itself pins the channels and the single target platform, so resolution does not
depend on the machine doing it.

## `audit`

The dependency licence inventory, derived from the committed `pixi.lock` without building
anything. The lock carries an SPDX licence per package; a package **without a declared licence
fails the parse outright** — an unlicensed dependency is a legal problem, not a reporting gap.

```sh
scrollcase audit <recipe> [--target <targetId>] [--write] [--namespace <ns>]
```

Two modes:

- **Check (default).** If the recipe declares a `condaDependencyLicenseAudit` path, the computed
  inventory is compared byte-for-byte against that reviewed file and any difference fails. This
  is what `build` enforces too, so licence review happens when dependencies change — not at the
  end of a multi-gigabyte build.
- **Write (`--write`).** Write the inventory to the recipe's declared path, for a human to review
  and commit. Writing is explicit because silently overwriting the reviewed file is exactly how
  an unreviewed licence change would slip through.

`--namespace` sets the namespace of the inventory's `kind`
(`<namespace>.dependency-license-audit`, default `scrollcase.box`).

Output is a per-licence package count, for example:

```text
23 packages for hello-box-macos-aarch64-metal (macos-aarch64-metal)
    9  MIT
    4  Apache-2.0
    ...
```

## `build`

Turn a recipe into a signed box: install the locked environment, pack and relocate it, stage
assets, prune, audit licences, self-test with the box's own interpreter, run the optional
[parity gate](/guides/accelerator-parity), archive deterministically, and sign a release document
plus a channel pointer. The full pipeline is narrated in
[Architecture](/concepts/architecture).

```sh
scrollcase build <recipe> [--target <targetId>]
                 [--channel <name>] [--weights embed|on-demand]
                 [--asset-base-url <url>] [--namespace <ns>] [--allow-dirty]
                 [--pixi <path>] [--conda-pack <path>]
                 [--private-key <path>] [--public-key <path>] [--signer-command <cmd>]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--target` | ask when a box has several recipes | Canonical target recipe to build |
| `--channel` | `beta` | Channel the signed pointer names. The menu suggests `beta`, `stable`, and `nightly`; an explicit flag may supply a custom project channel |
| `--weights` | recipe's `weights`, else `embed` | The navigable menu offers `embed`, which packs assets into the archive (works air-gapped), and `on-demand`, which leaves them out for the consumer to fetch and verify at install time |
| `--asset-base-url` | recipe's `assetBaseUrl` | Base URL the signed documents point at; one of the two must be set |
| `--namespace` | `scrollcase.box` | Document `kind` namespace — a project with boxes already in the field keeps emitting its own |
| `--allow-dirty` | off | Permit a build from an uncommitted tree; recorded as `sourceTreeDirty: true` in the box |
| `--signer-command` | none | Sign through an external command instead of the local key — see [Signing & Key Custody](/guides/signing-and-custody#external-signers) |

Before starting the environment build, Scrollcase checks that signing is ready. If both default
local key files are absent, it fails immediately with `Signing keys not found. Run scrollcase
keygen before building.` The build command never generates identity material itself. An incomplete
pair is never overwritten; an external signer instead requires its trusted public key to be
present.

A successful build ends with a compact relative-path summary: distribute the two immutable files
under `boxes/<boxId>/<version>/<targetId>/` and the signed pointer at
`channels/<boxId>/<channel>/<targetId>.json`. The individual content-addressed filenames remain
unchanged.

`build` refuses to run when: the workspace is not a git checkout; the tree is dirty and
`--allow-dirty` is absent; `pixi.lock` is missing; the pixi on hand is not the recipe's pinned
version; or the host OS/architecture does not match the target — boxes are proven on the hardware
they ship for. Dirty detection includes untracked files and excludes files ignored by Git.

Outputs, under the workspace's `dist` directory:

| File | What it is |
| --- | --- |
| `boxes/<boxId>/<version>/<targetId>/<archive sha256>.zip` | The box archive |
| `boxes/<boxId>/<version>/<targetId>/<document sha256>.release.json` | The signed release document committing to the archive by size and SHA-256 |
| `channels/<boxId>/<channel>/<targetId>.json` | The signed channel pointer |

`boxes/` is uploaded as it stands — the paths are the keys the signed documents already point to.
`channels/` is separate because a channel outlives any one version. See
[Distributing Boxes](/guides/distributing-boxes).

## `verify`

Run the format checks a consumer can repeat against a signed release document and its archive,
before anything is published.

```sh
scrollcase verify <release.json> [--archive <path>] [--self-test] [--public-key <path>]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--archive` | `<stem>.zip` next to the release document | The archive to check |
| `--self-test` | off | Extract to a temporary directory and import the declared modules with the box's own interpreter. Only runs on a matching native host |
| `--public-key` | `<keys>/signing-public.json` | Trusted key file (a single key, or a `{ "keys": [...] }` bundle) |

Checks, in order: envelope payload hash and at least one trusted signature; release kind; coherent
target and entry point; archive size and SHA-256; safe entry names; recursively equal shared
`box.json` fields (identity/version, full target, entry point, cache subdirectory, consumer
self-test, weights/assets, and provenance); and the declared interpreter. `--self-test`
additionally requires a matching native host, extracts to a temporary directory, checks logical
payload size, and runs the signed import check. It does not repeat recipe-only `pythonCode` or file
assertions, which schema version 1 does not carry.

## Tool discovery {#tool-discovery}

Every command that needs `pixi` or `conda-pack` resolves it the same way, highest precedence
first:

1. **The explicit flag** — `--pixi <path>`, `--conda-pack <path>`.
2. **The environment** — `SCROLLCASE_PIXI`, `SCROLLCASE_CONDA_PACK`.
3. **The project's own toolchain** — `<toolchain>/bin/`, if the executable is there. This is where
   `init` installs, which is why nothing has to be added to `PATH` afterwards.
4. **`PATH`** — the bare `pixi` / `conda-pack` name.

`build` and `lock` additionally require pixi to be at the exact version the recipe pins; a
different version is an error rather than a silent substitution.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `SCROLLCASE_PIXI` | Path to the pixi executable, when not on `PATH`. A `--pixi` flag wins over it |
| `SCROLLCASE_CONDA_PACK` | Path to the conda-pack executable. A `--conda-pack` flag wins over it |
