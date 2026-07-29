/**
 * Deterministic archive creation and defensive extraction.
 *
 * Writing: every box ships as a ZIP whose bytes depend only on its contents — fixed timestamps,
 * stable file ordering, and modes derived from the target adapter — so rebuilding the same commit
 * reproduces the archive bit for bit.
 *
 * Reading: nothing from inside an archive is trusted before it is validated. Entry names are
 * checked against path traversal, links and special entries are rejected outright, and both ZIP
 * and TAR are handled by pinned Node implementations rather than whatever tools the host happens
 * to have — an archive behaves the same on every machine that opens it.
 */
import { constants, createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import * as tar from 'tar';
import yauzl from 'yauzl';
import yazl from 'yazl';
import {
  FIXED_ARCHIVE_TIME,
  collectFiles,
  fileExists,
  safeRelativePath,
  validateExtractedTree,
} from './filesystem.mjs';
import { fail } from './process.mjs';

const ZIP_FILE_TYPE_MASK = 0o170000;
const ZIP_REGULAR_FILE = 0o100000;
const ZIP_DIRECTORY = 0o040000;
const ZIP_SYMBOLIC_LINK = 0o120000;

/** Returns the stable archive mode for a box payload file. */
function archiveFileMode(adapter, relativePath) {
  if (adapter.host.platform === 'win32') return 0o100644;
  const scriptsDirectory = adapter.python.scriptsDirectory;
  return relativePath === adapter.python.entryPoint || relativePath.startsWith(`${scriptsDirectory}/`)
    ? 0o100755
    : 0o100644;
}

/**
 * Streams a deterministic, Zip64-capable box archive using the pinned Node backend.
 *
 * @param {string} payloadDir
 * @param {string} archivePath
 * @param {import('../contract/targets.mjs').BoxTargetAdapter} adapter
 * @returns {Promise<void>}
 */
export async function createDeterministicZip(payloadDir, archivePath, adapter) {
  await rm(archivePath, { force: true });
  await mkdir(dirname(archivePath), { recursive: true });
  const zip = new yazl.ZipFile();
  const output = pipeline(zip.outputStream, createWriteStream(archivePath, { flags: 'wx' }));
  for (const file of await collectFiles(payloadDir)) {
    zip.addFile(join(payloadDir, ...file.split('/')), file, {
      compress: true,
      compressionLevel: 6,
      mtime: FIXED_ARCHIVE_TIME,
      mode: archiveFileMode(adapter, file),
      forceDosTimestamp: true,
    });
  }
  zip.end({ forceZip64Format: false });
  await output;
}

/** Classifies a ZIP entry and rejects links, special entries, and encrypted files. */
function classifyZipEntry(entry) {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) fail(`Encrypted ZIP entries are not allowed: ${entry.fileName}`);
  const path = safeRelativePath(entry.fileName.endsWith('/') ? entry.fileName.slice(0, -1) : entry.fileName);
  const unixType = (entry.externalFileAttributes >>> 16) & ZIP_FILE_TYPE_MASK;
  if (unixType === ZIP_SYMBOLIC_LINK) fail(`Archive links and special entries are not allowed: ${path}`);
  const directory = entry.fileName.endsWith('/') || unixType === ZIP_DIRECTORY;
  if (!directory && unixType !== 0 && unixType !== ZIP_REGULAR_FILE) {
    fail(`Archive special entries are not allowed: ${path}`);
  }
  return {
    path,
    kind: directory ? 'directory' : 'file',
    size: entry.uncompressedSize,
    mode: (entry.externalFileAttributes >>> 16) & 0o777,
  };
}

/** Rejects duplicate paths and file/directory collisions before extraction begins. */
function assertNoZipEntryCollisions(entries) {
  const seen = new Map();
  const parentsWithChildren = new Set();
  for (const entry of entries) {
    if (seen.has(entry.path)) fail(`Archive entry collides with another entry: ${entry.path}`);
    const parts = entry.path.split('/');
    for (let index = 1; index < parts.length; index += 1) {
      const parent = parts.slice(0, index).join('/');
      if (seen.get(parent) === 'file') {
        fail(`Archive entry collides with another entry: ${entry.path}`);
      }
      parentsWithChildren.add(parent);
    }
    if (entry.kind === 'file' && parentsWithChildren.has(entry.path)) {
      fail(`Archive entry collides with another entry: ${entry.path}`);
    }
    seen.set(entry.path, entry.kind);
  }
}

