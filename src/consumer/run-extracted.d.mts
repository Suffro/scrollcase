/**
 * Executes a prepared box with its own interpreter and returns its terminal result.
 *
 * @param {import('./verify-and-extract.mjs').PreparedBox} prepared
 * @param {RunExtractedBoxOptions} [options]
 * @returns {Promise<BoxRunResult>}
 */
export function runExtractedBox(prepared: import("./verify-and-extract.mjs").PreparedBox, options?: RunExtractedBoxOptions): Promise<BoxRunResult>;
export type BoxStdio = "pipe" | "overlapped" | "ignore" | "inherit" | number | import("node:stream").Stream | null | undefined;
export type RunExtractedBoxOptions = {
    args?: readonly string[];
    /**
     * values merged over the current process environment
     */
    env?: NodeJS.ProcessEnv;
    stdin?: BoxStdio;
    stdout?: BoxStdio;
    stderr?: BoxStdio;
    /**
     * injectable process seam
     */
    spawn?: typeof spawnProcess;
    /**
     * injectable signal seam
     */
    signalSource?: Pick<NodeJS.Process, "on" | "removeListener">;
};
export type BoxRunResult = {
    exitCode: number | null;
    signal: NodeJS.Signals | null;
};
import { spawn as spawnProcess } from 'node:child_process';
