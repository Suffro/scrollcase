/**
 * Returns the `kind` discriminator for each document type under a namespace.
 *
 * Pass the namespace a project has already published under to keep its documents byte-compatible;
 * omit it for a new project.
 *
 * @param {string} [namespace] defaults to `scrollcase.box`
 * @returns {Readonly<{ release: string, channel: string, revocations: string }>}
 * @throws {TypeError} when the namespace is not a dotted lowercase identifier
 */
export function documentKinds(namespace?: string): Readonly<{
    release: string;
    channel: string;
    revocations: string;
}>;
/**
 * Splits a `kind` back into its namespace and document type, or returns null if it is not one.
 *
 * @param {unknown} kind
 * @returns {{ namespace: string, type: 'release' | 'channel' | 'revocations' } | null} null when
 *   the value is not a document kind at all
 */
export function parseDocumentKind(kind: unknown): {
    namespace: string;
    type: "release" | "channel" | "revocations";
} | null;
/**
 * Reports whether a value is a structurally valid signed envelope.
 *
 * This is a shape check, not a verification: it says the document is worth attempting to verify,
 * never that its signature is good. Callers must still verify the payload hash and at least one
 * signature against a trusted key before acting on the contents.
 *
 * @param {unknown} value
 * @returns {value is import('./types/index.d.ts').SignedBoxDocument} true when the envelope is
 *   well formed and therefore worth verifying — never that its signature is valid
 */
export function isSignedBoxDocument(value: unknown): value is import("./types/index.d.ts").SignedBoxDocument;
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
/** Format version carried by every document this contract describes. */
export const BOX_SCHEMA_VERSION: 1;
/** The only payload encoding the format defines. */
export const PAYLOAD_ENCODING: "base64-json-utf8";
/** The only signature algorithm the format defines. */
export const SIGNATURE_ALGORITHM: "ed25519";
/**
 * Namespace prefixing every document's `kind` discriminator.
 *
 * A project that already publishes boxes owns its own namespace and must keep emitting it, or its
 * installed clients stop recognizing the documents they are handed. So the namespace is the
 * consumer's to declare, not the tool's to impose: this is only the default used by a project that
 * has no published history to preserve.
 */
export const DEFAULT_DOCUMENT_NAMESPACE: "scrollcase.box";
/** Channels a box may be published to, ordered from least to most stable. */
export const CHANNELS: readonly string[];
