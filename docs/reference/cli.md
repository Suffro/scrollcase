---
title: CLI Commands
description: Every Scrollcase command, flag, environment variable, and exit convention.
---

# CLI Commands

```text
scrollcase <command> [options]
```

Nine verbs: `init`, `new`, `doctor`, `keygen`, `lock`, `audit`, `build`, `verify`, `run`.
`scrollcase help` (or no command) prints the full usage text.

Human-facing status lines use a small set of symbols (`✓`, `→`, `·`, `⚠`, `✗`). Their symbols are
coloured only in an interactive terminal; redirected output remains free of ANSI escapes, and
setting `NO_COLOR` disables colour explicitly.

**Flag syntax.** Flags accept `--name value` or `--name=value`; a bare `--name` means `true`.

**Exit convention.** Every failure, anywhere in the pipeline, exits non-zero with a single
`scrollcase: <message>` line on stderr — safe to rely on from shell scripts and CI.

**Workspace flags** (`--config`, `--project-root`, `--scrolls-dir`, `--build-dir`, `--out-dir`,
`--keys-dir`, `--toolchain-dir`) apply to every command and are resolved before anything else runs. They are
documented in [Workspace Configuration](/reference/configuration).

## Scroll arguments and target selection

`lock`, `audit` and `build` accept an exact nested reference:

```sh
scrollcase build hello-box/macos-aarch64-metal
```

They also accept a box ID, with an optional target flag:

```sh
scrollcase build hello-box --target macos-aarch64-metal
```

With only `hello-box`, a terminal shows a navigable target menu for the scrolls under
`scrolls/hello-box/`: use ↑/↓ and Enter. Exactly one target matching the host OS and architecture is
offered as the default; on macOS, Metal is preferred when both CPU and Metal are available. With no
terminal, the same default is selected and reported; any other ambiguous selection fails and tells
the caller to pass `--target`. v2 accepts only the nested
`scrolls/<boxId>/<targetId>/scroll.json` layout.

## `init`

Initialize a workspace and a fixed, disposable `example-box` for the native host. The example is a
complete runnable v2 scroll: Metal on Apple Silicon and CPU on Linux or Windows. It is created
through the normal validated authoring path and never overwritten. It also includes
`consumer-templates/run-box.ts` and `consumer-templates/run_box.py`, which demonstrate the public
Node and Python consumer APIs against a caller-supplied local release and include their setup
commands. If no `package.json` exists, it creates a private one with `"type": "module"`; an
existing package file is never changed. A concise, linked `SCROLLCASE.md` is always created unless
one already exists. Pass `--no-example` to omit `example-box`, the consumer examples, and the Node
package file while retaining the workspace guide.

When it generated the consumer templates, `init` separately asks whether to install their
Node/TypeScript dependencies and whether to install the Python consumer from PyPI with pip or
conda-forge with conda. It also offers to install `pixi` and `conda-pack` if they are missing. Each
question is separated by a blank line, and every answer is collected before the first installer
runs. Without a terminal every answer defaults to no.

```sh
scrollcase init [--pixi-version <version>]
                [--no-example]
                [--install-toolchain | --no-install-toolchain]
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--pixi-version` | example pin | Use this exact pixi release for the example and managed toolchain |
| `--no-example` | off | Initialize an empty workspace without `example-box` |
| `--install-toolchain` | ask | Install missing tools without prompting |
| `--no-install-toolchain` | ask | Never install; just report what is missing |

The final guidance names the example's exact lock command and points to `scrollcase new scroll` for
real project metadata. With `--no-example`, it is simply `Next: scrollcase new scroll`. Target and
product flags passed to `init` are rejected with the same remedy instead of being silently ignored.

### The toolchain step

With neither flag and a terminal attached, `init` prompts, defaulting to **no**. Without a
terminal — CI, a pipe — it never installs and simply reports what is missing: silence is not
consent.

When you agree, `init`:

1. resolves the pixi version — `--pixi-version`, else the example's repository pin; with
   `--no-example`, the installed pixi's or newest release;
