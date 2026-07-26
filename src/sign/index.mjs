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

import { fail, runResult as defaultRunResult } from '../build/process.mjs';
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
function commandArguments(command) {
  if (Array.isArray(command)) {
    if (!command.every((part) => typeof part === 'string')) {
      fail('External signer command array must contain only strings.');
    }
    return command;
  }
  const source = String(command);
  const args = [];
  let current = '';
  let quote = null;
  let tokenStarted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote === "'") {
      if (character === quote) quote = null;
      else current += character;
    } else if (quote === '"') {
      if (character === quote) {
        quote = null;
      } else if (character === '\\' && ['\\', '"'].includes(source[index + 1])) {
        current += source[index + 1];
        index += 1;
      } else {
        current += character;
      }
    } else if (character === '"' || character === "'") {
      quote = character;
      tokenStarted = true;
    } else if (/\s/.test(character)) {
      if (tokenStarted) {
        args.push(current);
        current = '';
        tokenStarted = false;
      }
    } else if (character === '\\' && source[index + 1]
      && (/[\s'"\\]/).test(source[index + 1])) {
      current += source[index + 1];
      tokenStarted = true;
      index += 1;
    } else {
      current += character;
      tokenStarted = true;
    }
  }
  if (quote) fail('External signer command has an unmatched quote.');
  if (tokenStarted) args.push(current);
  return args;
}

function signWithCommand(payloadBytes, command, runResult) {
  const [executable, ...args] = commandArguments(command);
  if (!executable) fail('External signer command is empty.');
  const result = runResult(executable, args, {
    input: payloadBytes,
    capture: true,
    maxBuffer: 16 * 1024 * 1024,
  });
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
 *
 * @param {unknown} payload the manifest to wrap; serialised once and signed exactly as serialised
 * @param {{ signerCommand?: string | string[] | null, privatePath?: string, publicPath: string,
 *   runResult?: typeof defaultRunResult }} signing
 * @returns {Promise<import('../contract/types/index.d.ts').SignedBoxDocument>}
 * @throws {Error} when an external signer fails, alters the payload, or returns an unverifiable
 *   signature
 */
export async function signDocument(payload, {
  signerCommand = null,
  privatePath,
  publicPath,
  runResult = defaultRunResult,
}) {
  const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  if (signerCommand) {
    const document = signWithCommand(payloadBytes, signerCommand, runResult);
    if (document?.payloadBase64 !== payloadBytes.toString('base64')) {
      fail('External signer returned a different payload than the one it was given.');
    }
    // Verified against the trust anchor the operator points at, not against the signer's word.
    await verifySignedDocument(document, publicPath);
    return document;
  }
  return signWithLocalKey(payloadBytes, await readSigningKey({ privatePath, publicPath }));
}
