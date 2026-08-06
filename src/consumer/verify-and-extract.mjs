/**
 * Verification and durable preparation of a caller-supplied local box.
 *
 * A prepared box is deliberately opaque. Its public receipt contains useful signed identity and
 * audit data, while private state binds that exact object to the release Scrollcase verified. A
 * caller therefore cannot construct an object that looks prepared and use it to bypass the trust
 * chain before execution.
 */

import { createHash } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rename,
  rm,
} from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { extractZipArchive } from '../build/archive.mjs';
import { collectFiles, payloadSize, safeRelativePath, sha256File } from '../build/filesystem.mjs';
import { assertExecutionFiles } from '../build/execution.mjs';
import { fail } from '../build/process.mjs';
import { inspectBoxArchive, inspectReleaseDocument } from '../build/verify.mjs';
import {
  MAX_PAYLOAD_DIGEST_BYTES,
  PAYLOAD_DIGEST_FILE,
  parsePayloadDigestStream,
} from '../contract/payload-digest.mjs';
import { assertNativeHost, boxTargetAdapter, boxTargetId } from '../contract/targets.mjs';
import { resolveEnvironment } from '../environment.mjs';

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
 * `status` says which of the two producers minted it, because they do not prove the same thing.
 * `prepared` means the bytes came from an archive whose signed hash was checked in this process.
 * `attached` means an existing directory was re-identified against a signed release without any
 * archive to check it against — the receipt must not claim more than that.
 *
 * @typedef {object} PreparedBox
 * @property {'prepared' | 'attached'} status
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
 * @property {number} installedSizeBytes logical size of the box root, measured when this receipt was
 *   produced — on an attached receipt it is a current measurement, not an agreement with the release
 * @property {import('../environment.mjs').EnvironmentReport} environmentReport diagnostic snapshot
 *   of this process's host environment resolved against the signed declaration
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
  if (!state) fail('Expected a PreparedBox returned by verifyAndExtractBox() or attachExtractedBox().');
  return state;
}

/**
 * Checks the on-demand assets a caller was told to place, against their signed descriptors.
 *
 * This lives here rather than beside execution because both producers of a receipt need it before
 * one exists, and importing it the other way would close a cycle with `run-extracted.mjs`.
 *
 * @param {string} root
 * @param {readonly RequiredAsset[]} assets
 */
export async function verifyRequiredAssets(root, assets) {
  for (const asset of assets) {
    const path = join(root, ...safeRelativePath(asset.relativePath).split('/'));
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        fail(`Required on-demand asset is missing: ${asset.relativePath}.`);
      }
      throw error;
    }
    if (!metadata.isFile()) fail(`Required on-demand asset is not a regular file: ${asset.relativePath}.`);
    if (metadata.size !== asset.sizeBytes) {
      fail(`Required on-demand asset size mismatch: ${asset.relativePath}.`);
    }
    if (await sha256File(path) !== asset.sha256) {
      fail(`Required on-demand asset SHA-256 mismatch: ${asset.relativePath}.`);
    }
  }
}

/** The on-demand descriptors a release requires a caller to have materialised, screened for safety. */
function requiredAssetsOf(release) {
  const assets = release.weights === 'on-demand' ? release.assets : [];
  for (const asset of assets) safeRelativePath(asset.relativePath);
  return assets;
}

/** Resolves the diagnostic snapshot carried by every verification receipt. */
function releaseEnvironmentReport(release, options = {}) {
  const adapter = boxTargetAdapter(release.target);
  return resolveEnvironment({
    platform: adapter.platform,
    layers: [
      { source: 'host', values: process.env },
      { source: 'release', values: release.environment },
    ],
    executionAffectingVariables: adapter.executionAffectingEnvironmentVariables,
    expanded: Boolean(options.envReport || options.envReportValues),
    revealHostValues: Boolean(options.envReportValues),
  }).report;
}

