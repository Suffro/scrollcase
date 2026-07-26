/**
 * Derives (name, version) from a conda package filename: `name-version-build.conda`.
 *
 * @param {string} url a conda package URL or filename
 * @returns {{ name: string, version: string }}
 * @throws {Error} when the filename is not `name-version-build.conda`
 */
export function parseCondaPackageReference(url: string): {
    name: string;
    version: string;
};
/**
 * Parses the exact conda + pypi distributions and their declared licenses from a pixi.lock.
 *
 * The `packages:` section is a YAML list of `- conda: <url>` / `- pypi: <url>` items, each followed
 * by indented `key: value` fields. This scans that regular, machine-generated structure directly
 * rather than taking a transitive YAML dependency.
 *
 * @param {Buffer} lockBytes the committed `pixi.lock`
 * @returns {LockedDistribution[]} sorted by name then version
 * @throws {Error} when the lock is unparseable or a package lacks a licence
 */
export function lockedCondaDistributions(lockBytes: Buffer): LockedDistribution[];
/**
 * Builds the deterministic conda license audit bound to one pixi.lock and target.
 *
 * @param {{ lockBytes: Buffer, targetId: string, namespace?: string }} options
 * @returns {{ schemaVersion: 1, kind: string, targetId: string, dependencyLockSha256: string,
 *   packages: LockedDistribution[] }}
 * @throws {Error} when a locked package declares no licence
 */
export function createCondaDependencyLicenseAudit({ lockBytes, targetId, namespace }: {
    lockBytes: Buffer;
    targetId: string;
    namespace?: string;
}): {
    schemaVersion: 1;
    kind: string;
    targetId: string;
    dependencyLockSha256: string;
    packages: LockedDistribution[];
};
/**
 * Ensures a reviewed conda audit still matches the current pixi.lock exactly.
 *
 * @param {unknown} reviewed the audit committed to the repository
 * @param {ReturnType<typeof createCondaDependencyLicenseAudit>} actual
 * @returns {ReturnType<typeof createCondaDependencyLicenseAudit>} `actual`, when they agree
 * @throws {Error} when the lock no longer matches what was reviewed
 */
export function validateCondaDependencyLicenseAudit(reviewed: unknown, actual: ReturnType<typeof createCondaDependencyLicenseAudit>): ReturnType<typeof createCondaDependencyLicenseAudit>;
/**
 * One package as the lock declares it.
 */
export type LockedDistribution = {
    name: string;
    version: string;
    /**
     * the SPDX expression carried by the lock
     */
    declaredLicense: string;
    source: "conda" | "pypi";
};
