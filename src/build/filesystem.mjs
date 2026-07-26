/**
 * Filesystem primitives shared by the build, archive, and verify layers.
 *
 * Two invariants live here. Determinism: payload files are always enumerated in one stable order
 * and stamped with one fixed timestamp, so hashing and archiving the same tree twice produces the
 * same bytes. Safety: every relative path that will be joined to a directory is screened against
 * traversal, and trees that will enter a box are refused if they contain links or special nodes.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, readdir, stat, utimes } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fail } from './process.mjs';

/**
 * The single mtime every archived file carries. Any fixed instant works — what matters is that it
 * never varies between builds; this one is simply a recognisable round date safely past the 1980
 * floor of DOS/ZIP timestamps.
 */
export const FIXED_ARCHIVE_TIME = new Date('2000-01-01T00:00:00.000Z');

/**
 * Returns whether a filesystem entry exists without exposing platform-specific error codes.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rejects paths that could escape a box staging directory.
 *
 * @param {unknown} value
 * @returns {string} the path, normalised to forward slashes
 * @throws {Error} when the path is absolute, empty, contains `..`, a drive letter or a NUL
 */
export function safeRelativePath(value) {
  const normalized = String(value).replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) {
    fail(`Unsafe relative path: ${value}`);
  }
  if (/^[A-Za-z]:\//.test(normalized)
    || normalized.split('/').some((part) => part === '..' || part === '')) {
    fail(`Unsafe relative path: ${value}`);
  }
  return normalized;
}

/** Lists payload files in the stable order used by hashing and archive creation. */
export async function collectFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '__pycache__' || entry.name === '.DS_Store' || entry.name.endsWith('.pyc')) continue;
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, fullPath));
    else if (entry.isFile()) files.push(relative(root, fullPath).split(sep).join('/'));
    else fail(`box links and special entries are not allowed: ${relative(root, fullPath)}`);
  }
  return files;
}

/** Sums the logical size of the exact regular files in a box tree. */
export async function payloadSize(root) {
  let total = 0;
  for (const file of await collectFiles(root)) {
    total += (await stat(join(root, ...file.split('/')))).size;
    if (!Number.isSafeInteger(total)) fail('box installed size exceeds the safe integer range.');
  }
  return total;
}

/** Rejects links and special nodes before an extracted tree is copied. */
export async function validateExtractedTree(root, current = root) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      fail(`Archive links and special entries are not allowed: ${relative(root, fullPath)}`);
    }
    if (entry.isDirectory()) await validateExtractedTree(root, fullPath);
    else if (!entry.isFile()) fail(`Archive special entries are not allowed: ${relative(root, fullPath)}`);
  }
}

/** Applies the archive timestamp to every payload file. */
export async function normalizeTree(root) {
  for (const file of await collectFiles(root)) {
    await utimes(join(root, ...file.split('/')), FIXED_ARCHIVE_TIME, FIXED_ARCHIVE_TIME);
  }
}

/** Streams a file into SHA-256 without buffering large boxes in memory. */
export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
