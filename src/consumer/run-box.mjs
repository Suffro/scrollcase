/**
 * One-shot local execution: prepare into a private temporary root, run, then remove every byte.
 *
 * The `finally` owns cleanup for every terminal path — normal exit, non-zero exit, spawn failure,
 * or a forwarded signal. The child result is returned unchanged so callers retain application exit
 * semantics instead of having them translated into a Scrollcase success/failure convention.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runExtractedBox } from './run-extracted.mjs';
import { verifyAndExtractBox } from './verify-and-extract.mjs';

/**
 * @typedef {import('./run-extracted.mjs').RunExtractedBoxOptions & {
 *   publicPath: string,
 *   archive?: string | null,
 *   temporaryDirectory?: string,
 * }} RunBoxOptions
 */

/**
 * Verifies, temporarily extracts, and executes one caller-supplied local box.
 *
 * @param {string} releaseDocumentPath
 * @param {RunBoxOptions} options
 * @returns {Promise<import('./run-extracted.mjs').BoxRunResult>}
 */
export async function runBox(releaseDocumentPath, options) {
  const temporaryParent = resolve(options.temporaryDirectory ?? tmpdir());
  const temporaryRoot = await mkdtemp(join(temporaryParent, 'scrollcase-run-'));
  try {
    const prepared = await verifyAndExtractBox(releaseDocumentPath, {
      publicPath: options.publicPath,
      archive: options.archive,
      destination: join(temporaryRoot, 'box'),
    });
    return await runExtractedBox(prepared, options);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}
