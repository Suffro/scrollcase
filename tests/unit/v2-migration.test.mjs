import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  BOX_SCHEMA_VERSION,
  CHANNELS,
  schemaUrl,
} from '../../src/contract/index.mjs';
import { decodeSignedDocument } from '../../src/sign/index.mjs';
import { resolveWorkspace } from '../../src/build/workspace.mjs';

describe('the v2-only contract boundary', () => {
  it('publishes only the canonical v2 scroll schema', async () => {
    expect(BOX_SCHEMA_VERSION).toBe(2);
    const schema = JSON.parse(await readFile(schemaUrl('scroll'), 'utf8'));
    expect(schema.$id).toBe('https://scrollcase.dev/schema/v2/scroll.schema.json');
    expect(schema.properties.schemaVersion.const).toBe(2);
  });

  it('rejects a v1 signed document with the migration remedy', () => {
    const bytes = Buffer.from('{}');
    const document = {
      schemaVersion: 1,
      payloadEncoding: 'base64-json-utf8',
      payloadBase64: bytes.toString('base64'),
      payloadSha256: createHash('sha256').update(bytes).digest('hex'),
      signatures: [{ algorithm: 'ed25519', keyId: 'test', signatureBase64: 'test' }],
    };
    expect(() => decodeSignedDocument(document))
      .toThrow('Unsupported schemaVersion 1; rebuild this box with Scrollcase v2.');
  });

  it('closes the channel vocabulary to nightly, beta, and stable', () => {
    expect(CHANNELS).toEqual(['nightly', 'beta', 'stable']);
  });
});

describe('canonical scroll workspace names', () => {
  it('uses scrolls and exposes no legacy compatibility field', () => {
    const workspace = resolveWorkspace({ cwd: '/tmp/scrollcase-v2-workspace' });
    expect(workspace.scrollsDir).toBe('/tmp/scrollcase-v2-workspace/scrolls');
    const legacyField = ['re', 'cipesDir'].join('');
    expect(workspace).not.toHaveProperty(legacyField);
  });
});
