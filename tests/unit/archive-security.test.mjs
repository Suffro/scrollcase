import { createWriteStream } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { afterEach, describe, expect, it } from 'vitest';
import * as tar from 'tar';
import yazl from 'yazl';
import {
  extractScrollArchive,
  extractZipArchive,
  listZipEntries,
} from '../../src/build/archive.mjs';
import { collectFiles, fileExists, safeRelativePath } from '../../src/build/filesystem.mjs';

const created = [];
afterEach(async () => {
  await Promise.all(created.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function scratch() {
  const path = await mkdtemp(join(tmpdir(), 'scrollcase-archive-'));
  created.push(path);
  return path;
}

async function writeZip(path, entries) {
  const zip = new yazl.ZipFile();
  const output = pipeline(zip.outputStream, createWriteStream(path));
  for (const entry of entries) {
    zip.addBuffer(Buffer.from(entry.contents ?? ''), entry.path, entry.options);
  }
  zip.end();
  await output;
}

describe('archive boundaries', () => {
  it('rejects traversal and absolute path spellings before joining them to a destination', () => {
    for (const path of ['', '../escape', 'safe/../../escape', '/absolute', 'C:/absolute', 'a//b']) {
      expect(() => safeRelativePath(path), path).toThrow(/Unsafe relative path/);
    }
  });

  it('rejects a traversal entry before creating the extraction destination', async () => {
    const root = await scratch();
    const archive = join(root, 'unsafe.zip');
    await writeZip(archive, [{ path: 'safe', contents: 'x' }]);
    const bytes = await readFile(archive);
    const safe = Buffer.from('safe');
    const unsafe = Buffer.from('../x');
    let replacements = 0;
    for (let offset = bytes.indexOf(safe); offset !== -1; offset = bytes.indexOf(safe, offset + safe.length)) {
      unsafe.copy(bytes, offset);
      replacements += 1;
    }
    expect(replacements).toBe(2);
    await writeFile(archive, bytes);

    const destination = join(root, 'destination');
    await expect(extractZipArchive(archive, destination))
      .rejects.toThrow(/invalid relative path|Unsafe relative path/);
    expect(await fileExists(destination)).toBe(false);
  });

  it('carries a ZIP symbolic link that resolves to a file beside it', async () => {
    const root = await scratch();
    const archive = join(root, 'link.zip');
    await writeZip(archive, [
      { path: 'lib/libicudata.so.78', contents: 'real bytes' },
      { path: 'lib/libicudata.so', contents: 'libicudata.so.78', options: { mode: 0o120777 } },
    ]);
    const entries = await listZipEntries(archive);
    expect(entries.find((entry) => entry.path === 'lib/libicudata.so'))
      .toMatchObject({ kind: 'link', linkTarget: 'libicudata.so.78' });
  });

  it('refuses a ZIP symbolic link that reaches outside the payload', async () => {
    const root = await scratch();
    const archive = join(root, 'escape.zip');
    // The attack this exists to stop: extract the box, and the link hands the extractor a path on
    // the installing machine to write to.
    await writeZip(archive, [{
      path: 'lib/passwd',
      contents: '../../../../etc/passwd',
      options: { mode: 0o120777 },
    }]);
    await expect(listZipEntries(archive)).rejects.toThrow(/does not resolve to a file inside the payload/);
  });

  it('refuses to write anything through a ZIP symbolic link', async () => {
    const root = await scratch();
    const archive = join(root, 'through.zip');
    await writeZip(archive, [
      { path: 'lib/real/os.py', contents: 'bytes' },
      { path: 'lib/alias', contents: 'real', options: { mode: 0o120777 } },
      { path: 'lib/alias/evil.py', contents: 'payload' },
    ]);
    await expect(listZipEntries(archive)).rejects.toThrow(/does not resolve to a file|written through a link/);
  });

  it('refuses a ZIP symbolic link target long enough to be an attack on the reader', async () => {
    const root = await scratch();
    const archive = join(root, 'long.zip');
    await writeZip(archive, [{
      path: 'lib/long',
      contents: 'a'.repeat(2048),
      options: { mode: 0o120777 },
    }]);
    await expect(listZipEntries(archive)).rejects.toThrow(/link target is too long/);
  });

  it('rejects links in scroll tarballs before copying any extracted asset', async () => {
    const root = await scratch();
    const staging = join(root, 'staging');
    await mkdir(staging);
    await writeFile(join(staging, 'target'), 'bytes');
    await symlink('target', join(staging, 'link'));
    const archive = join(root, 'link.tar.gz');
    await tar.c({ file: archive, cwd: staging, gzip: true }, ['link']);
    const destination = join(root, 'destination');
    await expect(extractScrollArchive(archive, 'tar.gz', destination))
      .rejects.toThrow(/links and special entries/);
    expect(await fileExists(destination)).toBe(false);
  });

  it('orders files by raw path strings rather than host collation', async () => {
    const root = await scratch();
    for (const name of ['a', '_', 'B']) await writeFile(join(root, name), name);
    expect(await collectFiles(root)).toEqual(['B', '_', 'a']);
  });
});
