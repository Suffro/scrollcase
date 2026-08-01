/**
 * Reference implementation of the Scrollcase signed-document envelope.
 *
 * Signed documents carry their payload as exact base64-encoded JSON rather than canonicalized JSON.
 * That choice is deliberate: verifying a signature then means hashing bytes that were transmitted
 * verbatim, so Node, Rust, a Worker, and any future client agree without each maintaining a
 * canonical-JSON implementation — historically the richest source of cross-language signature bugs.
 */

import { createHash } from 'node:crypto';
import { isSignedBoxDocument } from './document-shape.mjs';

export {
  BOX_SCHEMA_VERSION,
  CHANNELS,
  DEFAULT_DOCUMENT_NAMESPACE,
  PAYLOAD_ENCODING,
  SIGNATURE_ALGORITHM,
  documentKinds,
  isSignedBoxDocument,
  parseDocumentKind,
} from './document-shape.mjs';

/**
 * Decodes an envelope's payload without verifying any signature.
 *
 * Throws when the envelope is malformed or when the embedded payload hash does not match the bytes,
 * which catches a truncated or edited document before its contents are ever read.
 *
 * @param {import('./types/index.d.ts').SignedBoxDocument} document
 * @returns {unknown} the decoded payload, still unverified
 * @throws {TypeError} when the envelope is malformed
 * @throws {Error} when the embedded payload hash does not match the bytes
 */
export function decodeDocumentPayload(document) {
  if (document?.schemaVersion === 1) {
    throw new TypeError('Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.');
  }
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
