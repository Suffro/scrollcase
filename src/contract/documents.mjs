/**
 * Reference implementation of the Scrollcase signed-document envelope.
 *
 * Signed documents carry their payload as exact base64-encoded JSON rather than canonicalized JSON.
 * That choice is deliberate: verifying a signature then means hashing bytes that were transmitted
 * verbatim, so Node, Rust, a Worker, and any future client agree without each maintaining a
 * canonical-JSON implementation — historically the richest source of cross-language signature bugs.
 */

import { createHash } from 'node:crypto';

/** Format version carried by every document this contract describes. */
export const BOX_SCHEMA_VERSION = 1;

/** The only payload encoding the format defines. */
export const PAYLOAD_ENCODING = 'base64-json-utf8';

/** The only signature algorithm the format defines. */
export const SIGNATURE_ALGORITHM = 'ed25519';

/**
 * Namespace prefixing every document's `kind` discriminator.
 *
 * A project that already publishes boxes owns its own namespace and must keep emitting it, or its
 * installed clients stop recognizing the documents they are handed. So the namespace is the
 * consumer's to declare, not the tool's to impose: this is only the default used by a project that
 * has no published history to preserve.
 */
export const DEFAULT_DOCUMENT_NAMESPACE = 'scrollcase.box';

const DOCUMENT_TYPES = Object.freeze(['release', 'channel', 'revocations']);
const NAMESPACE_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

/**
 * Returns the `kind` discriminator for each document type under a namespace.
 *
 * Pass the namespace a project has already published under to keep its documents byte-compatible;
 * omit it for a new project.
 */
export function documentKinds(namespace = DEFAULT_DOCUMENT_NAMESPACE) {
  if (typeof namespace !== 'string' || !NAMESPACE_PATTERN.test(namespace)) {
    throw new TypeError(`Invalid document namespace: ${namespace}`);
  }
  return Object.freeze(Object.fromEntries(
    DOCUMENT_TYPES.map((type) => [type, `${namespace}.${type}`]),
  ));
}

/** Splits a `kind` back into its namespace and document type, or returns null if it is not one. */
export function parseDocumentKind(kind) {
  if (typeof kind !== 'string') return null;
  const separator = kind.lastIndexOf('.');
  if (separator <= 0) return null;
  const namespace = kind.slice(0, separator);
  const type = kind.slice(separator + 1);
  if (!DOCUMENT_TYPES.includes(type) || !NAMESPACE_PATTERN.test(namespace)) return null;
  return { namespace, type };
}

/** Channels a box may be published to, ordered from least to most stable. */
export const CHANNELS = Object.freeze(['development', 'beta', 'stable']);

/**
 * Reports whether a value is a structurally valid signed envelope.
 *
 * This is a shape check, not a verification: it says the document is worth attempting to verify,
 * never that its signature is good. Callers must still verify the payload hash and at least one
 * signature against a trusted key before acting on the contents.
 */
export function isSignedBoxDocument(value) {
  if (!value || typeof value !== 'object') return false;
  return value.schemaVersion === BOX_SCHEMA_VERSION
    && value.payloadEncoding === PAYLOAD_ENCODING
    && typeof value.payloadBase64 === 'string'
    && typeof value.payloadSha256 === 'string'
    && Array.isArray(value.signatures)
    && value.signatures.length > 0
    && value.signatures.every((signature) => signature?.algorithm === SIGNATURE_ALGORITHM
      && typeof signature.keyId === 'string'
      && typeof signature.signatureBase64 === 'string');
}

/**
 * Decodes an envelope's payload without verifying any signature.
 *
 * Throws when the envelope is malformed or when the embedded payload hash does not match the bytes,
 * which catches a truncated or edited document before its contents are ever read.
 */
export function decodeDocumentPayload(document) {
  if (!isSignedBoxDocument(document)) {
    throw new TypeError('Not a signed box document');
  }
  const bytes = Buffer.from(document.payloadBase64, 'base64');
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== document.payloadSha256) {
    throw new Error('Signed box payload hash does not match its bytes');
  }
  return JSON.parse(bytes.toString('utf8'));
}
