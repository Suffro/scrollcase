/**
 * Returns the single filename stem shared by an archive and its release document.
 *
 * @param {Pick<import('../contract/types/index.d.ts').BoxReleaseManifest, 'boxId' | 'version' | 'target'>} release
 * @returns {string} `<boxId>-<version>-<targetId>`
 */
export function boxReleaseStem(release: Pick<import("../contract/types/index.d.ts").BoxReleaseManifest, "boxId" | "version" | "target">): string;
/**
 * Returns the immutable object prefix for one box release target.
 *
 * @param {Pick<import('../contract/types/index.d.ts').BoxReleaseManifest, 'boxId' | 'version' | 'target'>} release
 * @returns {string} `boxes/<boxId>/<version>/<targetId>`
 */
export function boxReleaseObjectPrefix(release: Pick<import("../contract/types/index.d.ts").BoxReleaseManifest, "boxId" | "version" | "target">): string;
/**
 * Returns the builder-identity field recorded in provenance: the pixi release that solved the box.
 *
 * @param {{ pixiVersion?: string } | null | undefined} source
 * @returns {{ pixiVersion: string | undefined }}
 */
export function builderVersionFields(source: {
    pixiVersion?: string;
} | null | undefined): {
    pixiVersion: string | undefined;
};
