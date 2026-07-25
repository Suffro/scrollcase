import { boxTargetId } from '../contract/targets.mjs';

/** Returns the single filename stem shared by an archive and its release document. */
export function boxReleaseStem(release) {
  return `${release.boxId}-${release.version}-${boxTargetId(release.target)}`;
}

/** Returns the immutable object prefix for one box release target. */
export function boxReleaseObjectPrefix(release) {
  return `boxes/${release.boxId}/${release.version}/${boxTargetId(release.target)}`;
}

/** Returns the builder-identity field recorded in provenance: the pixi release that solved the box. */
export function builderVersionFields(source) {
  return { pixiVersion: source?.pixiVersion };
}
