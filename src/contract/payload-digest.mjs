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
export const PAYLOAD_DIGEST_FORMAT = 'sha256-path-list-v1';

/**
 * Where the list lives inside the payload.
 *
 * It cannot appear in its own records — a file cannot contain its own hash — so the release commits
 * to it directly and it commits to everything else.
 */
export const PAYLOAD_DIGEST_FILE = 'payload-digest.v1';

/**
 * The largest list a verifier will read before refusing.
 *
 * At roughly a hundred bytes per record this is some two million entries, an order of magnitude past
 * the densest real prefix. The bound exists because the list arrives from the same untrusted tree it
 * describes, and reading it must not be the thing that exhausts memory.
 */
export const MAX_PAYLOAD_DIGEST_BYTES = 256 * 1024 * 1024;

const NUL = 0x00;
const LF = 0x0a;
const KIND_BYTE = Object.freeze({ file: 0x66, link: 0x6c });
const BYTE_KIND = Object.freeze({ 0x66: 'file', 0x6c: 'link' });
const SHA256_HEX = /^[0-9a-f]{64}$/;
const SHA256_HEX_LENGTH = 64;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Orders two records by their bytes, ascending.
 *
 * @param {Uint8Array} left
 * @param {Uint8Array} right
 * @returns {-1 | 0 | 1}
 */
function compareBytes(left, right) {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    if (left[index] !== right[index]) return left[index] < right[index] ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

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
export function payloadDigestStream(entries) {
  const records = [];
  const seen = new Set();
  for (const entry of entries) {
    const kindByte = KIND_BYTE[/** @type {'file' | 'link'} */ (entry?.kind)];
    if (kindByte === undefined) {
      throw new TypeError(`Unsupported payload entry kind: ${String(entry?.kind)}`);
    }
    const path = String(entry.path);
    // Asserted rather than assumed: a NUL would end the path field early and let two different
    // trees produce one stream. `safeRelativePath` already refuses it, and POSIX cannot express it.
    if (path === '' || path.includes('\0')) {
      throw new TypeError(`Unsupported payload entry path: ${JSON.stringify(path)}`);
    }
    if (seen.has(path)) throw new TypeError(`Duplicate payload entry: ${path}`);
    seen.add(path);
    if (!SHA256_HEX.test(String(entry.contentSha256))) {
      throw new TypeError(`Invalid payload entry digest for ${path}: ${String(entry.contentSha256)}`);
    }

    const pathBytes = encoder.encode(path);
    const record = new Uint8Array(pathBytes.length + SHA256_HEX_LENGTH + 4);
    record.set(pathBytes, 0);
    let cursor = pathBytes.length;
    record[cursor] = NUL;
    record[cursor += 1] = kindByte;
    record[cursor += 1] = NUL;
    record.set(encoder.encode(entry.contentSha256), cursor += 1);
    record[record.length - 1] = LF;
    records.push(record);
  }
  records.sort(compareBytes);

  const header = encoder.encode(`${PAYLOAD_DIGEST_FORMAT}\n`);
  const total = records.reduce((sum, record) => sum + record.length, header.length);
  const stream = new Uint8Array(total);
  stream.set(header, 0);
  let offset = header.length;
  for (const record of records) {
    stream.set(record, offset);
    offset += record.length;
  }
  return stream;
}

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
export function parsePayloadDigestStream(bytes) {
  const header = encoder.encode(`${PAYLOAD_DIGEST_FORMAT}\n`);
  if (bytes.length < header.length || compareBytes(bytes.subarray(0, header.length), header) !== 0) {
    throw new TypeError('Payload digest list does not carry the expected format header.');
  }

  const entries = [];
  const seen = new Set();
  let cursor = header.length;
  let previous = null;
  while (cursor < bytes.length) {
    const start = cursor;
    const pathEnd = bytes.indexOf(NUL, cursor);
    if (pathEnd < 0) throw new TypeError('Payload digest list ends inside a record.');
    // The frame after the path is fixed: kind, NUL, sixty-four hex digits, newline.
    const end = pathEnd + SHA256_HEX_LENGTH + 4;
    if (end > bytes.length) throw new TypeError('Payload digest list ends inside a record.');
    const kind = BYTE_KIND[bytes[pathEnd + 1]];
    if (!kind || bytes[pathEnd + 2] !== NUL || bytes[end - 1] !== LF) {
      throw new TypeError('Payload digest list holds a malformed record.');
    }

    let path;
    let contentSha256;
    try {
      path = decoder.decode(bytes.subarray(start, pathEnd));
      contentSha256 = decoder.decode(bytes.subarray(pathEnd + 3, end - 1));
    } catch {
      throw new TypeError('Payload digest list holds bytes that are not valid UTF-8.');
    }
    if (!SHA256_HEX.test(contentSha256)) {
      throw new TypeError(`Payload digest list holds an invalid digest for ${path}.`);
    }
    if (seen.has(path)) throw new TypeError(`Payload digest list names ${path} twice.`);
    seen.add(path);

    // Order is part of the format, not a convenience: a reader that accepted any order would accept
    // streams the builder cannot emit, and two trees could then share one hash.
    const record = bytes.subarray(start, end);
    if (previous && compareBytes(previous, record) >= 0) {
      throw new TypeError('Payload digest list is not in canonical order.');
    }
    previous = record;

    entries.push({ path, kind, contentSha256 });
    cursor = end;
  }
  return entries;
}
