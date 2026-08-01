/**
 * Verification and durable preparation of a caller-supplied local box.
 *
 * A prepared box is deliberately opaque. Its public receipt contains useful signed identity and
 * audit data, while private state binds that exact object to the release Scrollcase verified. A
 * caller therefore cannot construct an object that looks prepared and use it to bypass the trust
 * chain before execution.
 */

import {
  lstat,
  mkdir,
  mkdtemp,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { extractZipArchive } from '../build/archive.mjs';
import { payloadSize, safeRelativePath, sha256File } from '../build/filesystem.mjs';
import { fail } from '../build/process.mjs';
import { inspectBoxArchive } from '../build/verify.mjs';
import { boxTargetId } from '../contract/targets.mjs';

/**
 * An on-demand asset whose signed bytes the caller must place under `root` before execution.
 *
 * @typedef {object} RequiredAsset
 * @property {string} url
 * @property {string} relativePath
 * @property {number} sizeBytes
 * @property {string} sha256
 */

/**
 * The immutable result of a successfully verified and atomically prepared local box.
 *
 * @typedef {object} PreparedBox
 * @property {'prepared'} status
 * @property {string} root absolute extracted box root
 * @property {string} boxId
 * @property {string} modelId
 * @property {string} runtimeId
 * @property {string} version
 * @property {import('../contract/types/index.d.ts').BoxTarget} target
 * @property {string} targetId
 * @property {string} pythonEntryPoint
 * @property {import('../contract/types/index.d.ts').BoxExecution | null} execution
 * @property {readonly RequiredAsset[]} requiredAssets assets the caller must materialize, never
 *   downloaded by Scrollcase
 * @property {readonly string[]} signingKeyIds
 * @property {string} releasePayloadSha256
 * @property {string} archiveSha256
 * @property {number} archiveSizeBytes
 * @property {number} installedSizeBytes logical size of the verified extracted payload
 */

/** @type {WeakMap<object, {
 *   release: import('../contract/types/index.d.ts').BoxReleaseManifest,
 *   rootIdentity: { device: number, inode: number },
 * }>} */
const preparedBoxes = new WeakMap();

function freezeValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) freezeValue(nested);
  return Object.freeze(value);
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

/**
 * Returns the private, verified release bound to a prepared receipt.
 *
 * This is internal to the consumer module graph; it is not re-exported from the package surface.
 */
export function preparedBoxState(/** @type {unknown} */ prepared) {
  const state = preparedBoxes.get(prepared);
  if (!state) fail('Expected a PreparedBox returned by verifyAndExtractBox().');
  return state;
}

/**
 * Verifies and extracts one local box without executing any code from it.
 *
 * The destination must not exist. Extraction happens in a fresh sibling directory so the final
 * rename stays on one filesystem and exposes either the complete verified tree or nothing.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath: string, archive?: string | null, destination: string }} options
 * @returns {Promise<Readonly<PreparedBox>>}
 */
export async function verifyAndExtractBox(releaseDocumentPath, {
  publicPath,
  archive = null,
  destination,
}) {
  if (!destination) fail('A destination is required to prepare a box.');
  const finalRoot = resolve(destination);
  if (await pathExists(finalRoot)) fail(`Destination already exists: ${finalRoot}`);

  const inspected = await inspectBoxArchive(releaseDocumentPath, { publicPath, archive });
  const {
    archivePath,
    signed,
    release,
  } = inspected;
  const requiredAssets = release.weights === 'on-demand' ? release.assets : [];
  for (const asset of requiredAssets) safeRelativePath(asset.relativePath);

  const parent = dirname(finalRoot);
  await mkdir(parent, { recursive: true });
  if (await pathExists(finalRoot)) fail(`Destination already exists: ${finalRoot}`);

  const stageRoot = await mkdtemp(join(parent, `.scrollcase-prepare-${basename(finalRoot)}-`));
  const extractedRoot = join(stageRoot, 'payload');
  try {
    await extractZipArchive(archivePath, extractedRoot);
    const extractedSize = await payloadSize(extractedRoot);
    if (release.installedSizeBytes !== undefined
      && extractedSize !== release.installedSizeBytes) {
      fail('Extracted payload size does not match the signed release.');
    }

    // Re-check the source after extraction. This catches a local archive being replaced between
    // the initial trust decision and the move into the caller's durable destination.
    if (await sha256File(archivePath) !== release.archive.sha256) {
      fail('Archive SHA-256 changed during extraction.');
    }
    const stagedMetadata = await lstat(extractedRoot);
    if (await pathExists(finalRoot)) fail(`Destination already exists: ${finalRoot}`);
    await rename(extractedRoot, finalRoot);
    const installedMetadata = await lstat(finalRoot);
    if (installedMetadata.dev !== stagedMetadata.dev || installedMetadata.ino !== stagedMetadata.ino) {
      fail('Prepared destination identity changed during installation.');
    }

    const frozenRelease = freezeValue(release);
    const receipt = freezeValue({
      status: 'prepared',
      root: finalRoot,
      boxId: release.boxId,
      modelId: release.modelId,
      runtimeId: release.runtimeId,
      version: release.version,
      target: release.target,
      targetId: boxTargetId(release.target),
      pythonEntryPoint: release.pythonEntryPoint,
      execution: release.execution ?? null,
      requiredAssets,
      signingKeyIds: signed.signatures.map((signature) => signature.keyId),
      releasePayloadSha256: signed.payloadSha256,
      archiveSha256: release.archive.sha256,
      archiveSizeBytes: release.archive.sizeBytes,
      installedSizeBytes: extractedSize,
    });
    preparedBoxes.set(receipt, {
      release: frozenRelease,
      rootIdentity: {
        device: installedMetadata.dev,
        inode: installedMetadata.ino,
      },
    });
    return receipt;
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}