/** Builds the public receipt and binds the private state that authorises execution. */
function mintReceipt(status, {
  root,
  release,
  signed,
  installedSizeBytes,
  identity,
  environmentOptions,
}) {
  const frozenRelease = freezeValue(release);
  const receipt = freezeValue({
    status,
    root,
    boxId: release.boxId,
    modelId: release.modelId,
    runtimeId: release.runtimeId,
    version: release.version,
    target: release.target,
    targetId: boxTargetId(release.target),
    pythonEntryPoint: release.pythonEntryPoint,
    execution: release.execution ?? null,
    requiredAssets: requiredAssetsOf(release),
    signingKeyIds: signed.signatures.map((signature) => signature.keyId),
    releasePayloadSha256: signed.payloadSha256,
    archiveSha256: release.archive.sha256,
    archiveSizeBytes: release.archive.sizeBytes,
    installedSizeBytes,
    environmentReport: releaseEnvironmentReport(release, environmentOptions),
  });
  preparedBoxes.set(receipt, { release: frozenRelease, rootIdentity: identity });
  return receipt;
}

/**
 * Verifies and extracts one local box without executing any code from it.
 *
 * The destination must not exist. Extraction happens in a fresh sibling directory so the final
 * rename stays on one filesystem and exposes either the complete verified tree or nothing.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath?: string | null, trustedKeys?: object[] | null,
 *   archive?: string | null, destination: string,
 *   envReport?: boolean, envReportValues?: boolean }} options
 * @returns {Promise<Readonly<PreparedBox>>}
 */
export async function verifyAndExtractBox(releaseDocumentPath, {
  publicPath,
  trustedKeys,
  archive = null,
  destination,
  envReport = false,
  envReportValues = false,
}) {
  if (!destination) fail('A destination is required to prepare a box.');
  const finalRoot = resolve(destination);
  if (await pathExists(finalRoot)) fail(`Destination already exists: ${finalRoot}`);

  const inspected = await inspectBoxArchive(releaseDocumentPath, { publicPath, trustedKeys, archive });
  const {
    archivePath,
    signed,
    release,
  } = inspected;
  requiredAssetsOf(release);

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

    return mintReceipt('prepared', {
      root: finalRoot,
      release,
      signed,
      installedSizeBytes: extractedSize,
      identity: { device: installedMetadata.dev, inode: installedMetadata.ino },
      environmentOptions: { envReport, envReportValues },
    });
  } finally {
    await rm(stageRoot, { recursive: true, force: true });
  }
}

/** Resolves a directory a caller claims holds an extracted box, refusing anything that is not one. */
async function resolveExtractedRoot(root) {
  if (!root) fail('A root is required to attach an extracted box.');
  const resolved = resolve(root);
  let metadata;
  try {
    metadata = await lstat(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`${resolved} is not an extracted box directory.`);
    throw error;
  }
  // `lstat`, so a symbolic link reports false here. That is deliberate: `runExtractedBox` requires
  // a real directory, and accepting a link would mint a receipt that can never be executed.
  if (!metadata.isDirectory()) fail(`${resolved} is not an extracted box directory.`);
  return { root: resolved, metadata };
}

/**
 * Re-identifies a box that is already extracted, without its archive.
 *
 * This is what lets an application install a box once and run it across restarts. It performs every
 * check that needs no data beyond the signed release — signature and schema, a target this host can
 * run, the interpreter and execution files present, the signed hashes of on-demand assets — and
 * deliberately does not read the payload. Proving the installed bytes is `verifyExtractedPayload`,
 * a separate decision with a separate cost, which the caller makes when it wants to.
 *
 * Unlike preparation, this asserts the native host: preparation only writes files, but a receipt
 * minted here exists to be executed.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath?: string | null, trustedKeys?: object[] | null, root: string,
 *   envReport?: boolean, envReportValues?: boolean }} options
 * @returns {Promise<Readonly<PreparedBox>>}
 */
export async function attachExtractedBox(releaseDocumentPath, {
  publicPath,
  trustedKeys,
  root,
  envReport = false,
  envReportValues = false,
}) {
  const { root: boxRoot, metadata } = await resolveExtractedRoot(root);
  const { signed, release, adapter } = await inspectReleaseDocument(releaseDocumentPath, { publicPath, trustedKeys });
  try {
    assertNativeHost(adapter);
  } catch {
    fail(
      `Box target ${boxTargetId(release.target)} cannot run on ${process.platform}/${process.arch}; `
      + `requires ${adapter.host.platform}/${adapter.host.arch}.`,
    );
  }

  const files = new Set(await collectFiles(boxRoot));
  if (!files.has(release.pythonEntryPoint)) {
    fail(`Attached box is missing ${release.pythonEntryPoint}.`);
  }
  assertExecutionFiles({
    execution: release.execution,
    adapter,
    pythonVersion: release.provenance.pythonVersion,
    files,
  });
  await verifyRequiredAssets(boxRoot, requiredAssetsOf(release));

  // Measured, never compared: an installed tree legitimately grows after extraction — on-demand
  // assets, caches, whatever the application writes in its own working directory — so holding it
  // to the signed figure would fail honest boxes.
  const installedSizeBytes = await payloadSize(boxRoot);
  const settled = await lstat(boxRoot);
  if (settled.dev !== metadata.dev || settled.ino !== metadata.ino) {
    fail('Attached box root changed while it was being checked.');
  }
  return mintReceipt('attached', {
    root: boxRoot,
    release,
    signed,
    installedSizeBytes,
    identity: { device: settled.dev, inode: settled.ino },
    environmentOptions: { envReport, envReportValues },
  });
}

