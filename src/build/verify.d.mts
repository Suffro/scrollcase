/**
 * Binds the self-description inside the archive to the signed release outside it.
 *
 * Only fields present in both schema-version-2 documents belong here. Release-only transport data
 * has no counterpart in box.json; every shared identity, target, layout, consumer self-test,
 * asset-policy, and provenance field must agree recursively.
 */
export function assertBoxManifestAgreement(box: any, release: any): void;
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
 * `publicPath` names the trusted key file; `archive` overrides the convention of the archive
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
}>;
