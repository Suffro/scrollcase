/**
 * `verify` — re-run a consumer's install-time checks locally, before anything is published.
 *
 * This deliberately mirrors what an installing client does on a user's machine: check the signature,
 * the archive's size and hash, that entry names are safe, that `box.json` agrees with the signed
 * release, and that the declared interpreter is actually present. `selfTest` goes one step further
 * and imports the modules from a real extraction, which is the closest thing to a dry-run install.
 *
 * The point is that a box which would fail on a user's machine fails here instead.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { assertNativeHost, assertPythonEntryPoint, boxTargetAdapter, boxTargetId } from '../contract/targets.mjs';
import { BOX_SCHEMA_VERSION, parseDocumentKind } from '../contract/documents.mjs';
import { resolveTrustedKeys, verifySignedDocument } from '../sign/index.mjs';

const AGREEMENT_FIELDS = [
  'schemaVersion',
  'boxId',
  'modelId',
  'runtimeId',
  'version',
  'target',
  'pythonEntryPoint',
  'modelCacheSubdir',
  'environment',
  'selfTest',
  'execution',
  'weights',
  'assets',
  'provenance',
];

/**
 * Binds the self-description inside the archive to the signed release outside it.
 *
 * Only fields present in both schema-version-2 documents belong here. Release-only transport data
 * has no counterpart in box.json; every shared identity, target, layout, consumer self-test,
 * asset-policy, and provenance field must agree recursively.
 */
export function assertBoxManifestAgreement(box, release) {
  for (const field of AGREEMENT_FIELDS) {
    if (!isDeepStrictEqual(box[field], release[field])) fail(`box.json mismatch: ${field}`);
  }
}
import { extractZipArchive, listZipEntries, readZipEntry } from './archive.mjs';
import { assertExecutionFiles } from './execution.mjs';
import { fileExists, payloadDigest, payloadSize, safeRelativePath, sha256File } from './filesystem.mjs';
import { fail, run as runProcess } from './process.mjs';
import { schemaValidationError } from './schema-validation.mjs';
import { resolveEnvironment } from '../environment.mjs';

const schemaUrls = [
  new URL('../contract/schema/release-manifest.schema.json', import.meta.url),
  new URL('../contract/schema/box-manifest.schema.json', import.meta.url),
  new URL('../contract/schema/target.schema.json', import.meta.url),
  new URL('../contract/schema/execution.schema.json', import.meta.url),
  new URL('../contract/schema/signed-document.schema.json', import.meta.url),
];
let manifestSchemas;

async function loadManifestSchemas() {
  manifestSchemas ??= Promise.all(schemaUrls.map(async (url) => JSON.parse(await readFile(url, 'utf8'))));
  return manifestSchemas;
}

/**
 * Performs the half of the trust chain that needs no archive.
 *
 * Everything here answers questions about the signed document alone — is the signature good, is the
 * payload a schema-version-2 release, does it describe a target this build understands. It is split
 * out because a box that is already extracted has no archive to check, and re-deriving these steps
 * beside the ones that do would create the second interpretation of a signed release that
 * `inspectBoxArchive` exists to prevent.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath?: string | null, trustedKeys?: object[] | null }} options exactly one source
 */
export async function inspectReleaseDocument(releaseDocumentPath, { publicPath, trustedKeys }) {
  const releasePath = resolve(releaseDocumentPath);
  const signed = JSON.parse(await readFile(releasePath, 'utf8'));
  if (signed?.schemaVersion === 1) {
    fail('Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.');
  }
  const [releaseSchema, boxSchema, targetSchema, executionSchema, signedSchema] =
    await loadManifestSchemas();
  const signedError = schemaValidationError(signed, signedSchema);
  if (signedError) fail(`Invalid signed document: ${signedError}.`);
  const release = await verifySignedDocument(signed, await resolveTrustedKeys({ publicPath, trustedKeys }));
  if (release?.schemaVersion === 1) {
    fail('Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.');
  }
  if (release?.schemaVersion !== BOX_SCHEMA_VERSION) {
    fail(`Unsupported schemaVersion ${String(release?.schemaVersion)}; expected ${BOX_SCHEMA_VERSION}.`);
  }
  const releaseError = schemaValidationError(
    release,
    releaseSchema,
    [boxSchema, targetSchema, executionSchema],
  );
  if (releaseError) fail(`Invalid release manifest: ${releaseError}.`);
  if (parseDocumentKind(release.kind)?.type !== 'release') fail('Document is not a box release.');
  const adapter = boxTargetAdapter(release.target);
  assertPythonEntryPoint(adapter, release.pythonEntryPoint);
  // Describes the extracted tree rather than the archive, so it belongs on this side of the split.
  // `payloadDigest` needs no companion check: its `format` is a schema `const`, so a release naming
  // a format this build cannot read is already refused above, by name, as an invalid manifest.
  if (release.installedSizeBytes !== undefined
    && (!Number.isSafeInteger(release.installedSizeBytes) || release.installedSizeBytes <= 0)) {
    fail('Invalid installed size.');
  }

  return { releasePath, signed, release, adapter, schemas: { releaseSchema, boxSchema, targetSchema, executionSchema } };
}

/**
 * Performs the complete read-only trust chain shared by `verify` and the local consumer.
 *
 * Keeping this as one operation matters: adding an execution API must not create a second,
 * subtly different interpretation of a signed release. The caller receives the validated
 * in-memory objects and exact archive path, but extraction and execution remain separate steps.
 */
