/**
 * Signing, with key custody left to the operator.
 *
 * Two paths, one envelope. The built-in path signs with a local ed25519 key, which is enough for
 * development and for anyone happy to hold their own key. The external path hands the payload to a
 * command the operator configures — a KMS, an HSM, a signing service — so the private key never
 * touches the build machine and Scrollcase never learns anything about the custody model.
 *
 * What the external path does *not* do is take the result on faith. The returned document must echo
 * back exactly the payload that was sent, and its signature is verified locally before the build
 * continues. A signer that substitutes a payload, or returns a signature that does not verify, fails
 * the build rather than producing a box nobody can install.
 */

import { spawnSync } from 'node:child_process';
import { fail } from '../build/process.mjs';
import { readSigningKey, signWithLocalKey, verifySignedDocument } from './keys.mjs';

export {
  decodeSignedDocument,
  generateSigningKey,
  readSigningKey,
  verifySignedDocument,
} from './keys.mjs';

/**
 * Runs an external signer command.
 *
 * The contract is deliberately the simplest thing that composes with anything: the command receives
 * the payload bytes on stdin and writes the complete signed document as JSON on stdout. Any language,
 * any credential mechanism, no plugin API to keep compatible.
 */
function signWithCommand(payloadBytes, command) {
  const [executable, ...args] = Array.isArray(command) ? command : command.split(/\s+/).filter(Boolean);
  if (!executable) fail('External signer command is empty.');
  const result = spawnSync(executable, args, { input: payloadBytes, maxBuffer: 16 * 1024 * 1024 });
  if (result.error) fail(`External signer failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const stderr = (result.stderr?.toString() || '').trim();
    fail(`External signer exited with ${result.status}${stderr ? `: ${stderr}` : ''}`);
  }
  try {
    return JSON.parse(result.stdout.toString('utf8'));
  } catch (error) {
    fail(`External signer did not return a JSON document: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Wraps a manifest in the signed envelope, through whichever signer is configured.
 *
 * The payload is serialised once and both hashed and signed as-is, so what gets signed is
 * byte-for-byte what gets published.
 */
export async function signDocument(payload, { signerCommand = null, privatePath, publicPath }) {
  const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  if (signerCommand) {
    const document = signWithCommand(payloadBytes, signerCommand);
    if (document?.payloadBase64 !== payloadBytes.toString('base64')) {
      fail('External signer returned a different payload than the one it was given.');
    }
    // Verified against the trust anchor the operator points at, not against the signer's word.
    await verifySignedDocument(document, publicPath);
    return document;
  }
  return signWithLocalKey(payloadBytes, await readSigningKey({ privatePath, publicPath }));
}
