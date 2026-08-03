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
 * Checks the on-demand assets a caller was told to place, against their signed descriptors.
 *
 * This lives here rather than beside execution because both producers of a receipt need it before
 * one exists, and importing it the other way would close a cycle with `run-extracted.mjs`.
 *
 * @param {string} root
 * @param {readonly RequiredAsset[]} assets
 */
export function verifyRequiredAssets(root: string, assets: readonly RequiredAsset[]): Promise<void>;
/**
 * Verifies and extracts one local box without executing any code from it.
 *
 * The destination must not exist. Extraction happens in a fresh sibling directory so the final
 * rename stays on one filesystem and exposes either the complete verified tree or nothing.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath: string, archive?: string | null, destination: string,
 *   envReport?: boolean, envReportValues?: boolean }} options
 * @returns {Promise<Readonly<PreparedBox>>}
 */
export function verifyAndExtractBox(releaseDocumentPath: string, { publicPath, archive, destination, envReport, envReportValues, }: {
    publicPath: string;
    archive?: string | null;
    destination: string;
    envReport?: boolean;
    envReportValues?: boolean;
}): Promise<Readonly<PreparedBox>>;
/**
 * Re-identifies a box that is already extracted, without its archive.
 *
 * This is what lets an application install a box once and run it across restarts. It performs every
 * check that needs no data beyond the signed release — signature and schema, a target this host can
 * run, the interpreter and execution files present, the signed hashes of on-demand assets — and
 * deliberately does not read the payload. Proving the installed bytes is `verifyExtractedPayload`,
 * a separate decision with a separate cost, which the caller makes when it wants to.
 *
 * Unlike preparation, this asserts the native host: preparation only writes files, but a receipt
 * minted here exists to be executed.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath: string, root: string, envReport?: boolean, envReportValues?: boolean }} options
 * @returns {Promise<Readonly<PreparedBox>>}
 */
export function attachExtractedBox(releaseDocumentPath: string, { publicPath, root, envReport, envReportValues, }: {
    publicPath: string;
    root: string;
    envReport?: boolean;
    envReportValues?: boolean;
}): Promise<Readonly<PreparedBox>>;
/**
 * The result of comparing an extracted tree against the entry list its release commits to.
 *
 * @typedef {object} PayloadVerification
 * @property {'verified'} status
 * @property {string} root
 * @property {string} boxId
 * @property {string} version
 * @property {string} targetId
 * @property {number} entryCount how many payload entries were checked
 * @property {import('../environment.mjs').EnvironmentReport} environmentReport diagnostic snapshot
 */
/**
 * Proves an extracted tree is the one a signed release describes.
 *
 * Deliberately standalone. Nothing calls it — not preparation, not attachment, not execution —
 * because it reads every byte the box carries, and because a check that passed at one moment says
 * nothing about the next: between here and a later import the tree can change, and no library can
 * close that window. Filesystem permissions do, and they belong to the operating system and the
 * application. What this answers is narrower and worth answering: is this directory the box that
 * release describes, and is it still whole.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath: string, root: string, envReport?: boolean, envReportValues?: boolean }} options
 * @returns {Promise<Readonly<PayloadVerification>>}
 */
export function verifyExtractedPayload(releaseDocumentPath: string, { publicPath, root, envReport, envReportValues, }: {
    publicPath: string;
    root: string;
    envReport?: boolean;
    envReportValues?: boolean;
}): Promise<Readonly<PayloadVerification>>;
/**
 * The result of comparing an extracted tree against the entry list its release commits to.
 */
export type PayloadVerification = {
    status: "verified";
    root: string;
    boxId: string;
    version: string;
    targetId: string;
    /**
     * how many payload entries were checked
     */
    entryCount: number;
    /**
     * diagnostic snapshot
     */
    environmentReport: import("../environment.mjs").EnvironmentReport;
};
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
 *
 * `status` says which of the two producers minted it, because they do not prove the same thing.
 * `prepared` means the bytes came from an archive whose signed hash was checked in this process.
 * `attached` means an existing directory was re-identified against a signed release without any
 * archive to check it against — the receipt must not claim more than that.
 */
export type PreparedBox = {
    status: "prepared" | "attached";
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
     * logical size of the box root, measured when this receipt was
     * produced — on an attached receipt it is a current measurement, not an agreement with the release
     */
    installedSizeBytes: number;
    /**
     * diagnostic snapshot
     * of this process's host environment resolved against the signed declaration
     */
    environmentReport: import("../environment.mjs").EnvironmentReport;
};
