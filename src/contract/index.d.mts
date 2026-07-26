/**
 * Absolute URL of a shipped JSON Schema, for consumers that validate documents themselves.
 *
 * @param {'target' | 'recipe' | 'box-manifest' | 'release-manifest' | 'channel-manifest'
 *   | 'revocations-manifest' | 'signed-document'} name
 * @returns {URL}
 */
export function schemaUrl(name: "target" | "recipe" | "box-manifest" | "release-manifest" | "channel-manifest" | "revocations-manifest" | "signed-document"): URL;
/**
 * Absolute URL of a shipped fixture file, for consumers proving a mirror implementation.
 *
 * @param {string} name fixture file name without its extension
 * @returns {URL}
 */
export function fixtureUrl(name: string): URL;
export { assertNativeHost, assertPythonEntryPoint, condaSubdir, pixiAccelerator, boxTargetAdapter, boxTargetAdapters, boxTargetId } from "./targets.mjs";
export { CHANNELS, DEFAULT_DOCUMENT_NAMESPACE, PAYLOAD_ENCODING, BOX_SCHEMA_VERSION, SIGNATURE_ALGORITHM, decodeDocumentPayload, documentKinds, isSignedBoxDocument, parseDocumentKind } from "./documents.mjs";
