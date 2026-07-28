import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
  it('generates an absent local key pair after terminal consent', async () => {
    const keyPaths = await paths();
    const confirm = vi.fn().mockResolvedValue(true);
    await ensureBuildSigningKeys({ ...keyPaths, terminal: true, confirm, log: () => {} });
    expect(confirm).toHaveBeenCalledWith('No signing keys were found. Generate them now?');
    expect(await readFile(keyPaths.privatePath, 'utf8')).toContain('PRIVATE KEY');
    expect(JSON.parse(await readFile(keyPaths.publicPath, 'utf8')).algorithm).toBe('ed25519');
  });

  it('fails clearly without a terminal before generating anything', async () => {
    const keyPaths = await paths();
    const generate = vi.fn();
    await expect(ensureBuildSigningKeys({
      ...keyPaths,
      terminal: false,
      generate,
    })).rejects.toThrow(/Run scrollcase keygen/);
    expect(generate).not.toHaveBeenCalled();
  });

  it('does not overwrite an incomplete key pair', async () => {
    const keyPaths = await paths();
    await writeFile(keyPaths.publicPath, '{"existing":true}\n');
    const generate = vi.fn();
    await expect(ensureBuildSigningKeys({
      ...keyPaths,
      terminal: true,
      confirm: async () => true,
      generate,
    })).rejects.toThrow(/pair is incomplete.*Refusing to replace/);
    expect(generate).not.toHaveBeenCalled();
    expect(await readFile(keyPaths.publicPath, 'utf8')).toBe('{"existing":true}\n');
  });

  it('requires the external signer trust key without offering local keygen', async () => {
    const keyPaths = await paths();
    const confirm = vi.fn();
    await expect(ensureBuildSigningKeys({
      ...keyPaths,
      signerCommand: 'kms-sign',
      terminal: true,
      confirm,
    })).rejects.toThrow(/Trusted public key not found/);
    expect(confirm).not.toHaveBeenCalled();
  });
});
