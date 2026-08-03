/**
 * One payload entry as the digest sees it.
 *
 * `contentSha256` hashes the file's bytes for a regular file, and the UTF-8 bytes of the link body
 * for a link. A link is never opened: hashing what it points at would record the target's content
 * twice, once under its own name and once under the link's, and would make a link indistinguishable
 * from a copy — which is exactly the distinction the `kind` byte exists to keep.
 *
 * @typedef {object} PayloadDigestEntry
 * @property {string} path payload-relative, forward slashes
 * @property {'file' | 'link'} kind
 * @property {string} contentSha256 lowercase hex
 */
/**
 * Serialises payload entries into the canonical bytes a release commits to.
 *
 * The format name is inside the stream rather than only beside it in the manifest, so a later
 * revision cannot produce the same bytes for different rules, and the `format` field cannot be
 * swapped without the hash noticing.
 *
 * Records are sorted by their own bytes rather than by their paths compared as strings. The two are
 * the same ordering — a path cannot contain NUL, and NUL sorts below every byte a path can hold, so
 * the delimiter decides every comparison that the path itself does not — but only one of them is
 * unambiguous across languages. Comparing strings would ask each implementation to agree on what a
 * string is: this repository's own two already disagree above the Basic Multilingual Plane, where
 * JavaScript orders by UTF-16 code unit and Python by code point.
 *
 * @param {Iterable<PayloadDigestEntry>} entries
 * @returns {Uint8Array}
 */
export function payloadDigestStream(entries: Iterable<PayloadDigestEntry>): Uint8Array;
/**
 * Reads a list back into entries, refusing anything a serialiser could not have produced.
 *
 * This parses bytes that arrived with the tree they describe, so it is written as a scanner over a
 * fixed frame rather than a split on separators: a newline is legal inside a filename, and only the
 * NUL delimiter and the fixed-width hash field make the framing unambiguous. A caller must have
 * already compared the stream's hash against the signed release — parsing is not a trust decision,
 * and nothing here makes untrusted bytes safe.
 *
 * @param {Uint8Array} bytes
 * @returns {PayloadDigestEntry[]}
 * @throws {TypeError} when the stream is not exactly what `payloadDigestStream` emits
 */
export function parsePayloadDigestStream(bytes: Uint8Array): PayloadDigestEntry[];
/**
 * The rule deciding what a box commits to about its own extracted tree.
 *
 * A signed release commits to the archive's SHA-256, which proves every payload byte — but only
 * while the archive still exists. An application that installs a box once and runs it for months
 * has thrown that archive away, and `installedSizeBytes` is a free-space figure, not an identity.
 * So a box also carries a *list*: one record per payload entry, naming it and hashing its content.
 * The release signs the SHA-256 of that list, and the list travels inside the payload, which keeps
 * the signed document one field longer instead of megabytes longer — a conda prefix routinely holds
 * twenty thousand files.
 *
 * The list is what makes verification a closed question. A verifier walks the *list*, never the
 * directory, so anything the list does not name is never visited: the `__pycache__` Python writes on
 * first import, the model cache a caller fills after extraction, the file an application writes into
 * its own working directory. Those are invisible by construction rather than by an exclusion list
 * that would have to be guessed at and kept in step.
 *
 * **Rejected:** hashing a walk of the installed tree into a single root value. It reads as the same
 * guarantee for a fraction of the format, but the directory is then the input, so every one of those
 * legitimate extra files makes an honest box fail verification.
 *
 * What a record deliberately omits is as load-bearing as what it carries:
 *
 * - **Mode.** `archiveFileMode` synthesises `0o755`/`0o644` from the target and the path rather than
 *   preserving what the packed prefix had, so a digest over observed modes could never match an
 *   extracted tree, and a digest over canonical modes would hash two values the release already
 *   carries. Windows extraction skips `chmod` entirely, which decides it a third time.
 * - **Modification time.** The payload is stamped with one fixed instant before archiving, but no
 *   extractor restores it; installed files carry the wall-clock of their install.
 * - **Directories.** Neither the entry collector nor the archive writer represents one, so an empty
 *   directory is already lost between build and install.
 *
 * Nothing here touches a filesystem or a hash implementation. The same entries give the same bytes
 * on every host and in every language, which is what lets the builder, both consumers, and any
 * future third implementation apply one rule instead of three approximations of it. They prove the
 * mirror against `fixtures/payload-digest-contract.json`.
 */
/** The `format` a release names, and the first line of the stream it names it for. */
export const PAYLOAD_DIGEST_FORMAT: "sha256-path-list-v1";
/**
 * Where the list lives inside the payload.
 *
 * It cannot appear in its own records — a file cannot contain its own hash — so the release commits
 * to it directly and it commits to everything else.
 */
export const PAYLOAD_DIGEST_FILE: "payload-digest.v1";
/**
 * The largest list a verifier will read before refusing.
 *
 * At roughly a hundred bytes per record this is some two million entries, an order of magnitude past
 * the densest real prefix. The bound exists because the list arrives from the same untrusted tree it
 * describes, and reading it must not be the thing that exhausts memory.
 */
export const MAX_PAYLOAD_DIGEST_BYTES: number;
/**
 * One payload entry as the digest sees it.
 *
 * `contentSha256` hashes the file's bytes for a regular file, and the UTF-8 bytes of the link body
 * for a link. A link is never opened: hashing what it points at would record the target's content
 * twice, once under its own name and once under the link's, and would make a link indistinguishable
 * from a copy — which is exactly the distinction the `kind` byte exists to keep.
 */
export type PayloadDigestEntry = {
    /**
     * payload-relative, forward slashes
     */
    path: string;
    kind: "file" | "link";
    /**
     * lowercase hex
     */
    contentSha256: string;
};
