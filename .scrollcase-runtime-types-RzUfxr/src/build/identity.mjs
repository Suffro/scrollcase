/**
 * Naming: where a release's artefacts live relative to everything else.
 *
 * The stem and object prefix are derived from the release's identity fields alone, so the archive,
 * its release document, and the staged objects always agree on their names without any of them
 * recording the others' paths. Whatever a consumer uses to serve boxes, laying storage out under
 * this prefix means the URLs inside the signed documents already point at the right objects.
 */
import { boxTargetId } from '../contract/targets.mjs';

/**
 * Returns the single filename stem shared by an archive and its release document.
 *
 * @param {Pick<import('../contract/types/index.d.ts').BoxReleaseManifest, 'boxId' | 'version' | 'target'>} release
 * @returns {string} `<boxId>-<version>-<targetId>`
 */
export function boxReleaseStem(release) {
  return `${release.boxId}-${release.version}-${boxTargetId(release.target)}`;
}

/**
 * Returns the immutable object prefix for one box release target.
 *
 * @param {Pick<import('../contract/types/index.d.ts').BoxReleaseManifest, 'boxId' | 'version' | 'target'>} release
 * @returns {string} `boxes/<boxId>/<version>/<targetId>`
 */
export function boxReleaseObjectPrefix(release) {
  return `boxes/${release.boxId}/${release.version}/${boxTargetId(release.target)}`;
}

/**
 * Returns the builder-identity field recorded in provenance: the pixi release that solved the box.
 *
 * @param {{ pixiVersion?: string } | null | undefined} source
 * @returns {{ pixiVersion: string | undefined }}
 */
export function builderVersionFields(source) {
  return { pixiVersion: source?.pixiVersion };
}
