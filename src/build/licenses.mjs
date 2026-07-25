/**
 * Builds the dependency licence inventory shipped inside every box.
 *
 * The inventory is derived from the committed lock file rather than from the installed tree: the
 * lock already carries an SPDX licence per package, and `pixi install --frozen` guarantees the
 * installed set equals it. That makes the audit a pure function of a file the user reviews, so it
 * can be computed without a built prefix and cannot drift from what was approved.
 */

import { createHash } from 'node:crypto';
import { DEFAULT_DOCUMENT_NAMESPACE } from '../contract/documents.mjs';

function fail(message) {
  throw new Error(`box licence audit: ${message}`);
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** conda ships packages as `.conda` or the older `.tar.bz2`; both encode name-version-build. */
const CONDA_PACKAGE_FILE = /\.(?:conda|tar\.bz2)$/;

/** Derives (name, version) from a conda package filename: `name-version-build.conda`. */
export function parseCondaPackageReference(url) {
  const file = String(url).split('/').pop() ?? '';
  const stem = file.replace(CONDA_PACKAGE_FILE, '');
  const parts = stem.split('-');
  // conda names may contain '-', but version and build never do, so they are the last two segments.
  if (parts.length < 3 || stem === file) fail(`unparseable conda package filename: ${file}`);
  parts.pop(); // build string
  const version = parts.pop();
  return { name: parts.join('-'), version };
}

/**
 * Parses the exact conda + pypi distributions and their declared licenses from a pixi.lock.
 *
 * The `packages:` section is a YAML list of `- conda: <url>` / `- pypi: <url>` items, each followed
 * by indented `key: value` fields. This scans that regular, machine-generated structure directly
 * rather than taking a transitive YAML dependency.
 */
export function lockedCondaDistributions(lockBytes) {
  const lines = lockBytes.toString('utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line === 'packages:');
  if (start === -1) fail('pixi.lock has no packages section');
  const distributions = [];
  let current = null;
  const flush = () => {
    if (!current) return;
    let { name, version } = current;
    if (current.source === 'conda') ({ name, version } = parseCondaPackageReference(current.url));
    if (!name || !version) fail(`pixi.lock package lacks a name or version: ${current.url}`);
    if (!current.license || current.license.toUpperCase() === 'UNKNOWN') {
      fail(`${name}==${version} lacks a declared license in pixi.lock`);
    }
    // conda/pypi filenames already carry the canonical name, so keep raw names — normalizing
    // would mangle legitimate leading-underscore conda names like `_openmp_mutex`.
    distributions.push({ name, version, declaredLicense: current.license, source: current.source });
    current = null;
  };
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    const entry = /^- (conda|pypi): (.+)$/.exec(line);
    if (entry) {
      flush();
      current = { source: entry[1], url: entry[2], name: null, version: null, license: null };
      continue;
    }
    if (!current) continue;
    // A non-indented, non-empty line ends the packages section (defensive; it is normally last).
    if (line !== '' && !line.startsWith(' ')) { flush(); break; }
    const field = /^ {2}(\w[\w-]*): (.*)$/.exec(line);
    if (!field) continue;
    const [, key, value] = field;
    if (key === 'license' && current.license === null) current.license = value.trim();
    else if (key === 'name' && current.name === null) current.name = value.trim();
    else if (key === 'version' && current.version === null) current.version = value.trim();
  }
  flush();
  return distributions.sort((left, right) =>
    left.name.localeCompare(right.name) || left.version.localeCompare(right.version));
}

/** Builds the deterministic conda license audit bound to one pixi.lock and target. */
export function createCondaDependencyLicenseAudit({ lockBytes, targetId, namespace = DEFAULT_DOCUMENT_NAMESPACE }) {
  return {
    schemaVersion: 1,
    kind: `${namespace}.dependency-license-audit`,
    targetId,
    dependencyLockSha256: sha256(lockBytes),
    packages: lockedCondaDistributions(lockBytes),
  };
}

/** Ensures a reviewed conda audit still matches the current pixi.lock exactly. */
export function validateCondaDependencyLicenseAudit(reviewed, actual) {
  if (reviewed?.schemaVersion !== 1 || reviewed.kind !== actual.kind) fail('reviewed conda audit contract is invalid');
  if (JSON.stringify(reviewed) !== JSON.stringify(actual)) {
    fail('locked conda dependency licenses differ from the reviewed audit');
  }
  return actual;
}