/** Opens a ZIP with strict names, path validation, and uncompressed-size checks enabled. */
async function openZip(archivePath) {
  return yauzl.openPromise(archivePath, {
    autoClose: false,
    decodeStrings: true,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
}

/**
 * Lists and validates all entries before any ZIP data is trusted or extracted.
 *
 * @param {string} archivePath
 * @returns {Promise<Array<{
 *   path: string,
 *   kind: 'directory' | 'file',
 *   size: number,
 *   mode: number,
 * }>>}
 */
export async function listZipEntries(archivePath) {
  const zip = await openZip(archivePath);
  const entries = [];
  try {
    for await (const entry of zip.eachEntry()) entries.push(classifyZipEntry(entry));
  } finally {
    await zip.close();
  }
  assertNoZipEntryCollisions(entries);
  return entries;
}

/**
 * Reads one small ZIP metadata entry without extracting the surrounding archive.
 *
 * @param {string} archivePath
 * @param {string} wantedPath
 * @param {number} [maximumBytes]
 * @returns {Promise<string>}
 */
export async function readZipEntry(archivePath, wantedPath, maximumBytes = 1024 * 1024) {
  const safePath = safeRelativePath(wantedPath);
  const zip = await openZip(archivePath);
  try {
    for await (const entry of zip.eachEntry()) {
      const classified = classifyZipEntry(entry);
      if (classified.path !== safePath || classified.kind !== 'file') continue;
      if (classified.size > maximumBytes) fail(`ZIP entry is too large to read as metadata: ${safePath}`);
      const stream = await zip.openReadStreamPromise(entry);
      const chunks = [];
      let length = 0;
      for await (const chunk of stream) {
        length += chunk.length;
        if (length > maximumBytes) fail(`ZIP entry is too large to read as metadata: ${safePath}`);
        chunks.push(chunk);
      }
      return Buffer.concat(chunks).toString('utf8');
    }
  } finally {
    await zip.close();
  }
  fail(`ZIP archive does not contain ${safePath}`);
}

/**
 * Extracts a prevalidated ZIP without shelling out to whatever unzip the host provides.
 *
 * @param {string} archivePath
 * @param {string} destination
 * @returns {Promise<void>}
 */
export async function extractZipArchive(archivePath, destination) {
  await listZipEntries(archivePath);
  await mkdir(destination, { recursive: true });
  const zip = await openZip(archivePath);
  try {
    for await (const entry of zip.eachEntry()) {
      const classified = classifyZipEntry(entry);
      const outputPath = join(destination, ...classified.path.split('/'));
      if (classified.kind === 'directory') {
        await mkdir(outputPath, { recursive: true });
        continue;
      }
      await mkdir(dirname(outputPath), { recursive: true });
      const stream = await zip.openReadStreamPromise(entry);
      await pipeline(stream, createWriteStream(outputPath, {
        flags: 'wx',
        mode: classified.mode || 0o644,
      }));
    }
  } finally {
    await zip.close();
  }
  await validateExtractedTree(destination);
}

/** Lists TAR assets and rejects paths, links, and special entries before extraction. */
async function validateTarArchive(archivePath) {
  let violation;
  await tar.t({
    file: archivePath,
    gzip: true,
    strict: true,
    onentry(entry) {
      if (violation) return;
      try {
        safeRelativePath(entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path);
        if (!['File', 'OldFile', 'Directory'].includes(entry.type)) {
          violation = `Archive links and special entries are not allowed: ${entry.path}`;
        }
      } catch (error) {
        violation = error instanceof Error ? error.message : String(error);
      }
    },
  });
  if (violation) fail(violation);
}

/**
 * Extracts scroll assets using only pinned Node archive implementations.
 *
 * @param {string} archivePath
 * @param {'zip' | 'tar.gz'} format
 * @param {string} destination
 * @param {number} [stripComponents]
 * @returns {Promise<void>}
 */
export async function extractScrollArchive(archivePath, format, destination, stripComponents = 0) {
  const tempRoot = await mkdtemp(join(tmpdir(), 'scrollcase-extract-'));
  try {
    if (format === 'zip') {
      await extractZipArchive(archivePath, tempRoot);
    } else if (format === 'tar.gz') {
      await validateTarArchive(archivePath);
      await tar.x({
        file: archivePath,
        cwd: tempRoot,
        gzip: true,
        preservePaths: false,
        strict: true,
      });
      await validateExtractedTree(tempRoot);
    } else {
      fail(`Unsupported archive format: ${format}`);
    }

    let source = tempRoot;
    for (let index = 0; index < stripComponents; index += 1) {
      const entries = await collectFiles(source);
      const topLevels = [...new Set(entries
        .map((entry) => entry.split('/')[0])
        .filter((entry) => entry !== '__MACOSX'))];
      if (topLevels.length !== 1) fail(`Cannot strip archive component ${index + 1}: expected one root directory`);
      const nextSource = join(source, topLevels[0]);
      if (!(await stat(nextSource)).isDirectory()) {
        fail(`Cannot strip archive component ${index + 1}: expected one root directory`);
      }
      source = nextSource;
    }
    const files = await collectFiles(source);
    // Archives may add a subtree beside verified assets, but must never replace those assets.
    for (const file of files) {
      if (await fileExists(join(destination, ...file.split('/')))) {
        fail(`Scroll archive entry already exists in destination: ${file}`);
      }
    }
    await mkdir(destination, { recursive: true });
    for (const file of files) {
      const outputPath = join(destination, ...file.split('/'));
      await mkdir(dirname(outputPath), { recursive: true });
      await copyFile(join(source, ...file.split('/')), outputPath, constants.COPYFILE_EXCL);
    }
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}
