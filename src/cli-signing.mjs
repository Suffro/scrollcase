/**
 * Signing readiness at the CLI edge.
 *
 * A missing local identity is recoverable before a build starts; a half-present identity is not.
 * The latter must never be "repaired" by overwriting one key, because that could silently rotate
 * the identity used by already-published documents.
 */

import { fileExists } from './build/filesystem.mjs';
import { fail } from './build/process.mjs';
import { generateSigningKey } from './sign/index.mjs';

/** Ensures the selected signing path is ready before any expensive build work begins. */
export async function ensureBuildSigningKeys({
  privatePath,
  publicPath,
  signerCommand = null,
  terminal = Boolean(process.stdin.isTTY && process.stdout.isTTY),
  confirm = async () => false,
  generate = generateSigningKey,
  log = console.log,
}) {
  const publicExists = await fileExists(publicPath);
  if (signerCommand) {
    if (!publicExists) {
      fail(`Trusted public key not found: ${publicPath}. Supply the key used to verify the external signer.`);
    }
    return;
  }

  const privateExists = await fileExists(privatePath);
  if (privateExists && publicExists) return;
  if (privateExists || publicExists) {
    const missing = privateExists ? publicPath : privatePath;
    fail(`Signing key pair is incomplete; missing ${missing}. Refusing to replace the existing key.`);
  }
  if (!terminal) {
    fail(`Signing keys not found. Run scrollcase keygen before building without a terminal.`);
  }
  if (!await confirm('No signing keys were found. Generate them now?')) {
    fail('Build requires signing keys. Run scrollcase keygen, then build again.');
  }

  const created = await generate({ privatePath, publicPath });
  log(`Created signing key ${created.keyId}`);
  log(`  private: ${created.privatePath}`);
  log(`  public:  ${created.publicPath}`);
}