2. downloads the release for this host and checks its SHA-256 against the checksum pixi publishes
   beside it. **A mismatch aborts and installs nothing**;
3. installs pixi into the workspace's toolchain directory, then uses it to run
   `pixi global install "conda-pack==0.9.2"` with `PIXI_HOME` pointing there, so both land in the
   project;
4. records the verified pixi digest and the conda-pack version under `toolchain` in
   `scrollcase.config.json`, so later pixi installs are checked against the committed digest — see
   [Workspace Configuration](/reference/configuration#toolchain);
5. keeps each scroll's own `pixiVersion`; the generated example and managed toolchain use the same
   resolved pin.

Nothing is added to `PATH` and nothing is installed system-wide; later commands find the tools
because [tool discovery](#tool-discovery) looks in the toolchain directory. Deleting
`.scrollcase/toolchain/` undoes the whole thing.

The consumer prompts are independent of this managed build toolchain. Accepting the TypeScript
prompt runs npm in the project root to install `scrollcase`, `typescript`, and `tsx`. Accepting the
Python prompt installs `scrollcase-consumer` with either pip or conda-forge. For a PEP 668
externally managed interpreter, `init` retries as a user-scoped installation and keeps package
files outside the managed prefix.

The example follows Scrollcase's supported box target matrix. On another host, initialize with
`--no-example`. Toolchain-only setup can still use any host for which pixi publishes a build.

## `new`

Create one complete `scrolls/<boxId>/<targetId>/` input. With a terminal, free-form values are
prompted and target, weights, execution kind, and script source use navigable menus. Without a
terminal, every material value must be supplied explicitly and missing input fails before anything
is written.

```sh
scrollcase new scroll
scrollcase new scroll \
  --target linux-x86_64-cpu \
  --box-id example-model \
  --model-id example-org-example-model \
  --runtime-id example-runtime \
  --version 1.0.0 \
  --scroll-version 1.0.0 \
  --source-revision upstream-v1 \
  --python-version 3.11.15 \
  --pixi-version 0.73.0 \
  --min-host-app-version 1.0.0 \
  --asset-base-url https://assets.example.org/boxes \
  --weights embed \
  --execution library-only
```

| Flag | Meaning |
| --- | --- |
| `--target` | Complete canonical target; CUDA IDs include the ABI, such as `linux-x86_64-cuda12.4` |
| `--box-id` | Box identity and parent directory |
| `--model-id` | Packaged model identity |
| `--runtime-id` | Runtime identity |
| `--version` | Box version |
| `--scroll-version` | Version of the authoring input |
| `--source-revision` | Upstream revision recorded in provenance |
| `--python-version` | Python dependency version written into `pixi.toml` |
| `--pixi-version` | Exact resolver version required by `lock` and `build` |
| `--min-host-app-version` | Required compatibility floor |
| `--max-host-app-version-exclusive` | Optional compatibility ceiling |
| `--min-macos-version` | Optional macOS floor |
| `--min-ram-gb` | Optional positive RAM requirement |
| `--min-nvidia-driver-version` | Optional NVIDIA driver floor |
| `--asset-base-url` | Base URL copied into built release metadata |
| `--weights` | `embed` or `on-demand` |
| `--execution` | `python-script`, `python-module`, or `library-only` |
| `--script` | Existing project-relative Python script |
| `--generate-script` | Generate a minimal starter instead of using an existing script |
| `--script-destination` | Safe payload path, default `entrypoint.py` |
| `--generated-script-path` | Project path for the generated source; defaults to `box-entrypoints/<boxId>/<targetId>/entrypoint.py` |
| `--module` | Strict dotted Python module name |
| `--default-args` | JSON array of default application arguments |

For `python-script`, choose exactly one of `--script` and `--generate-script`. Scrollcase hashes the
exact source bytes into `localFiles`, refuses traversal and non-regular sources, and never
overwrites an existing source or scroll. Generated defaults are grouped by both box and target;
`library-only` omits execution metadata.

Execution metadata is copied into the signed release and `box.json`. Before archiving, the builder
requires a script to remain a regular payload file or a dotted module to be discoverable in the
built environment without importing it. Library-only scrolls omit the field.

## `doctor`

Report whether this machine can build a box. Reads only; never writes. Each failing check prints
a remedy, and all checks run even when an early one fails.

```sh
scrollcase doctor [--scroll <name>] [--target <targetId>] [--pixi-version <version>]
                  [--pixi <path>] [--conda-pack <path>]
```

Checks: the workspace resolution, the scrolls directory, being inside a git checkout, pixi at the
required version (from `--pixi-version` or `--scroll`; skipped when neither is given), and
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

Resolve the scroll's `pixi.toml` into a fully pinned `pixi.lock`, written next to the manifest.
Run by a human when dependencies change; the lock is committed and reviewed, and `build` then
only installs from it. Requires pixi at the scroll's pinned version.

```sh
scrollcase lock [<scroll>] [--target <targetId>] [--pixi <path>]
```

The manifest itself pins the channels and the single target platform, so resolution does not
depend on the machine doing it.

When `<scroll>` is omitted in an interactive terminal, Scrollcase discovers every valid nested
scroll in the workspace and presents their complete `<boxId>/<targetId>` references in a navigable
menu. A non-interactive caller must provide the reference explicitly.

## `audit`

The dependency licence inventory, derived from the committed `pixi.lock` without building
anything. The lock carries an SPDX licence per package; a package **without a declared licence
fails the parse outright** — an unlicensed dependency is a legal problem, not a reporting gap.

```sh
scrollcase audit <scroll> [--target <targetId>] [--write] [--namespace <ns>]
```

Two modes:

- **Check (default).** If the scroll declares a `condaDependencyLicenseAudit` path, the computed
  inventory is compared byte-for-byte against that reviewed file and any difference fails. This
  is what `build` enforces too, so licence review happens when dependencies change — not at the
  end of a multi-gigabyte build.
- **Write (`--write`).** Write the inventory to the scroll's declared path, for a human to review
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

Turn a scroll into a signed box: install the locked environment, pack and relocate it, stage
assets, prune, audit licences, self-test with the box's own interpreter, run the optional
[parity gate](/guides/accelerator-parity), archive deterministically, and sign a release document
plus a channel pointer. The full pipeline is narrated in
[Architecture](/concepts/architecture).

```sh
scrollcase build [<scroll>] [--target <targetId>]
                 [--channel <name>] [--weights embed|on-demand]
                 [--asset-base-url <url>] [--namespace <ns>] [--allow-dirty]
                 [--pixi <path>] [--conda-pack <path>]
                 [--private-key <path>] [--public-key <path>] [--signer-command <cmd>]
```

As with `lock`, omitting `<scroll>` in an interactive terminal opens the workspace-wide scroll
menu. CI and other non-interactive callers must always provide it explicitly.

| Flag | Default | Meaning |
| --- | --- | --- |
| `--target` | ask when a box has several scrolls | Canonical target scroll to build |
| `--channel` | `beta` | Channel the signed pointer names. The v2 vocabulary is closed to `nightly`, `beta`, and `stable` |
| `--weights` | scroll's `weights`, else `embed` | The navigable menu offers `embed`, which packs assets into the archive (works air-gapped), and `on-demand`, which leaves them out for the caller to materialize; consumers verify them before execution |
| `--asset-base-url` | scroll's `assetBaseUrl` | Base URL the signed documents point at; one of the two must be set |
| `--namespace` | `scrollcase.box` | Document `kind` namespace — a project with boxes already in the field keeps emitting its own |
| `--allow-dirty` | off | Permit a build from an uncommitted tree; recorded as `sourceTreeDirty: true` in the box |
| `--signer-command` | none | Sign through an external command instead of the local key — see [Signing & Key Custody](/guides/signing-and-custody#external-signers) |

Before starting the environment build, Scrollcase checks that signing is ready. If both default
local key files are absent, it fails immediately with `Signing keys not found. Run scrollcase
keygen before building.` The build command never generates identity material itself. An incomplete
pair is never overwritten; an external signer instead requires its trusted public key to be
present.

A successful build ends with a compact relative-path summary: you can distribute the two immutable files
under `boxes/<boxId>/<version>/<targetId>/` and the signed pointer at
`channels/<boxId>/<channel>/<targetId>.json`. The individual content-addressed filenames remain
unchanged.

`build` refuses to run when: the workspace is not a git checkout; the tree is dirty and
`--allow-dirty` is absent; `pixi.lock` is missing; the pixi on hand is not the scroll's pinned
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
| `--archive` | `<archive.sha256>.zip` next to the release document | The archive to check |
| `--self-test` | off | Extract to a temporary directory and import the declared modules with the box's own interpreter. Only runs on a matching native host |
| `--public-key` | `<keys>/signing-public.json` | Trusted key file (a single key, or a `{ "keys": [...] }` bundle) |

Checks, in order: envelope payload hash and at least one trusted signature; release kind; coherent
target and entry point; archive size and SHA-256; safe entry names; recursively equal shared
`box.json` fields (identity/version, full target, entry point, cache subdirectory, consumer
self-test, weights/assets, and provenance); and the declared interpreter. `--self-test`
additionally requires a matching native host, extracts to a temporary directory, checks logical
payload size, and runs the signed import check. It does not repeat scroll-only `pythonCode` or file
assertions, which are builder-only checks.

## `run`

Verify and execute one caller-supplied local release through `scrollcase/consumer`:

```sh
scrollcase run <release.json> [--archive <box.zip>] [--public-key <path>] -- [application args]
```

The command performs the same signature, schema, archive, safe-entry, manifest-agreement, installed
size, interpreter, and execution checks as the Node consumer. It then extracts into a private
temporary directory, prints the signed box ID, version, target and execution kind, attaches terminal
stdio, and runs the declared script or module with the box's own Python. Signed `defaultArgs` come
first; every string after `--` follows unchanged, without a shell.

The child exit code becomes the Scrollcase exit code. `SIGINT`, `SIGTERM`, and `SIGHUP` are forwarded
to the child; after the child terminates, the temporary box is removed and the CLI terminates by the
same signal. Temporary cleanup also runs after verification failure, spawn failure, normal exit, and
non-zero exit.

`run` is intentionally local:

- it never selects a channel or downloads an archive;
- `--archive` names bytes already present on disk, defaulting to the content hash beside the release;
- `--public-key` uses the same trusted key file or bundle as `verify`;
- it refuses library-only releases, non-native targets, and missing or mismatched on-demand assets;
- it never installs persistently, updates an existing box, or owns application lifecycle policy.

Because one-shot `run` does not download or provide an asset-materialization step, an on-demand box
with required assets fails clearly. A caller that already owns those bytes uses
`verifyAndExtractBox`, materializes each signed descriptor under the prepared root, and then calls
`runExtractedBox`.

## Tool discovery {#tool-discovery}

Every command that needs `pixi` or `conda-pack` resolves it the same way, highest precedence
first:

1. **The explicit flag** — `--pixi <path>`, `--conda-pack <path>`.
2. **The environment** — `SCROLLCASE_PIXI`, `SCROLLCASE_CONDA_PACK`.
3. **The project's own toolchain** — `<toolchain>/bin/`, if the executable is there. This is where
   `init` installs, which is why nothing has to be added to `PATH` afterwards.
4. **`PATH`** — the bare `pixi` / `conda-pack` name.

`build` and `lock` additionally require pixi to be at the exact version the scroll pins; a
different version is an error rather than a silent substitution.

## Environment variables

| Variable | Meaning |
| --- | --- |
| `SCROLLCASE_PIXI` | Path to the pixi executable, when not on `PATH`. A `--pixi` flag wins over it |
| `SCROLLCASE_CONDA_PACK` | Path to the conda-pack executable. A `--conda-pack` flag wins over it |
