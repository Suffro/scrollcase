---
title: Library APIs
description: The Node and Python surfaces for contracts, local consumers, build primitives, and signing.
---

# Library APIs

The CLI is the supported way to run the build pipeline. The Node package additionally exports five
modules for clients that need to understand, prepare, or execute local boxes: validate a document,
derive a target ID, check a signature, resolve a workspace, or run a verified application.

```js
import { boxTargetId, documentKinds } from 'scrollcase/contract';
import { isSignedBoxDocument } from 'scrollcase/contract/browser';
import { sha256File, resolveWorkspace } from 'scrollcase/build';
import {
  verifyAndExtractBox, attachExtractedBox, verifyExtractedPayload, runExtractedBox, runBox,
} from 'scrollcase/consumer';
import { verifySignedDocument } from 'scrollcase/sign';
```

The JSON Schemas and golden fixtures are exported as files too:

```js
import scrollSchema from 'scrollcase/contract/schema/scroll.schema.json' with { type: 'json' };
import targetCases from 'scrollcase/contract/fixtures/target-id-contract.json' with { type: 'json' };
```

## TypeScript types

The box format's types are **generated from the JSON Schemas** and shipped with the package:

```ts
import type {
  BoxTarget,
  BoxScroll,
  BoxManifest,
  BoxReleaseManifest,
  BoxChannelManifest,
  BoxRevocationsManifest,
  SignedBoxDocument,
} from 'scrollcase/contract/types';

const target: BoxTarget = {
  platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4',
};
```

The schemas are the source of truth; these types are a projection of them, never a second
definition. A schema change that is not accompanied by `npm run types` fails the test suite, so
the two cannot drift — the same discipline that makes the licence audit a function of the lock.

This subpath is **types only**: there is nothing to import at runtime, so use `import type`.
`scrollcase/contract`, `scrollcase/contract/browser`, `scrollcase/build`,
`scrollcase/consumer`, and `scrollcase/sign` also ship declarations generated from the typed JSDoc
beside their JavaScript implementations. Strict TypeScript consumers therefore get checked
parameters, return values, narrowing guards, hover documentation, and completion without a build
step or a separate types package. `npm run types:check` fails if either the schema-derived format
types or the runtime declarations drift from their source.

::: info The pipeline verbs are CLI-only
`build`, `verify`, `audit`, `lock`, `init`, `new scroll`, and `doctor` are not part of the exported surface.
They orchestrate a process — spawning pixi, writing a workspace, exiting non-zero — and are
driven through `scrollcase <verb>`. What is exported is what a *consumer* of boxes needs.
:::

## `scrollcase/consumer`

The Node consumer prepares and executes release documents and archives already present on the local
machine. Every path and trust anchor comes from the caller. It never selects a channel, downloads an
archive or asset, installs globally, updates an existing destination, or applies application
lifecycle policy.

```js
import {
  attachExtractedBox,
  verifyAndExtractBox,
  verifyExtractedPayload,
  runExtractedBox,
  runBox,
} from 'scrollcase/consumer';

const prepared = await verifyAndExtractBox('release.json', {
  publicPath: 'trusted-keys.json',
  archive: 'box.zip',
  destination: '/srv/boxes/example-1.0.0',
});

const result = await runExtractedBox(prepared, {
  args: ['--port', '8080'],
  env: { APPLICATION_MODE: 'local' },
  stdin: 'ignore',
  stdout: 'inherit',
  stderr: 'inherit',
});
```

### Preparation

`verifyAndExtractBox(releaseDocumentPath, { publicPath, archive, destination })` verifies the signed
document against a single trusted-key file or key bundle, validates the v2 release, checks archive
size and SHA-256, rejects unsafe ZIP entries, extracts through the shared safe extractor, compares
`box.json` recursively with the signed release, checks logical installed size and execution
prerequisites, then atomically renames a fresh staging tree into `destination`. The destination must
not exist.

It returns an immutable `PreparedBox` receipt with signed identity, target, execution, archive and
signing information, plus `environmentReport`, a masked diagnostic snapshot of this process's host
environment resolved against the signed declaration. The receipt is process-bound:
`runExtractedBox` rejects copied or constructed
lookalikes, and also rejects a prepared root replaced after verification.

