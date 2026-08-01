/**
 * Shell-free execution of a box that this process has already prepared.
 *
 * The verified manifest supplies the interpreter and script/module identity; the caller supplies
 * only additional argument strings, streams, and environment values. Signals are forwarded while
 * the child is alive and listeners are removed at the same point the result settles.
 */

import { spawn as spawnProcess } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { collectFiles, safeRelativePath, sha256File } from '../build/filesystem.mjs';
import { assertExecutionFiles } from '../build/execution.mjs';
import { fail } from '../build/process.mjs';
import { assertNativeHost, boxTargetAdapter, boxTargetId } from '../contract/targets.mjs';
import { preparedBoxState } from './verify-and-extract.mjs';

/**
 * @typedef {'pipe' | 'overlapped' | 'ignore' | 'inherit' | number |
 *   import('node:stream').Stream | null | undefined} BoxStdio
 */

/**
 * @typedef {object} RunExtractedBoxOptions
 * @property {readonly string[]} [args]
 * @property {NodeJS.ProcessEnv} [env] values merged over the current process environment
 * @property {BoxStdio} [stdin]
 * @property {BoxStdio} [stdout]
 * @property {BoxStdio} [stderr]
 * @property {typeof spawnProcess} [spawn] injectable process seam
 * @property {Pick<NodeJS.Process, 'on' | 'removeListener'>} [signalSource] injectable signal seam
 */

/**
 * @typedef {object} BoxRunResult
 * @property {number | null} exitCode
 * @property {NodeJS.Signals | null} signal
 */

const FORWARDED_SIGNALS = /** @type {const} */ (['SIGINT', 'SIGTERM', 'SIGHUP']);

function stringArguments(values) {
  if (!Array.isArray(values) || !values.every((value) => typeof value === 'string')) {
    fail('Box execution arguments must be an array of strings.');
  }
  return values;
}

async function verifyRequiredAssets(root, assets) {
  for (const asset of assets) {
    const path = join(root, ...safeRelativePath(asset.relativePath).split('/'));
    let metadata;
    try {
      metadata = await lstat(path);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        fail(`Required on-demand asset is missing: ${asset.relativePath}.`);
      }
      throw error;
    }
    if (!metadata.isFile()) fail(`Required on-demand asset is not a regular file: ${asset.relativePath}.`);
    if (metadata.size !== asset.sizeBytes) {
      fail(`Required on-demand asset size mismatch: ${asset.relativePath}.`);
    }
    if (await sha256File(path) !== asset.sha256) {
      fail(`Required on-demand asset SHA-256 mismatch: ${asset.relativePath}.`);
    }
  }
}

function waitForChild(child, signalSource) {
  return new Promise((resolve, reject) => {
    const handlers = new Map();
    const cleanup = () => {
      for (const [signal, handler] of handlers) signalSource.removeListener(signal, handler);
      handlers.clear();
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const onClose = (exitCode, signal) => {
      cleanup();
      resolve({ exitCode, signal });
    };
    child.once('error', onError);
    child.once('close', onClose);
    for (const signal of FORWARDED_SIGNALS) {
      const handler = () => child.kill(signal);
      handlers.set(signal, handler);
      signalSource.on(signal, handler);
    }
  });
}

/**
 * Executes a prepared box with its own interpreter and returns its terminal result.
 *
 * @param {import('./verify-and-extract.mjs').PreparedBox} prepared
 * @param {RunExtractedBoxOptions} [options]
 * @returns {Promise<BoxRunResult>}
 */
export async function runExtractedBox(prepared, options = {}) {
  const { release, rootIdentity } = preparedBoxState(prepared);
  if (!release.execution) fail('Box does not declare an execution entry point.');
  const callerArgs = stringArguments(options.args ?? []);
  const adapter = boxTargetAdapter(release.target);
  try {
    assertNativeHost(adapter);
  } catch {
    fail(
      `Box target ${boxTargetId(release.target)} cannot run on ${process.platform}/${process.arch}; `
      + `requires ${adapter.host.platform}/${adapter.host.arch}.`,
    );
  }

  let rootMetadata;
  try {
    rootMetadata = await lstat(prepared.root);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail('Prepared box root no longer matches the prepared box.');
    }
    throw error;
  }
  if (!rootMetadata.isDirectory()
    || rootMetadata.dev !== rootIdentity.device
    || rootMetadata.ino !== rootIdentity.inode) {
    fail('Prepared box root no longer matches the prepared box.');
  }
  const files = new Set(await collectFiles(prepared.root));
  if (!files.has(release.pythonEntryPoint)) {
    fail(`Prepared box is missing ${release.pythonEntryPoint}.`);
  }
  assertExecutionFiles({
    execution: release.execution,
    adapter,
    pythonVersion: release.provenance.pythonVersion,
    files,
  });
  await verifyRequiredAssets(prepared.root, prepared.requiredAssets);

  const python = join(prepared.root, ...safeRelativePath(release.pythonEntryPoint).split('/'));
  const executionArgs = release.execution.kind === 'python-script'
    ? [join(prepared.root, ...safeRelativePath(release.execution.script).split('/'))]
    : ['-m', release.execution.module];
  executionArgs.push(...release.execution.defaultArgs, ...callerArgs);

  const spawn = options.spawn ?? spawnProcess;
  const child = spawn(python, executionArgs, {
    cwd: prepared.root,
    env: { ...process.env, ...options.env },
    stdio: [
      options.stdin ?? 'inherit',
      options.stdout ?? 'inherit',
      options.stderr ?? 'inherit',
    ],
    shell: false,
  });
  return waitForChild(child, options.signalSource ?? process);
}
