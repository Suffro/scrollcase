import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadVerified } from '../../src/build/assets.mjs';
import { fileExists } from '../../src/build/filesystem.mjs';

const created = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function scratch() {
  const path = await mkdtemp(join(tmpdir(), 'scrollcase-assets-'));
  created.push(path);
  return path;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function response(bytes, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
  };
}

function fixture(bytes) {
  return {
    asset: {
      url: 'https://assets.example.org/weights.bin',
      relativePath: 'model-cache/weights.bin',
      sizeBytes: bytes.length,
      sha256: sha256(bytes),
    },
    bytes,
  };
}

describe('verified asset downloads', () => {
  it('writes only bytes whose declared size and hash match', async () => {
    const root = await scratch();
    const { asset, bytes } = fixture(Buffer.from('verified bytes'));
    const destination = join(root, 'model-cache', 'weights.bin');
    await downloadVerified(asset, destination, {
      fetchImpl: async () => response(bytes),
      log: () => {},
    });
    expect(await readFile(destination)).toEqual(bytes);
    expect(await fileExists(`${destination}.part`)).toBe(false);
  });

  it('resumes a partial response and sends the exact Range header', async () => {
    const root = await scratch();
    const { asset, bytes } = fixture(Buffer.from('abcdef'));
    const destination = join(root, 'model-cache', 'weights.bin');
    await mkdir(join(root, 'model-cache'), { recursive: true });
    await writeFile(`${destination}.part`, bytes.subarray(0, 2));
    const requests = [];
    await downloadVerified(asset, destination, {
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return response(bytes.subarray(2), 206);
      },
      log: () => {},
    });
    expect(requests).toEqual([{
      url: asset.url,
      options: { headers: { Range: 'bytes=2-' }, redirect: 'follow' },
    }]);
    expect(await readFile(destination)).toEqual(bytes);
  });

  it('never promotes a same-size download with the wrong hash and restarts cleanly', async () => {
    const root = await scratch();
    const { asset, bytes } = fixture(Buffer.from('expected'));
    const destination = join(root, 'model-cache', 'weights.bin');
    await expect(downloadVerified(asset, destination, {
      fetchImpl: async () => response(Buffer.from('tampered')),
      log: () => {},
    })).rejects.toThrow(/SHA-256 mismatch/);
    expect(await fileExists(destination)).toBe(false);
    expect(await fileExists(`${destination}.part`)).toBe(false);

    const requests = [];
    await downloadVerified(asset, destination, {
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        return response(bytes);
      },
      log: () => {},
    });
    expect(requests[0].options.headers).toBeUndefined();
    expect(await readFile(destination)).toEqual(bytes);
  });

  it('retries a dropped connection through injected time and logging seams', async () => {
    const root = await scratch();
    const { asset, bytes } = fixture(Buffer.from('retry'));
    const destination = join(root, 'model-cache', 'weights.bin');
    const delays = [];
    const logs = [];
    let attempts = 0;
    await downloadVerified(asset, destination, {
      fetchImpl: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('connection reset');
        return response(bytes);
      },
      wait: async (milliseconds) => delays.push(milliseconds),
      log: (message) => logs.push(message),
    });
    expect(attempts).toBe(2);
    expect(delays).toEqual([2000]);
    expect(logs[0]).toMatch(/attempt 1 failed/);
  });
});