For `on-demand` weights, `prepared.requiredAssets` contains the signed URL, relative path, size and
SHA-256 descriptors. Scrollcase does not fetch them. The caller may materialize those files under
`prepared.root`; execution refuses a missing, non-regular, wrong-size, or wrong-hash asset.

### Re-attaching across restarts

A `PreparedBox` is bound to the process that produced it, so a long-lived application cannot keep
one across a restart — and re-extracting gigabytes at every launch is not an answer.
`attachExtractedBox(releaseDocumentPath, { publicPath, root })` mints a fresh receipt from a
directory that is already extracted, without the archive.

It verifies the signed document, requires a target this host can run, checks that the interpreter
and execution files are present, and re-checks on-demand assets against their signed hashes. It does
not read original payload file contents, though it enumerates paths and measures their metadata, so
its original-payload work scales with entry count rather than byte size. Required on-demand assets
are hashed in full. The receipt it returns carries
`status: 'attached'` rather than `'prepared'`, because the bytes on disk were not proved — only the
release, and the shape of the directory. Its `environmentReport` is produced by the same resolver as
preparation. `runExtractedBox` accepts either.

`root` must be a real directory; a symbolic link is refused, since execution requires a real one.

### Verifying an installation

`verifyExtractedPayload(releaseDocumentPath, { publicPath, root })` proves the tree on disk is the
one the release describes. New boxes carry `payload-digest.v1`, an entry list naming each original
payload path with the SHA-256 of its content, and the signed release commits to that list's own hash.
Verification hashes the list, compares it with the release, parses it only then, and checks each
listed path — walking the list, never the directory, so files that appear after installation
(`__pycache__`, the model cache, anything the application writes in its working directory) are
simply never visited.

It is standalone and opt-in: no other operation calls it, because it reads every listed byte. Call
it after installing, on a user's request, or in a maintenance job. Embedded weights are listed and
can make the check read tens of gigabytes; on-demand assets are later extras and keep their separate
signed per-file verification. File mode and modification time are deliberately not committed. A
release built before this field existed is refused rather than silently treated as verified.
The returned `PayloadVerification` also carries `environmentReport`; it describes the inspecting
process, not the payload bytes that were just checked.

::: warning What it does and does not prove
It binds a directory to a signed release and detects corruption. It is not a defence against a local
attacker: the tree can change between this call and any later import, and no library can close that
window — filesystem permissions can, and they belong to the operating system and to your
application. Scrollcase does not guard the directory afterwards.

The build collector excludes `__pycache__` directories and `*.pyc` files, so the digest cannot make
any assertion about them. That is a permanent blind spot, not only a timing window.
:::

### Execution

`runExtractedBox(prepared, options)` runs only a receipt returned by
`verifyAndExtractBox` or `attachExtractedBox` in the current process. It rechecks the prepared tree and required assets,
enforces the native target, starts the declared script or `-m` module with the box's own Python,
uses the box root as `cwd`, and appends caller `args` after signed `defaultArgs`. It never invokes a
shell.

`stdin`, `stdout`, and `stderr` accept Node child-process stdio values or streams. Environment
precedence is inherited host, then caller `env`, then signed release `environment`; later layers win
without filtering any inherited name. `SIGINT`, `SIGTERM`, and `SIGHUP` are forwarded while the
child is alive. The returned `{ exitCode, signal, environmentReport }` preserves the child's
terminal result and the exact diagnostic used for that spawn.

`runBox(releaseDocumentPath, options)` composes preparation and execution in a private temporary
directory and guarantees cleanup after a normal exit, non-zero exit, spawn failure, or forwarded
signal. `temporaryDirectory` selects the parent for that private root; `onPrepared` is an optional
callback invoked after verification and extraction but before execution, which lets a CLI display
the signed identity without reimplementing or repeating the trust chain:

```js
const result = await runBox('release.json', {
  publicPath: 'trusted-keys.json',
  archive: 'box.zip',
  args: ['--once'],
  onPrepared: ({ boxId, version, targetId }) => {
    console.log(`Running ${boxId} ${version} (${targetId})`);
  },
});
process.exitCode = result.exitCode ?? 1;
```

### Environment reports

Every preparation, attachment, payload verification, and run result includes a structured report.
The compact default contains every release-declared variable, every inherited variable the target
adapter identifies as capable of changing executed code, and every conflict, plus
`remainingVariableCount`. A variable records its winning `source`, visible winning `value`, whether
it is `executionAffecting`, and all `sources` in precedence order. Release values are visible because
they are already public in the signed document; caller values are visible too. Only inherited host
values are `"<masked>"` by default, so a caller must not log a report containing secrets it supplied
through `env`.

