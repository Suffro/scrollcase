import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureBuildSigningKeys } from '../../src/cli-signing.mjs';

const created = [];

afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function paths() {
  const root = await mkdtemp(join(tmpdir(), 'scrollcase-cli-signing-'));
  created.push(root);
  return {
    privatePath: join(root, 'signing-private.pem'),
    publicPath: join(root, 'signing-public.json'),
  };
}

describe('build signing preflight', () => {
  it('fails clearly when no local signing keys exist', async () => {
    const keyPaths = await paths();
    await expect(ensureBuildSigningKeys(keyPaths)).rejects.toThrow(
      'Signing keys not found. Run scrollcase keygen before building.',
    );
    await expect(readFile(keyPaths.privatePath, 'utf8')).rejects.toThrow();
    await expect(readFile(keyPaths.publicPath, 'utf8')).rejects.toThrow();
  });

  it('does not overwrite an incomplete key pair', async () => {
    const keyPaths = await paths();
    await writeFile(keyPaths.publicPath, '{"existing":true}\n');
    await expect(ensureBuildSigningKeys({
      ...keyPaths,
    })).rejects.toThrow(/pair is incomplete.*Refusing to replace/);
    expect(await readFile(keyPaths.publicPath, 'utf8')).toBe('{"existing":true}\n');
  });

  it('requires the external signer trust key without offering local keygen', async () => {
    const keyPaths = await paths();
    await expect(ensureBuildSigningKeys({
      ...keyPaths,
      signerCommand: 'kms-sign',
    })).rejects.toThrow(/Trusted public key not found/);
  });
});
