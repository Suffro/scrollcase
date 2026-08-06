/**
 * Binds the self-description inside the archive to the signed release outside it.
 *
 * Only fields present in both schema-version-2 documents belong here. Release-only transport data
 * has no counterpart in box.json; every shared identity, target, layout, consumer self-test,
 * asset-policy, and provenance field must agree recursively.
 */
export function assertBoxManifestAgreement(box: any, release: any): void;
/**
 * Performs the half of the trust chain that needs no archive.
 *
 * Everything here answers questions about the signed document alone — is the signature good, is the
 * payload a schema-version-2 release, does it describe a target this build understands. It is split
 * out because a box that is already extracted has no archive to check, and re-deriving these steps
 * beside the ones that do would create the second interpretation of a signed release that
 * `inspectBoxArchive` exists to prevent.
 *
 * @param {string} releaseDocumentPath
 * @param {{ publicPath?: string | null, trustedKeys?: object[] | null }} options exactly one source
 */
export function inspectReleaseDocument(releaseDocumentPath: string, { publicPath, trustedKeys }: {
    publicPath?: string | null;
    trustedKeys?: object[] | null;
}): Promise<{
    releasePath: string;
    signed: any;
    release: unknown;
    adapter: import("../contract/targets.mjs").BoxTargetAdapter;
    schemas: {
        releaseSchema: any;
        boxSchema: any;
        targetSchema: any;
        executionSchema: any;
    };
}>;
/**
 * Performs the complete read-only trust chain shared by `verify` and the local consumer.
 *
 * Keeping this as one operation matters: adding an execution API must not create a second,
 * subtly different interpretation of a signed release. The caller receives the validated
 * in-memory objects and exact archive path, but extraction and execution remain separate steps.
 */
export function inspectBoxArchive(releaseDocumentPath: any, options?: {}): Promise<{
    releasePath: string;
    archivePath: string;
    signed: any;
    release: unknown;
    box: any;
    adapter: import("../contract/targets.mjs").BoxTargetAdapter;
    entries: {
        path: string;
        kind: "directory" | "file";
        size: number;
        mode: number;
    }[];
    files: Set<string>;
}>;
/**
 * Verifies a signed release document and the archive it commits to.
 *
 * `publicPath` names the trusted key file, or `trustedKeys` supplies the keys directly; `archive`
 * overrides the convention of the archive
 * sitting next to its release document; `selfTest` additionally extracts the box and runs its own
 * interpreter, which only works on a matching native host. Returns a summary of what was checked.
 */
export function verifyBox(releaseDocumentPath: any, options?: {}): Promise<{
    status: string;
    localSignatureVerified: boolean;
    signingKeyIds: any;
    releasePayloadSha256: any;
    archiveSha256: any;
    archiveSizeBytes: any;
    selfTest: string;
    environmentReport: import("../environment.mjs").EnvironmentReport;
}>;
