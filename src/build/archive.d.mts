/**
 * Streams a deterministic, Zip64-capable box archive using the pinned Node backend.
 *
 * @param {string} payloadDir
 * @param {string} archivePath
 * @param {import('../contract/targets.mjs').BoxTargetAdapter} adapter
 * @returns {Promise<void>}
 */
export function createDeterministicZip(payloadDir: string, archivePath: string, adapter: import("../contract/targets.mjs").BoxTargetAdapter): Promise<void>;
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
export function listZipEntries(archivePath: string): Promise<Array<{
    path: string;
    kind: "directory" | "file";
    size: number;
    mode: number;
}>>;
/**
 * Reads one small ZIP metadata entry without extracting the surrounding archive.
 *
 * @param {string} archivePath
 * @param {string} wantedPath
 * @param {number} [maximumBytes]
 * @returns {Promise<string>}
 */
export function readZipEntry(archivePath: string, wantedPath: string, maximumBytes?: number): Promise<string>;
/**
 * Extracts a prevalidated ZIP without shelling out to whatever unzip the host provides.
 *
 * @param {string} archivePath
 * @param {string} destination
 * @returns {Promise<void>}
 */
export function extractZipArchive(archivePath: string, destination: string): Promise<void>;
/**
 * Extracts recipe assets using only pinned Node archive implementations.
 *
 * @param {string} archivePath
 * @param {'zip' | 'tar.gz'} format
 * @param {string} destination
 * @param {number} [stripComponents]
 * @returns {Promise<void>}
 */
export function extractRecipeArchive(archivePath: string, format: "zip" | "tar.gz", destination: string, stripComponents?: number): Promise<void>;
