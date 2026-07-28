import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  generateSigningKey,
  signDocument,
  verifySignedDocument,
} from '../../src/sign/index.mjs';

const created = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'scrollcase signer-'));
  created.push(root);
  const privatePath = join(root, 'private.pem');
  const publicPath = join(root, 'public.json');
  await generateSigningKey({ privatePath, publicPath });
  const helper = join(root, 'external signer.mjs');
  await writeFile(helper, `
import { createHash, createPrivateKey, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';

const [privatePath, publicPath, mode, marker, empty] = process.argv.slice(2);
if (mode === 'valid' && (marker !== 'C:\\\\signers\\\\value with spaces' || empty !== '')) {
  process.stderr.write('quoted arguments were not preserved');
  process.exit(2);
}
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
let payload = Buffer.concat(chunks);
if (mode === 'substitute') payload = Buffer.from('{"substituted":true}\\n');
const metadata = JSON.parse(readFileSync(publicPath, 'utf8'));
const signature = sign(null, payload, createPrivateKey(readFileSync(privatePath)));
const document = {
  schemaVersion: 2,
  payloadEncoding: 'base64-json-utf8',
  payloadBase64: payload.toString('base64'),
  payloadSha256: createHash('sha256').update(payload).digest('hex'),
  signatures: [{
    algorithm: 'ed25519',
    keyId: metadata.keyId,
    signatureBase64: (mode === 'invalid' ? Buffer.alloc(signature.length) : signature).toString('base64'),
  }],
};
process.stdout.write(JSON.stringify(document));
`);
  return { helper, privatePath, publicPath };
}

const quote = (value) => `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;

describe('external signing', () => {
  it('accepts a quoted command with spaces and verifies its result locally', async () => {
    const keys = await fixture();
    const command = [
      process.execPath,
      keys.helper,
      keys.privatePath,
      keys.publicPath,
      'valid',
      String.raw`C:\signers\value with spaces`,
      '',
    ].map(quote).join(' ');
    const document = await signDocument({ kind: 'example.release' }, {
      ...keys,
      signerCommand: command,
    });
    await expect(verifySignedDocument(document, keys.publicPath))
      .resolves.toEqual({ kind: 'example.release' });
  });

  it('rejects a signer that substitutes and validly signs a different payload', async () => {
    const keys = await fixture();
    await expect(signDocument({ expected: true }, {
      ...keys,
      signerCommand: [
        process.execPath,
        keys.helper,
        keys.privatePath,
        keys.publicPath,
        'substitute',
      ],
    })).rejects.toThrow(/different payload/);
  });

  it('rejects an invalid signature even when the payload is echoed exactly', async () => {
    const keys = await fixture();
    await expect(signDocument({ expected: true }, {
      ...keys,
      signerCommand: [
        process.execPath,
        keys.helper,
        keys.privatePath,
        keys.publicPath,
        'invalid',
      ],
    })).rejects.toThrow(/no valid signature/);
  });
});
