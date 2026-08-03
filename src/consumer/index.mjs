/**
 * Local box preparation and execution.
 *
 * This surface composes with a caller's distribution policy; it does not become that policy. Every
 * path, trust anchor, archive and destination comes from the caller, and no box code runs until the
 * complete signed release and archive trust chain has passed.
 */

/** @typedef {import('./verify-and-extract.mjs').PreparedBox} PreparedBox */
/** @typedef {import('./verify-and-extract.mjs').PayloadVerification} PayloadVerification */
/** @typedef {import('./verify-and-extract.mjs').RequiredAsset} RequiredAsset */
/** @typedef {import('./run-extracted.mjs').BoxRunResult} BoxRunResult */
/** @typedef {import('./run-extracted.mjs').RunExtractedBoxOptions} RunExtractedBoxOptions */
/** @typedef {import('./run-box.mjs').RunBoxOptions} RunBoxOptions */
/** @typedef {import('../environment.mjs').EnvironmentSource} EnvironmentSource */
/** @typedef {import('../environment.mjs').EnvironmentSourceValue} EnvironmentSourceValue */
/** @typedef {import('../environment.mjs').EnvironmentVariableReport} EnvironmentVariableReport */
/** @typedef {import('../environment.mjs').EnvironmentReport} EnvironmentReport */

export {
  attachExtractedBox,
  verifyAndExtractBox,
  verifyExtractedPayload,
} from './verify-and-extract.mjs';
export { runExtractedBox } from './run-extracted.mjs';
export { runBox } from './run-box.mjs';
