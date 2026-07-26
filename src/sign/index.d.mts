/**
 * Wraps a manifest in the signed envelope, through whichever signer is configured.
 *
 * The payload is serialised once and both hashed and signed as-is, so what gets signed is
 * byte-for-byte what gets published.
 *
 * @param {unknown} payload the manifest to wrap; serialised once and signed exactly as serialised
 * @param {{ signerCommand?: string | string[] | null, privatePath?: string, publicPath: string,
 *   runResult?: typeof defaultRunResult }} signing
 * @returns {Promise<import('../contract/types/index.d.ts').SignedBoxDocument>}
 * @throws {Error} when an external signer fails, alters the payload, or returns an unverifiable
 *   signature
 */
export function signDocument(payload: unknown, { signerCommand, privatePath, publicPath, runResult, }: {
    signerCommand?: string | string[] | null;
    privatePath?: string;
    publicPath: string;
    runResult?: typeof defaultRunResult;
}): Promise<import("../contract/types/index.d.ts").SignedBoxDocument>;
import { runResult as defaultRunResult } from '../build/process.mjs';
export { decodeSignedDocument, generateSigningKey, readSigningKey, verifySignedDocument } from "./keys.mjs";