The Node report fields are:

| Field | Meaning |
| --- | --- |
| `mode` | `"summary"` for the compact selection, or `"full"` after expansion |
| `hostValuesRevealed` | Whether inherited host values are visible |
| `releaseVariableCount` | Number of names supplied by the signed declaration |
| `conflictCount` | Number of names whose sources supplied different values |
| `dangerousHostVariables` | Present inherited names the target adapter identifies as capable of changing executed code |
| `remainingVariableCount` | Resolved names omitted from `variables` in compact mode |
| `variables` | Selected variable reports, sorted by winning name |

Each variable has `name`, winning `source`, visible winning `value`, `executionAffecting`,
`conflict`, and `sources`. Each source entry records its `source`, exact `name` spelling, and visible
`value`. Sources are `host`, `caller`, `release`, and — during a verification self-test —
`validation`; later entries have higher precedence. Python exposes the same fields in snake case.

Pass `envReport: true` to any consumer operation to include every resolved variable name. Pass
`envReportValues: true` to imply the full report and reveal host values deliberately. Python uses
`env_report` and `env_report_values`. Run operations also accept `onEnvironmentReport` /
`on_environment_report`, called after resolution and before spawning.

```js
const result = await runExtractedBox(prepared, {
  envReport: true,
  onEnvironmentReport(report) {
    logger.info({ environment: report });
  },
});
```

::: warning Diagnostic, not guarantee
The `environment` declaration is signed format data and every verifier checks agreement. An
`environmentReport` is local consumer output: it changes with the host, caller values, flags, and
time of execution. A caller that starts `venv/bin/python` directly gets neither resolution nor a
report. Do not describe the report as a property guaranteed by the box.
:::

## `scrollcase_consumer`

The typed Python package mirrors the local Node consumer without depending on Node or its CLI:

```sh
python -m pip install scrollcase-consumer
```

```python
from scrollcase_consumer import (
    attach_extracted_box,
    run_box,
    run_extracted_box,
    verify_and_extract_box,
    verify_extracted_payload,
)

prepared = verify_and_extract_box(
    "release.json",
    public_key_path="trusted-keys.json",
    archive="box.zip",
    destination="/srv/boxes/example-1.0.0",
)

result = run_extracted_box(
    prepared,
    args=("--port", "8080"),
    env={"APPLICATION_MODE": "local"},
)
```

The receipt fields use idiomatic snake case (`box_id`, `target_id`, `required_assets`,
`archive_sha256`, `environment_report`). `attach_extracted_box(release, public_key_path=…, root=…)` and
`verify_extracted_payload(release, public_key_path=…, root=…)` mirror their Node counterparts
exactly, including the `attached` status and the refusal of a release that commits to no payload
digest. `run_box` performs the same one-shot prepare/run/cleanup composition. Stream
arguments accept Python file objects or `subprocess` constants; the default inherits the parent's
streams. On the main Python thread, `SIGINT`, `SIGTERM`, and `SIGHUP` are forwarded and then the
previous handlers are restored.

`EnvironmentReport`, `EnvironmentVariableReport`, and `EnvironmentSourceValue` are immutable public
models. Their fields mirror the Node structure in snake case; `BoxRunResult` and every verification
receipt include one.

The distribution is not a downloader: callers still supply local release, archive, trust-key,
destination, and on-demand asset paths. It verifies Ed25519 signatures with `cryptography` and
validates bundled, generated copies of the canonical schemas.

## `scrollcase/contract`

The single source of truth for what a box is. See [The Box Format](/reference/box-format).

### Targets

| Export | Signature | Purpose |
| --- | --- | --- |
| `boxTargetId` | `(target) => string` | The canonical slug (`linux-x86_64-cuda12.4`). Throws `TypeError` on an unsupported or ambiguous target |
| `boxTargetAdapter` | `(target) => Adapter` | The adapter for a validated target: Python layout, archive backend, native-library inspection, validation environments |
| `boxTargetAdapters` | `() => Adapter[]` | Every adapter, for enumerating supported targets |
| `condaSubdir` | `(target) => string` | The conda platform subdir (`osx-arm64`, `linux-64`, `win-64`) |
| `pixiAccelerator` | `(scroll) => { accelerator, cudaVersion }` | The conda accelerator descriptor a scroll selects, rejecting target drift |
| `assertNativeHost` | `(adapter, host = process) => void` | Throws unless the current host matches the adapter's OS and architecture |
| `assertPythonEntryPoint` | `(adapter, entryPoint) => void` | Throws unless the entry point matches the adapter's layout |