export async function inspectBoxArchive(releaseDocumentPath, options = {}) {
  const { publicPath, trustedKeys, archive: archiveOverride = null } = options;
  const {
    releasePath,
    signed,
    release,
    adapter,
    schemas: { releaseSchema, boxSchema, targetSchema, executionSchema },
  } = await inspectReleaseDocument(releaseDocumentPath, { publicPath, trustedKeys });

  // The archive sits next to its release document under the hash that document commits to — the
  // same name it is published under, so this resolves identically against a local dist tree and a
  // directory downloaded from a mirror.
  const archivePath = archiveOverride
    ? resolve(archiveOverride)
    : join(dirname(releasePath), `${release.archive.sha256}.zip`);
  if (!await fileExists(archivePath)) fail(`Archive not found: ${archivePath}`);
  if ((await stat(archivePath)).size !== release.archive.sizeBytes) fail('Archive size mismatch.');
  if (await sha256File(archivePath) !== release.archive.sha256) fail('Archive SHA-256 mismatch.');

  const entries = await listZipEntries(archivePath);
  // Two questions, deliberately not the same set. `box.json` is read out of the archive, so it must
  // be an entry with its own bytes. Everything else asks only whether a path resolves — and a link
  // does resolve, to a file inside this same payload, because nothing else was allowed in.
  const files = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
  const resolvablePaths = new Set(entries
    .filter((entry) => entry.kind === 'file' || entry.kind === 'link')
    .map((entry) => entry.path));
  if (!files.has('box.json')) fail('Archive is missing box.json.');
  const box = JSON.parse(await readZipEntry(archivePath, 'box.json'));
  const boxError = schemaValidationError(
    box,
    boxSchema,
    [releaseSchema, targetSchema, executionSchema],
  );
  if (boxError) fail(`Invalid box.json: ${boxError}.`);
  assertBoxManifestAgreement(box, release);
  if (!resolvablePaths.has(release.pythonEntryPoint)) fail(`Archive is missing ${release.pythonEntryPoint}.`);
  assertExecutionFiles({
    execution: release.execution,
    adapter,
    pythonVersion: release.provenance.pythonVersion,
    files: resolvablePaths,
  });

  return {
    releasePath,
    archivePath,
    signed,
    release,
    box,
    adapter,
    entries,
    files,
  };
}

/**
 * Verifies a signed release document and the archive it commits to.
 *
 * `publicPath` names the trusted key file, or `trustedKeys` supplies the keys directly; `archive`
 * overrides the convention of the archive
 * sitting next to its release document; `selfTest` additionally extracts the box and runs its own
 * interpreter, which only works on a matching native host. Returns a summary of what was checked.
 */
export async function verifyBox(releaseDocumentPath, options = {}) {
  const {
    selfTest = false,
    run = runProcess,
    log = console.log,
  } = options;
  const inspected = await inspectBoxArchive(releaseDocumentPath, options);
  const {
    archivePath,
    signed,
    release,
    adapter,
  } = inspected;

  const environmentLayers = [
    { source: 'host', values: process.env },
    { source: 'release', values: release.environment },
    ...(selfTest ? [{
      source: 'validation',
      values: adapter.validationEnvironments[release.target.accelerator],
    }] : []),
  ];
  const resolvedEnvironment = resolveEnvironment({
    platform: adapter.platform,
    layers: environmentLayers,
    executionAffectingVariables: adapter.executionAffectingEnvironmentVariables,
    expanded: Boolean(options.envReport || options.envReportValues),
    revealHostValues: Boolean(options.envReportValues),
  });
  const environmentReport = resolvedEnvironment.report;
  if (selfTest || options.envReport || options.envReportValues) {
    await options.onEnvironmentReport?.(environmentReport);
  }
  if (selfTest) {
    assertNativeHost(adapter);
    const extracted = await mkdtemp(join(tmpdir(), 'scrollcase-verify-'));
    try {
      await extractZipArchive(archivePath, extracted);
      if (release.installedSizeBytes !== undefined
        && await payloadSize(extracted) !== release.installedSizeBytes) {
        fail('Extracted payload size does not match the signed release.');
      }
      // This is the one place that proves the entry list a build produced actually describes what
      // the archive extracts to, and it runs before the box is published rather than after. It
      // costs a second full read of the tree, which is proportionate only to a verb that already
      // extracts everything and runs an interpreter — no other path pays it.
      if (release.payloadDigest !== undefined
        && (await payloadDigest(extracted)).sha256 !== release.payloadDigest.sha256) {
        fail('Extracted payload does not match the signed release.');
      }
      const python = join(extracted, safeRelativePath(release.pythonEntryPoint));
      run(python, ['-c', `${adapter.selfTestPython}\nimport ${release.selfTest.pythonImports.join(', ')}`], {
        cwd: extracted,
        env: resolvedEnvironment.environment,
      });
    } finally {
      await rm(extracted, { recursive: true, force: true });
    }
  }

  log(`Verified ${release.boxId} ${release.version} (${boxTargetId(release.target)})`);
  return {
    status: 'passed',
    localSignatureVerified: true,
    signingKeyIds: signed.signatures.map((signature) => signature.keyId),
    releasePayloadSha256: signed.payloadSha256,
    archiveSha256: release.archive.sha256,
    archiveSizeBytes: release.archive.sizeBytes,
    selfTest: selfTest ? 'passed' : 'not-requested',
    environmentReport,
  };
}
