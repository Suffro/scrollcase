/**
 * @typedef {import('./run-extracted.mjs').RunExtractedBoxOptions & {
 *   publicPath?: string | null,
 *   trustedKeys?: object[] | null,
 *   archive?: string | null,
 *   temporaryDirectory?: string,
 *   onPrepared?: (prepared: Readonly<import('./verify-and-extract.mjs').PreparedBox>) =>
 *     void | Promise<void>,
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
    publicPath?: string | null;
    trustedKeys?: object[] | null;
    archive?: string | null;
    temporaryDirectory?: string;
    onPrepared?: (prepared: Readonly<import("./verify-and-extract.mjs").PreparedBox>) => void | Promise<void>;
};