```js
import { boxTargetId } from 'scrollcase/contract';

boxTargetId({ platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.4' });
// → 'linux-x86_64-cuda12.4'
```

### Documents

| Export | Signature | Purpose |
| --- | --- | --- |
| `documentKinds` | `(namespace = 'scrollcase.box') => { release, channel, revocations }` | The `kind` discriminators under a namespace. Throws on an invalid namespace |
| `parseDocumentKind` | `(kind) => { namespace, type } \| null` | Splits a `kind` back apart |
| `isSignedBoxDocument` | `(value) => boolean` | Envelope shape check. **Says the document is worth verifying, never that it is valid** |
| `decodeDocumentPayload` | `(document) => object` | Decodes the payload and checks its embedded hash. **Does not verify signatures** |
| `schemaUrl` | `(name) => URL` | Absolute URL of a shipped JSON Schema |
| `fixtureUrl` | `(name) => URL` | Absolute URL of a shipped fixture |

Constants: `BOX_SCHEMA_VERSION` (`2`), `PAYLOAD_ENCODING` (`'base64-json-utf8'`),
`SIGNATURE_ALGORITHM` (`'ed25519'`), `DEFAULT_DOCUMENT_NAMESPACE` (`'scrollcase.box'`),
`CHANNELS` (`['nightly', 'beta', 'stable']`).

## `scrollcase/contract/browser`

The platform-neutral subset of the contract for browsers, Workers, and Node. It exports the target
helpers plus document constants, namespacing helpers, and `isSignedBoxDocument`. Its complete module
graph contains no Node built-ins.

```js
import {
  boxTargetId,
  isSignedBoxDocument,
} from 'scrollcase/contract/browser';
```

The full `scrollcase/contract` entry point remains the Node surface and additionally exports
`decodeDocumentPayload`, `schemaUrl`, and `fixtureUrl`. Cryptographic verification remains under
`scrollcase/sign`; the browser guard checks envelope shape only and never establishes trust.

::: warning Decoding is not verifying
`decodeDocumentPayload` catches a truncated or edited document, because the payload hash must
match the bytes. It says nothing about *who* produced them. Anything acted upon must first pass
`verifySignedDocument` against a trusted key.
:::

### Proving a mirror implementation

A client in another language mirrors these rules and validates the mirror against the fixtures:

```js
import { boxTargetId } from 'scrollcase/contract';
import cases from 'scrollcase/contract/fixtures/target-id-contract.json' with { type: 'json' };

for (const { target, targetId } of cases.valid) {
  if (boxTargetId(target) !== targetId) throw new Error(`mismatch for ${targetId}`);
}
for (const { target } of cases.invalid) {
  let rejected = false;
  try {
    boxTargetId(target);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error(`invalid target was accepted: ${JSON.stringify(target)}`);
}
```

## `scrollcase/sign`

| Export | Signature | Purpose |
| --- | --- | --- |
| `generateSigningKey` | `({ privatePath, publicPath, keyId, force }) => Promise<{ keyId, privatePath, publicPath }>` | What `keygen` runs. Refuses to overwrite without `force` |
| `readSigningKey` | `({ privatePath, publicPath }) => Promise<{ privateKey, metadata }>` | Loads the private key and cross-checks it against the published public key |
| `signDocument` | `(payload, { signerCommand, privatePath, publicPath, runResult }) => Promise<Document>` | Wraps a payload in the signed envelope, locally or through an external signer; `runResult` is an optional process seam |
| `verifySignedDocument` | `(document, publicKeyPath) => Promise<object>` | Verifies against a trusted key file and returns the payload. Throws otherwise |
| `decodeSignedDocument` | `(document) => { bytes, payload }` | Unwraps and checks the payload hash. Does **not** check the signature |

The trusted key file is either a single key object or a `{ "keys": [...] }` bundle; a document is
accepted when any one of its signatures verifies. See
[Signing & Key Custody](/guides/signing-and-custody).

