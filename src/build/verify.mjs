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
import { assertNativeHost, assertPythonEntryPoint, boxTargetAdapter, boxTargetId } from '../contract/targets.mjs';
import { parseDocumentKind } from '../contract/documents.mjs';
import { verifySignedDocument } from '../sign/index.mjs';
import { extractZipArchive, listZipEntries, readZipEntry } from './archive.mjs';
import { fileExists, payloadSize, safeRelativePath, sha256File } from './filesystem.mjs';
import { boxReleaseStem } from './identity.mjs';
import { fail, run as runProcess } from './process.mjs';

/**
 * Verifies a signed release document and the archive it commits to.
 *
 * `publicPath` names the trusted key file; `archive` overrides the convention of the archive
 * sitting next to its release document; `selfTest` additionally extracts the box and runs its own
 * interpreter, which only works on a matching native host. Returns a summary of what was checked.
 */
export async function verifyBox(releaseDocumentPath, options = {}) {
  const {
    publicPath,
    archive: archiveOverride = null,
    selfTest = false,
    run = runProcess,
    log = console.log,
  } = options;
  const releasePath = resolve(releaseDocumentPath);
  const signed = JSON.parse(await readFile(releasePath, 'utf8'));
  const release = await verifySignedDocument(signed, publicPath);
  if (parseDocumentKind(release.kind)?.type !== 'release') fail('Document is not a box release.');
  const adapter = boxTargetAdapter(release.target);
  assertPythonEntryPoint(adapter, release.pythonEntryPoint);

  // By convention the archive sits next to its release document under the shared stem.
  const archivePath = resolve(archiveOverride || join(dirname(releasePath), `${boxReleaseStem(release)}.zip`));
  if (!await fileExists(archivePath)) fail(`Archive not found: ${archivePath}`);
  if ((await stat(archivePath)).size !== release.archive.sizeBytes) fail('Archive size mismatch.');
  if (await sha256File(archivePath) !== release.archive.sha256) fail('Archive SHA-256 mismatch.');
  if (release.installedSizeBytes !== undefined
    && (!Number.isSafeInteger(release.installedSizeBytes) || release.installedSizeBytes <= 0)) {
    fail('Invalid installed size.');
  }

  const entries = await listZipEntries(archivePath);
  const files = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
  if (!files.has('box.json')) fail('Archive is missing box.json.');
  const box = JSON.parse(await readZipEntry(archivePath, 'box.json'));
  for (const field of ['boxId', 'modelId', 'runtimeId', 'version', 'pythonEntryPoint']) {
    if (box[field] !== release[field]) fail(`box.json mismatch: ${field}`);
  }
  if (!files.has(release.pythonEntryPoint)) fail(`Archive is missing ${release.pythonEntryPoint}.`);

  if (selfTest) {
    assertNativeHost(adapter);
    const extracted = await mkdtemp(join(tmpdir(), 'scrollcase-verify-'));
    try {
      await extractZipArchive(archivePath, extracted);
      if (release.installedSizeBytes !== undefined
        && await payloadSize(extracted) !== release.installedSizeBytes) {
        fail('Extracted payload size does not match the signed release.');
      }
      const python = join(extracted, safeRelativePath(release.pythonEntryPoint));
      run(python, ['-c', `${adapter.selfTestPython}\nimport ${release.selfTest.pythonImports.join(', ')}`], {
        cwd: extracted,
        env: adapter.validationEnvironments[release.target.accelerator],
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
  };
}
