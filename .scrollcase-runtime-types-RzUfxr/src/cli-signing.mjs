/**
 * Signing readiness at the CLI edge.
 *
 * Signing readiness is a read-only preflight. `build` never creates or repairs identity material:
 * doing so would mutate the project before provenance checks and could silently rotate the
 * identity used by already-published documents.
 */

import { fileExists } from './build/filesystem.mjs';
import { fail } from './build/process.mjs';

/** Ensures the selected signing path is ready before any expensive build work begins. */
export async function ensureBuildSigningKeys({
  privatePath,
  publicPath,
  signerCommand = null,
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
  fail('Signing keys not found. Run scrollcase keygen before building.');
}
