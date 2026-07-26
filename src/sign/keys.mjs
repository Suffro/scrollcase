/**
 * Local signing keys and signature verification.
 *
 * A box is only worth as much as the signature over its release document, so the tool ships a
 * working signer out of the box: `keygen` produces an ed25519 pair, and every document it emits can
 * be verified with the matching public key. Production key custody is a separate concern — see the
 * external signer in `index.mjs` — but verification always lives here, because a signature nobody
 * checks is theatre.
 */

import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  createHash,
  sign as edSign,
  verify as edVerify,
} from 'node:crypto';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fail } from '../build/process.mjs';
import { fileExists } from '../build/filesystem.mjs';

/**
 * A published public key, as written by `keygen` and read back when verifying.
 *
 * @typedef {object} TrustedKey
 * @property {'ed25519'} algorithm
 * @property {string} keyId stable identifier derived from the key itself
 * @property {string} publicKeyBase64 the raw 32-byte key, for non-Node verifiers
 * @property {string} publicKeyPem
 */

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

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
export async function generateSigningKey({ privatePath, publicPath, keyId, force = false }) {
  if (await fileExists(privatePath) && !force) {
    fail(`Signing key already exists: ${privatePath}. Pass --force to rotate it explicitly.`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  // An ed25519 SPKI DER is a fixed 12-byte header followed by the 32-byte key, so the raw key is
  // simply the tail. That raw form is what non-Node verifiers expect in base64.
  const rawPublicKey = publicDer.subarray(publicDer.length - 32);
  // Deriving the ID from the key itself makes it stable and collision-resistant without a registry.
  const resolvedKeyId = keyId || `scrollcase-${sha256Hex(rawPublicKey).slice(0, 16)}`;
  await mkdir(dirname(privatePath), { recursive: true });
  await mkdir(dirname(publicPath), { recursive: true });
  // Owner-only, and chmod again afterwards in case a permissive umask widened the mode on create.
  await writeFile(privatePath, privatePem, { mode: 0o600 });
  await chmod(privatePath, 0o600);
  await writeFile(publicPath, `${JSON.stringify({
    algorithm: 'ed25519',
    keyId: resolvedKeyId,
    publicKeyBase64: rawPublicKey.toString('base64'),
    publicKeyPem: publicPem,
  }, null, 2)}\n`);
  return { keyId: resolvedKeyId, privatePath, publicPath };
}

/**
 * Loads the private key and cross-checks it against the published public key file, so a mismatched
 * pair is caught here rather than producing documents nobody can verify.
 *
 * @param {{ privatePath: string, publicPath: string }} options
 * @returns {Promise<{ privateKey: import('node:crypto').KeyObject, metadata: TrustedKey }>}
 * @throws {Error} when the key is missing, or the pair does not match
 */
export async function readSigningKey({ privatePath, publicPath }) {
  if (!await fileExists(privatePath)) fail(`Signing key not found: ${privatePath}. Run keygen first.`);
  const privateKey = createPrivateKey(await readFile(privatePath, 'utf8'));
  const publicKey = createPublicKey(privateKey);
  const rawPublicKey = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const metadata = JSON.parse(await readFile(publicPath, 'utf8'));
  if (metadata.publicKeyBase64 !== rawPublicKey.toString('base64')) {
    fail('Private and public signing keys do not match.');
  }
  return { privateKey, metadata };
}

/** Accepts both trust-file shapes: a bundle of keys, or a single bare key. */
function trustedKeyEntries(value) {
  return Array.isArray(value?.keys) ? value.keys : [value];
}

/**
 * Signs payload bytes with a local key, producing the envelope the format defines.
 *
 * @param {Buffer} payloadBytes the exact bytes to sign, which are also the bytes published
 * @param {{ privateKey: import('node:crypto').KeyObject, metadata: TrustedKey }} key
 * @returns {import('../contract/types/index.d.ts').SignedBoxDocument}
 */
export function signWithLocalKey(payloadBytes, { privateKey, metadata }) {
  return {
    schemaVersion: 1,
    payloadEncoding: 'base64-json-utf8',
    payloadBase64: payloadBytes.toString('base64'),
    payloadSha256: sha256Hex(payloadBytes),
    signatures: [{
      algorithm: 'ed25519',
      keyId: metadata.keyId,
      signatureBase64: edSign(null, payloadBytes, privateKey).toString('base64'),
    }],
  };
}

/**
 * Unwraps an envelope and checks its checksum. Does *not* check the signature.
 *
 * @param {import('../contract/types/index.d.ts').SignedBoxDocument} document
 * @returns {{ bytes: Buffer, payload: unknown }}
 * @throws {Error} when the envelope is unsupported or its checksum does not match
 */
export function decodeSignedDocument(document) {
  if (document?.schemaVersion !== 1 || document?.payloadEncoding !== 'base64-json-utf8') {
    fail('Unsupported signed document.');
  }
  const bytes = Buffer.from(document.payloadBase64, 'base64');
  if (sha256Hex(bytes) !== document.payloadSha256) fail('Signed payload SHA-256 mismatch.');
  return { bytes, payload: JSON.parse(bytes.toString('utf8')) };
}

/**
 * Verifies a signed document against a trusted key file and returns its payload.
 *
 * The document is accepted when *any one* signature verifies against a trusted key, which is what
 * allows a document signed by both an outgoing and an incoming key to stay valid across a rotation.
 *
 * @param {import('../contract/types/index.d.ts').SignedBoxDocument} document
 * @param {string} publicKeyPath a single trusted key, or a `{ keys: [...] }` bundle
 * @returns {Promise<unknown>} the payload, once a signature has verified against a trusted key
 * @throws {Error} when no signature verifies
 */
export async function verifySignedDocument(document, publicKeyPath) {
  const trusted = trustedKeyEntries(JSON.parse(await readFile(publicKeyPath, 'utf8')));
  const { bytes, payload } = decodeSignedDocument(document);
  const valid = document.signatures?.some((signature) => {
    const key = trusted.find((candidate) => candidate.keyId === signature.keyId);
    return key?.publicKeyPem
      && edVerify(null, bytes, createPublicKey(key.publicKeyPem), Buffer.from(signature.signatureBase64, 'base64'));
  });
  if (!valid) fail('Document has no valid signature from a trusted ed25519 key.');
  return payload;
}
