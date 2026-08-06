/**
 * Creates an ed25519 signing pair.
 *
 * Overwriting an existing key is gated behind `force` because doing so silently would invalidate
 * every document previously signed with it, with no way to tell which.
 *
 * @param {{ privatePath: string, publicPath: string, keyId?: string | null, force?: boolean }} options
 * @returns {Promise<{ keyId: string, privatePath: string, publicPath: string }>}
 * @throws {Error} when a key already exists and `force` was not passed
 */
export function generateSigningKey({ privatePath, publicPath, keyId, force }: {
    privatePath: string;
    publicPath: string;
    keyId?: string | null;
    force?: boolean;
}): Promise<{
    keyId: string;
    privatePath: string;
    publicPath: string;
}>;
/**
 * Loads the private key and cross-checks it against the published public key file, so a mismatched
 * pair is caught here rather than producing documents nobody can verify.
 *
 * @param {{ privatePath: string, publicPath: string }} options
 * @returns {Promise<{ privateKey: import('node:crypto').KeyObject, metadata: TrustedKey }>}
 * @throws {Error} when the key is missing, or the pair does not match
 */
export function readSigningKey({ privatePath, publicPath }: {
    privatePath: string;
    publicPath: string;
}): Promise<{
    privateKey: import("node:crypto").KeyObject;
    metadata: TrustedKey;
}>;
/**
 * Reads the two trust-file shapes from bytes or text a caller already holds.
 *
 * The point is that an application keeping its keys somewhere other than a file — a keyring, an
 * environment variable, a secrets manager — no longer has to write them to disk to use them, which
 * put key material on disk purely to satisfy a signature.
 *
 * @param {string | Buffer} source the contents of a trust file, not a path to one
 * @returns {TrustedKey[]}
 */
export function parseTrustedKeys(source: string | Buffer): TrustedKey[];
/**
 * Resolves the one trust source a caller named into the keys verification runs against.
 *
 * Exactly one, never both and never neither: a caller that names two sources has not decided which
 * keys it trusts, and silently preferring one of them would decide for it.
 *
 * @param {{ publicPath?: string | null, trustedKeys?: TrustedKey[] | null }} options
 * @returns {Promise<TrustedKey[]>}
 */
export function resolveTrustedKeys({ publicPath, trustedKeys }?: {
    publicPath?: string | null;
    trustedKeys?: TrustedKey[] | null;
}): Promise<TrustedKey[]>;
/**
 * Signs payload bytes with a local key, producing the envelope the format defines.
 *
 * @param {Buffer} payloadBytes the exact bytes to sign, which are also the bytes published
 * @param {{ privateKey: import('node:crypto').KeyObject, metadata: TrustedKey }} key
 * @returns {import('../contract/types/index.d.ts').SignedBoxDocument}
 */
export function signWithLocalKey(payloadBytes: Buffer, { privateKey, metadata }: {
    privateKey: import("node:crypto").KeyObject;
    metadata: TrustedKey;
}): import("../contract/types/index.d.ts").SignedBoxDocument;
/**
 * Unwraps an envelope and checks its checksum. Does *not* check the signature.
 *
 * @param {import('../contract/types/index.d.ts').SignedBoxDocument} document
 * @returns {{ bytes: Buffer, payload: unknown }}
 * @throws {Error} when the envelope is unsupported or its checksum does not match
 */
export function decodeSignedDocument(document: import("../contract/types/index.d.ts").SignedBoxDocument): {
    bytes: Buffer;
    payload: unknown;
};
/**
 * Verifies a signed document against the caller's trusted keys and returns its payload.
 *
 * The document is accepted when *any one* signature verifies against a trusted key, which is what
 * allows a document signed by both an outgoing and an incoming key to stay valid across a rotation.
 *
 * @param {import('../contract/types/index.d.ts').SignedBoxDocument} document
 * @param {string | TrustedKey[]} trust a trust file path, or the keys themselves
 * @returns {Promise<unknown>} the payload, once a signature has verified against a trusted key
 * @throws {Error} when no signature verifies
 */
export function verifySignedDocument(document: import("../contract/types/index.d.ts").SignedBoxDocument, trust: string | TrustedKey[]): Promise<unknown>;
/**
 * A published public key, as written by `keygen` and read back when verifying.
 */
export type TrustedKey = {
    algorithm: "ed25519";
    /**
     * stable identifier derived from the key itself
     */
    keyId: string;
    /**
     * the raw 32-byte key, for non-Node verifiers
     */
    publicKeyBase64: string;
    publicKeyPem: string;
};
