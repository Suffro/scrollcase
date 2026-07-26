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
export function decodeDocumentPayload(document: import("./types/index.d.ts").SignedBoxDocument): unknown;
export { BOX_SCHEMA_VERSION, CHANNELS, DEFAULT_DOCUMENT_NAMESPACE, PAYLOAD_ENCODING, SIGNATURE_ALGORITHM, documentKinds, isSignedBoxDocument, parseDocumentKind } from "./document-shape.mjs";