/**
 * The result of comparing an extracted tree against the entry list its release commits to.
 *
 * @typedef {object} PayloadVerification
 * @property {'verified'} status
 * @property {string} root
 * @property {string} boxId
 * @property {string} version
 * @property {string} targetId
 * @property {number} entryCount how many payload entries were checked
 * @property {import('../environment.mjs').EnvironmentReport} environmentReport diagnostic snapshot
 */

/**
 * Proves an extracted tree is the one a signed release describes.
 *
 * Deliberately standalone. Nothing calls it — not preparation, not attachment, not execution —
 * because it reads every byte the box carries, and because a check that passed at one moment says
 * nothing about the next: between here and a later import the tree can change, and no library can
 * close that window. Filesystem permissions do, and they belong to the operating system and the
 * application. What this answers is narrower and worth answering: is this directory the box that
 * release describes, and is it still whole.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath?: string | null, trustedKeys?: object[] | null, root: string,
 *   envReport?: boolean, envReportValues?: boolean }} options
 * @returns {Promise<Readonly<PayloadVerification>>}
 */
export async function verifyExtractedPayload(releaseDocumentPath, {
  publicPath,
  trustedKeys,
  root,
  envReport = false,
  envReportValues = false,
}) {
  const { root: boxRoot } = await resolveExtractedRoot(root);
  const { release } = await inspectReleaseDocument(releaseDocumentPath, { publicPath, trustedKeys });
  if (release.payloadDigest === undefined) {
    fail('This release does not commit to a payload digest; it was built before payload verification existed.');
  }

  const listPath = join(boxRoot, PAYLOAD_DIGEST_FILE);
  let listSize;
  try {
    listSize = (await lstat(listPath)).size;
  } catch (error) {
    if (error?.code === 'ENOENT') fail(`Attached box is missing its payload digest list: ${PAYLOAD_DIGEST_FILE}.`);
    throw error;
  }
  if (listSize > MAX_PAYLOAD_DIGEST_BYTES) fail('Payload digest list is larger than this consumer will read.');
  // Hash the bytes before parsing them. The list arrives with the untrusted tree it describes, so
  // until it matches the signed value it is not a list — it is input.
  if (await sha256File(listPath) !== release.payloadDigest.sha256) {
    fail('Payload digest list does not match the signed release.');
  }

  let entries;
  try {
    entries = parsePayloadDigestStream(await readFile(listPath));
  } catch (error) {
    fail(`Invalid payload digest list: ${error.message}`);
  }
  for (const entry of entries) {
    const path = join(boxRoot, ...safeRelativePath(entry.path).split('/'));
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error?.code === 'ENOENT') fail(`Payload does not match the signed release: ${entry.path} is missing.`);
      throw error;
    }
    const kind = metadata.isSymbolicLink() ? 'link' : metadata.isFile() ? 'file' : null;
    if (kind !== entry.kind) {
      fail(`Payload does not match the signed release: ${entry.path} is not a ${entry.kind}.`);
    }
    // A link is compared by its target string, never opened — following it would compare the
    // target's bytes under two names and make a link indistinguishable from a copy.
    const actual = kind === 'link'
      ? createHash('sha256').update(await readlink(path), 'utf8').digest('hex')
      : await sha256File(path);
    if (actual !== entry.contentSha256) {
      fail(`Payload does not match the signed release: ${entry.path}.`);
    }
  }

  return freezeValue({
    status: 'verified',
    root: boxRoot,
    boxId: release.boxId,
    version: release.version,
    targetId: boxTargetId(release.target),
    entryCount: entries.length,
    environmentReport: releaseEnvironmentReport(release, { envReport, envReportValues }),
  });
}
