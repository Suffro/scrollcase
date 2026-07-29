/**
 * Returns the private, verified release bound to a prepared receipt.
 *
 * This is internal to the consumer module graph; it is not re-exported from the package surface.
 */
export function preparedBoxState(prepared: unknown): {
    release: import("../contract/types/index.d.ts").BoxReleaseManifest;
    rootIdentity: {
        device: number;
        inode: number;
    };
};
/**
 * Verifies and extracts one local box without executing any code from it.
 *
 * The destination must not exist. Extraction happens in a fresh sibling directory so the final
 * rename stays on one filesystem and exposes either the complete verified tree or nothing.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath: string, archive?: string | null, destination: string }} options
 * @returns {Promise<Readonly<PreparedBox>>}
 */
export function verifyAndExtractBox(releaseDocumentPath: string, { publicPath, archive, destination, }: {
    publicPath: string;
    archive?: string | null;
    destination: string;
}): Promise<Readonly<PreparedBox>>;
/**
 * An on-demand asset whose signed bytes the caller must place under `root` before execution.
 */
export type RequiredAsset = {
    url: string;
    relativePath: string;
    sizeBytes: number;
    sha256: string;
};
/**
 * The immutable result of a successfully verified and atomically prepared local box.
 */
export type PreparedBox = {
    status: "prepared";
    /**
     * absolute extracted box root
     */
    root: string;
    boxId: string;
    modelId: string;
    runtimeId: string;
    version: string;
    target: import("../contract/types/index.d.ts").BoxTarget;
    targetId: string;
    pythonEntryPoint: string;
    execution: import("../contract/types/index.d.ts").BoxExecution | null;
    /**
     * assets the caller must materialize, never
     * downloaded by Scrollcase
     */
    requiredAssets: readonly RequiredAsset[];
    signingKeyIds: readonly string[];
    releasePayloadSha256: string;
    archiveSha256: string;
    archiveSizeBytes: number;
    /**
     * logical size of the verified extracted payload
     */
    installedSizeBytes: number;
};
