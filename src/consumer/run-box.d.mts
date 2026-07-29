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
export function runBox(releaseDocumentPath: string, options: RunBoxOptions): Promise<import("./run-extracted.mjs").BoxRunResult>;
export type RunBoxOptions = import("./run-extracted.mjs").RunExtractedBoxOptions & {
    publicPath: string;
    archive?: string | null;
    temporaryDirectory?: string;
};
