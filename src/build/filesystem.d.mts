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
 * Lists payload files in the stable order used by hashing and archive creation.
 *
 * @param {string} root
 * @param {string} [current]
 * @returns {Promise<string[]>}
 */
export function collectFiles(root: string, current?: string): Promise<string[]>;
/**
 * Sums the logical size of the exact regular files in a box tree.
 *
 * @param {string} root
 * @returns {Promise<number>}
 */
export function payloadSize(root: string): Promise<number>;
/**
 * Rejects links and special nodes before an extracted tree is copied.
 *
 * @param {string} root
 * @param {string} [current]
 * @returns {Promise<void>}
 */
export function validateExtractedTree(root: string, current?: string): Promise<void>;
/**
 * Applies the archive timestamp to every payload file.
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