## `scrollcase/build`

Build primitives. Useful for tooling around Scrollcase — a CI check, a custom staging step, a
client that computes the same hashes.

### Workspace

| Export | Purpose |
| --- | --- |
| `resolveWorkspace({ cwd, overrides })` | Resolve the absolute layout without installing it |
| `configureWorkspace({ cwd, overrides })` | Resolve and install it for this process |
| `getWorkspace()` | The installed workspace, resolving defaults on first use |
| `findWorkspaceConfig(startDir)` | Walk up looking for `scrollcase.config.json` |
| `workspaceOverridesFromFlags(flags)` / `workspaceOverridesFromArgv(argv)` | Collect workspace overrides from a parsed flag map, or raw arguments |
| `DEFAULT_WORKSPACE_PATHS`, `SCROLLCASE_CONFIG_FILENAME` | The defaults and the filename |

```js
import { resolveWorkspace } from 'scrollcase/build';

const workspace = resolveWorkspace({ cwd: '/work/my-project/scrolls/my-model/macos-aarch64-metal' });
// → { root, configPath, scrollsDir, buildDir, distDir, keysDir, toolchainDir }
```

Details in [Workspace Configuration](/reference/configuration).

### Archives and filesystem

| Export | Purpose |
| --- | --- |
| `createDeterministicZip(payloadDir, archivePath, adapter)` | Write a box archive: fixed timestamps, stable ordering, adapter-derived modes |
| `extractZipArchive(archivePath, destination)` | Extract with entry-name validation; rejects traversal, links and special entries |
| `listZipEntries(archivePath)` | Enumerate entries without extracting |
| `collectFiles(root)` | Enumerate files in the one stable order hashing and archiving rely on |
| `sha256File(path)`, `fileExists(path)` | Hashing and existence checks |
| `payloadDigest(root)` | Reduce an extracted tree to the `{ format, sha256 }` a release commits to |

### Identity and toolchain

| Export | Purpose |
| --- | --- |
| `boxReleaseStem(release)` | `<boxId>-<version>-<targetId>` |
| `boxReleaseObjectPrefix(release)` | `boxes/<boxId>/<version>/<targetId>` |
| `builderVersionFields(source)` | The builder-identity fields recorded in provenance |
| `findPixi({ requiredVersion, path, runResult })` | Locate pixi and enforce the scroll's pin |
| `findCondaPack({ path, runResult })` | Locate conda-pack |
| `CONDA_PACK_VERSION` | The exact conda-pack release installed by Scrollcase (`0.9.2`) |
| `pixiLockArguments`, `pixiInstallArguments`, `condaPackArguments` | The exact argument vectors the build uses |
| `installAndPackPixiEnvironment({ … })` | Install from the lock, pack, relocate into `venv/` |
| `repairPosixLaunchers(adapter, payloadDir, forbiddenPaths)` | Rewrite console scripts to resolve Python next to themselves |

### Licence audit

| Export | Purpose |
| --- | --- |
| `createCondaDependencyLicenseAudit({ lockBytes, targetId, namespace })` | The inventory, derived from a `pixi.lock` |
| `validateCondaDependencyLicenseAudit(reviewed, actual)` | Throw unless a reviewed audit still matches the lock exactly |
| `lockedCondaDistributions(lockBytes)` | The parsed distributions with their declared licences |
| `parseCondaPackageReference(url)` | `{ name, version }` from a conda package filename |

```js
import { readFile } from 'node:fs/promises';
import { createCondaDependencyLicenseAudit } from 'scrollcase/build';

const audit = createCondaDependencyLicenseAudit({
  lockBytes: await readFile('scrolls/my-model/macos-aarch64-metal/pixi.lock'),
  targetId: 'macos-aarch64-metal',
});
// → { schemaVersion, kind, targetId, dependencyLockSha256, packages: [...] }
```

A package without a declared licence throws rather than being reported as unknown.

### Process

`fail(message)` throws the single error shape the CLI turns into a one-line non-zero exit; `run`
and `runResult` are the process runners the build injects, which is how the test suite drives the
pipeline without a real toolchain.

## Stability

The exported surface follows the package version. The active v2 **format** — target IDs, document
kinds, payload encoding, and signature algorithm — changes only through an explicit new schema
version. The v2 API rejects v1 rather than widening its types or runtime paths into a compatibility
union.
