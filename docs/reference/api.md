---
title: Node API
description: The importable surface — contract, local consumer, build primitives, and signing.
---

# Node API

The CLI is the supported way to run the build pipeline. The package additionally exports five
modules for clients that need to understand, prepare, or execute local boxes: validate a document,
derive a target ID, check a signature, resolve a workspace, or run a verified application.

```js
import { boxTargetId, documentKinds } from 'scrollcase/contract';
import { isSignedBoxDocument } from 'scrollcase/contract/browser';
import { sha256File, resolveWorkspace } from 'scrollcase/build';
import { verifyAndExtractBox, runExtractedBox, runBox } from 'scrollcase/consumer';
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
  verifyAndExtractBox,
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
signing information. The receipt is process-bound: `runExtractedBox` rejects copied or constructed
lookalikes, and also rejects a prepared root replaced after verification.

For `on-demand` weights, `prepared.requiredAssets` contains the signed URL, relative path, size and
SHA-256 descriptors. Scrollcase does not fetch them. The caller may materialize those files under
`prepared.root`; execution refuses a missing, non-regular, wrong-size, or wrong-hash asset.

### Execution

`runExtractedBox(prepared, options)` runs only a receipt returned by
`verifyAndExtractBox` in the current process. It rechecks the prepared tree and required assets,
enforces the native target, starts the declared script or `-m` module with the box's own Python,
uses the box root as `cwd`, and appends caller `args` after signed `defaultArgs`. It never invokes a
shell.

`stdin`, `stdout`, and `stderr` accept Node child-process stdio values or streams; `env` is merged
over the current environment. `SIGINT`, `SIGTERM`, and `SIGHUP` are forwarded while the child is
alive. The returned `{ exitCode, signal }` preserves the child's terminal result.

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
