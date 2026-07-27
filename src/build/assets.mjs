/**
 * Fetching and staging the files a box carries.
 *
 * Every asset is declared with a size and a SHA-256 in the recipe, and nothing enters the payload
 * before both match. That is what makes a box reproducible even though its inputs live on servers
 * outside anyone's control: if an upstream file is moved, replaced, or silently re-uploaded, the
 * build fails instead of quietly producing a different box under the same version.
 */

import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, sep } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { extractRecipeArchive as extractArchive } from './archive.mjs';
import { fileExists, safeRelativePath, sha256File } from './filesystem.mjs';
import { fail } from './process.mjs';

const MAX_DOWNLOAD_ATTEMPTS = 5;

/**
 * Downloads an asset and enforces the recipe's declared size and hash.
 *
 * Model files are large, so retries inside one download operation resume from a `.part` file with a
 * Range request. Two safeguards matter — a complete destination is reused only after size and hash
 * verification, and the `.part` file is renamed into place only *after* the hash matches, so an
 * interrupted or corrupted transfer can never masquerade as a finished asset. The build scratch
 * tree is recreated at process start, so this is intentionally not a cross-process cache.
 */
export async function downloadVerified(asset, destination, options = {}) {
  const {
    fetchImpl = fetch,
    log = console.error,
    wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  } = options;
  const expectedPath = safeRelativePath(asset.relativePath).split('/').join(sep);
  if (!destination.endsWith(expectedPath)) fail(`Unexpected asset destination: ${destination}`);
  await mkdir(dirname(destination), { recursive: true });
  if (await fileExists(destination)) {
    const current = await stat(destination);
    if (current.size === asset.sizeBytes && await sha256File(destination) === asset.sha256) return;
  }
  const partPath = `${destination}.part`;
  // Large assets come from hosts that occasionally drop a connection mid-stream. Retry with backoff,
  // resuming from the partial via Range, so a reset near the end is not paid for in full.
  for (let attempt = 1; ; attempt += 1) {
    const resumeAt = await fileExists(partPath) ? (await stat(partPath)).size : 0;
    try {
      const response = await fetchImpl(asset.url, {
        headers: resumeAt > 0 ? { Range: `bytes=${resumeAt}-` } : undefined,
        redirect: 'follow',
      });
      if (!response.ok) fail(`Asset download failed (${response.status}): ${asset.url}`);
      // Only append when the server actually honoured the range (206). A server that ignores Range
      // replies 200 with the whole body, which must overwrite rather than be appended to a partial.
      const append = resumeAt > 0 && response.status === 206;
      await pipeline(response.body, createWriteStream(partPath, { flags: append ? 'a' : 'w' }));
      break;
    } catch (error) {
      // A failed status is a hard error, not a transient network drop — do not retry it.
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Asset download failed') || attempt >= MAX_DOWNLOAD_ATTEMPTS) throw error;
      log(`scrollcase: asset ${asset.relativePath} attempt ${attempt} failed (${message}); retrying.`);
      await wait(2000 * attempt);
    }
  }
  const downloaded = await stat(partPath);
  if (downloaded.size !== asset.sizeBytes) fail(`Asset size mismatch for ${asset.relativePath}.`);
  if (await sha256File(partPath) !== asset.sha256) {
    // A full-size partial with the wrong digest cannot be resumed: asking for bytes after its end
    // would either fail forever or append unrelated data. Remove it so the next build starts from
    // byte zero and has a chance to recover from a corrupt mirror response.
    await rm(partPath, { force: true });
    fail(`Asset SHA-256 mismatch for ${asset.relativePath}.`);
  }
  await rename(partPath, destination);
}

/** Copies a file from the project into the payload after verifying its declared hash. */
export async function copyVerifiedLocalFile(file, payloadDir, projectRoot) {
  const source = join(projectRoot, safeRelativePath(file.sourcePath));
  if (!await fileExists(source) || !(await stat(source)).isFile()) {
    fail(`Local box file is missing: ${file.sourcePath}`);
  }
  if (await sha256File(source) !== file.sha256) {
    fail(`Local box file SHA-256 mismatch: ${file.sourcePath}`);
  }
  const destination = join(payloadDir, safeRelativePath(file.relativePath));
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

/**
 * Moves a built file to the name it is published under, without ever leaving two copies behind.
 *
 * A box archive is measured in gigabytes, so this renames rather than copies: on one filesystem the
 * bytes never move at all. The copy-and-remove fallback is for the case a project points its build
 * and dist directories at different volumes, where rename cannot work.
 */
export async function moveIntoPlace(source, destination) {
  await rm(destination, { force: true });
  try {
    await rename(source, destination);
  } catch {
    await copyFile(source, destination);
    await rm(source, { force: true });
  }
}

/**
 * Unpacks a downloaded archive into the payload tree.
 *
 * Entries are listed and validated *before* extraction (archive-slip defence). `stripComponents`
 * drops the redundant top-level wrapper directory many published archives carry; it insists on
 * finding exactly one directory to strip, so a surprising layout fails loudly rather than producing
 * a wrong tree.
 */
export async function expandAssetArchive(payloadDir, archive) {
  const archivePath = join(payloadDir, safeRelativePath(archive.relativePath));
  const destination = join(payloadDir, safeRelativePath(archive.destination));
  await extractArchive(archivePath, archive.format, destination, Number(archive.stripComponents ?? 0));
  // The compressed original is dead weight inside the payload once unpacked.
  if (archive.removeAfterExtract !== false) await rm(archivePath, { force: true });
}
