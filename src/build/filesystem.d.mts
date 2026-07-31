/**
 * Returns whether a filesystem entry exists without exposing platform-specific error codes.
 *
 * @param {string} path
 * @returns {Promise<boolean>}
 */
export function fileExists(path: string): Promise<boolean>;
/**
 * Compares machine-facing identifiers by code unit, independent of host locale and ICU data.
 *
 * @param {string} left
 * @param {string} right
 * @returns {-1 | 0 | 1}
 */
export function compareStableStrings(left: string, right: string): -1 | 0 | 1;
/**
 * Rejects paths that could escape a box staging directory.
 *
 * @param {unknown} value
 * @returns {string} the path, normalised to forward slashes
 * @throws {Error} when the path is absolute, empty, contains `..`, a drive letter or a NUL
 */
export function safeRelativePath(value: unknown): string;
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
export function collectEntries(root: string, current?: string): Promise<Array<{
    path: string;
    kind: "file" | "link";
    linkTarget?: string;
}>>;
/**
 * Lists every payload path — files and links alike — in the stable archive order.
 *
 * Callers asking "is this path in the box" want a link to count, because a linked path is a path
 * that resolves. Callers that must read or rewrite bytes want `collectRegularFiles` instead.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export function collectFiles(root: string): Promise<string[]>;
/**
 * Lists only the payload paths backed by their own bytes.
 *
 * Anything that rewrites file contents belongs here rather than on `collectFiles`: writing through
 * a link would edit the target a second time, once under its own name and once under the link's.
 *
 * @param {string} root
 * @returns {Promise<string[]>}
 */
export function collectRegularFiles(root: string): Promise<string[]>;
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
export function payloadSize(root: string): Promise<number>;
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
export function validateExtractedTree(root: string, { allowLinks, current }?: {
    allowLinks?: boolean;
    current?: string;
}): Promise<void>;
/**
 * Applies the archive timestamp to every payload entry.
 *
 * `lutimes` stamps the link itself rather than following it to its target, which would otherwise be
 * stamped once under its own name and again through every link that points at it.
 *
 * @param {string} root
 * @returns {Promise<void>}
 */
export function normalizeTree(root: string): Promise<void>;
/**
 * Streams a file into SHA-256 without buffering large boxes in memory.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
export function sha256File(path: string): Promise<string>;
/**
 * The single mtime every archived file carries. Any fixed instant works — what matters is that it
 * never varies between builds; this one is simply a recognisable round date safely past the 1980
 * floor of DOS/ZIP timestamps.
 */
export const FIXED_ARCHIVE_TIME: Date;
