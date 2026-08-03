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
import { access, lstat, lutimes, readdir, readlink } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  PAYLOAD_DIGEST_FILE,
  PAYLOAD_DIGEST_FORMAT,
  payloadDigestStream,
} from '../contract/payload-digest.mjs';
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
 * Compares machine-facing identifiers by code unit, independent of host locale and ICU data.
 *
 * @param {string} left
 * @param {string} right
 * @returns {-1 | 0 | 1}
 */
export function compareStableStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
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

/**
 * Lists payload entries in the stable order used by hashing and archive creation.
 *
 * A payload may hold regular files and the narrow class of symbolic links `src/contract/links.mjs`
 * permits; anything else — a socket, a device, a fifo — is still refused, because nothing that is
 * not one of those two things can be archived, hashed or relocated meaningfully.
 *
 * @param {string} root
 * @param {string} [current]
 * @returns {Promise<Array<{ path: string, kind: 'file' | 'link', linkTarget?: string }>>}
 */
export async function collectEntries(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const collected = [];
  for (const entry of entries.sort((a, b) => compareStableStrings(a.name, b.name))) {
    if (entry.name === '__pycache__' || entry.name === '.DS_Store' || entry.name.endsWith('.pyc')) continue;
    const fullPath = join(current, entry.name);
    const path = relative(root, fullPath).split(sep).join('/');
    // Order matters: a symlink to a directory reports isDirectory() as false but would be walked
    // into by isDirectory() checks that stat rather than lstat, so links are classified first.
    if (entry.isSymbolicLink()) {
      collected.push({ path, kind: 'link', linkTarget: (await readlink(fullPath)).split(sep).join('/') });
    } else if (entry.isDirectory()) {
      collected.push(...await collectEntries(root, fullPath));
    } else if (entry.isFile()) {
      collected.push({ path, kind: 'file' });
    } else {
      fail(`box special entries are not allowed: ${path}`);
    }
  }
  return collected;
}

/**
 * Lists every payload path — files and links alike — in the stable archive order.
 *
 * Callers asking "is this path in the box" want a link to count, because a linked path is a path
 * that resolves. Callers that must read or rewrite bytes want `collectRegularFiles` instead.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function collectFiles(root) {
  return (await collectEntries(root)).map((entry) => entry.path);
}

/**
 * Lists only the payload paths backed by their own bytes.
 *
 * Anything that rewrites file contents belongs here rather than on `collectFiles`: writing through
 * a link would edit the target a second time, once under its own name and once under the link's.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export async function collectRegularFiles(root) {
  return (await collectEntries(root)).filter((entry) => entry.kind === 'file').map((entry) => entry.path);
}

/**
 * Sums what a box actually occupies once extracted.
 *
 * `lstat`, not `stat`: a link costs its own few bytes, not the size of what it points at. Counting
 * the target would restore on paper exactly the duplication that preserving links removes from
 * disk, and this number is what a consumer checks free space against.
 *
 * @param {string} root
 * @returns {Promise<number>}
 */
export async function payloadSize(root) {
  let total = 0;
  for (const file of await collectFiles(root)) {
    total += (await lstat(join(root, ...file.split('/')))).size;
    if (!Number.isSafeInteger(total)) fail('box installed size exceeds the safe integer range.');
  }
  return total;
}

/**
 * Rejects links and special nodes before an extracted tree is copied.
 *
 * This guards a *scroll-declared asset archive* — a third-party tar or zip a project points at —
 * whose contents are then copied into the payload. A link here is not the narrow, checked kind a
 * box may carry: it arrives from outside, and the copy that follows would write through it. The
 * links a payload does carry come from the packed conda prefix, which is a different path with its
 * own contract check, so this stays as strict as it has always been.
 *
 * A box archive is the one caller that passes `allowLinks`, because its links were each checked
 * against the contract rule before extraction wrote them. Every other caller keeps the default.
 *
 * @param {string} root
 * @param {{ allowLinks?: boolean, current?: string }} [options]
 * @returns {Promise<void>}
 */
export async function validateExtractedTree(root, { allowLinks = false, current = root } = {}) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    if (entry.isSymbolicLink()) {
      if (allowLinks) continue;
      fail(`Archive links and special entries are not allowed: ${relative(root, fullPath)}`);
    }
    if (entry.isDirectory()) await validateExtractedTree(root, { allowLinks, current: fullPath });
    else if (!entry.isFile()) fail(`Archive special entries are not allowed: ${relative(root, fullPath)}`);
  }
}

/**
 * Applies the archive timestamp to every payload entry.
 *
 * `lutimes` stamps the link itself rather than following it to its target, which would otherwise be
 * stamped once under its own name and again through every link that points at it.
 *
 * @param {string} root
 * @returns {Promise<void>}
 */
export async function normalizeTree(root) {
  for (const file of await collectFiles(root)) {
    await lutimes(join(root, ...file.split('/')), FIXED_ARCHIVE_TIME, FIXED_ARCHIVE_TIME);
  }
}

/**
 * Streams a file into SHA-256 without buffering large boxes in memory.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/**
 * Describes every payload entry the way `src/contract/payload-digest.mjs` records it.
 *
 * A link is hashed by its target string rather than opened, because `sha256File` would follow it
 * and record the target's bytes a second time under the link's name — which is also what would make
 * a link and a copy indistinguishable.
 *
 * The list file itself is skipped, and by name rather than by when it happens to exist: the build
 * computes this before writing it and a verifier computes it after, and the two must produce one
 * answer. It could not be listed anyway, since a file cannot carry its own hash.
 *
 * @param {string} root
 * @returns {Promise<import('../contract/payload-digest.mjs').PayloadDigestEntry[]>}
 */
export async function payloadDigestEntries(root) {
  const described = [];
  for (const entry of await collectEntries(root)) {
    if (entry.path === PAYLOAD_DIGEST_FILE) continue;
    described.push({
      path: entry.path,
      kind: entry.kind,
      contentSha256: entry.kind === 'link'
        ? createHash('sha256').update(entry.linkTarget ?? '', 'utf8').digest('hex')
        : await sha256File(join(root, ...entry.path.split('/'))),
    });
  }
  return described;
}

/**
 * Computes what a release commits to about one extracted tree.
 *
 * This reads every payload byte, which on a box carrying embedded weights is tens of gigabytes. The
 * cost is deliberate and paid in three places only — once per build, once per `--self-test`, and
 * once per explicit payload verification — never on the path that merely prepares or runs a box.
 *
 * @param {string} root
 * @returns {Promise<{ format: string, sha256: string }>}
 */
export async function payloadDigest(root) {
  const stream = payloadDigestStream(await payloadDigestEntries(root));
  return { format: PAYLOAD_DIGEST_FORMAT, sha256: createHash('sha256').update(stream).digest('hex') };
}
