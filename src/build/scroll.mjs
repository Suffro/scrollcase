/**
 * Reading a scroll, and the provenance of the build that reads it.
 *
 * A scroll is the only input a build accepts, so it is validated before anything is installed. In
 * the nested layout, the meaningful declarations police the path: `boxId` names the parent and the
 * canonical target names the child. Python layout is checked against the target before the scroll
 * reaches any tool discovery or build mutation.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { assertPythonEntryPoint, boxTargetAdapter, boxTargetId } from '../contract/targets.mjs';
import { compareStableStrings, fileExists, safeRelativePath } from './filesystem.mjs';
import { fail, runResult } from './process.mjs';
import { schemaValidationError } from './schema-validation.mjs';
import { getWorkspace } from './workspace.mjs';

const scrollSchemaUrl = new URL('../contract/schema/scroll.schema.json', import.meta.url);
const targetSchemaUrl = new URL('../contract/schema/target.schema.json', import.meta.url);
let scrollSchemas;

async function loadScrollSchemas() {
  scrollSchemas ??= Promise.all([scrollSchemaUrl, targetSchemaUrl]
    .map(async (url) => JSON.parse(await readFile(url, 'utf8'))));
  return scrollSchemas;
}

/** Resolves an exact scroll reference to its directory, refusing anything outside the scrolls root. */
export function scrollDirectory(reference) {
  const root = getWorkspace().scrollsDir;
  const normalized = safeRelativePath(reference);
  const path = resolve(root, ...normalized.split('/'));
  if (path === root || !path.startsWith(`${root}${sep}`)) fail(`Invalid scroll: ${reference}`);
  return path;
}

/** Loads one exact nested scroll reference and normalises its provenance identity. */
async function readExactScroll(reference) {
  const normalized = safeRelativePath(reference);
  const parts = normalized.split('/');
  if (parts.length !== 2) fail(`Invalid scroll reference ${reference}; use <boxId>/<targetId>.`);
  const dir = scrollDirectory(normalized);
  const scroll = JSON.parse(await readFile(resolve(dir, 'scroll.json'), 'utf8'));
  const [scrollSchema, targetSchema] = await loadScrollSchemas();
  const validationError = schemaValidationError(scroll, scrollSchema, [targetSchema]);
  if (validationError) fail(`Invalid scroll ${normalized}: ${validationError}.`);
  if (scroll.weights === 'on-demand' && (scroll.assetArchives ?? []).length > 0) {
    fail('on-demand weights cannot be combined with assetArchives, which are expanded at build time.');
  }
  const payloadPaths = [
    scroll.modelCacheSubdir,
    ...scroll.assets.map((asset) => asset.relativePath),
    ...(scroll.assetArchives ?? []).flatMap((archive) => [archive.relativePath, archive.destination]),
    ...(scroll.localFiles ?? []).flatMap((file) => [file.sourcePath, file.relativePath]),
    ...(scroll.prunePaths ?? []),
    ...scroll.selfTest.files,
    ...(scroll.parity ? [scroll.parity.script] : []),
    ...(scroll.condaDependencyLicenseAudit ? [scroll.condaDependencyLicenseAudit] : []),
  ];
  for (const path of payloadPaths) safeRelativePath(path);
  const adapter = boxTargetAdapter(scroll.target);
  const targetId = boxTargetId(scroll.target);
  if (parts.length === 2) {
    const [boxDirectory, targetDirectory] = parts;
    if (boxDirectory !== scroll.boxId) {
      fail(`Nested scroll box directory ${boxDirectory} does not match scroll boxId ${scroll.boxId}.`);
    }
    if (targetDirectory !== targetId) {
      fail(`Nested scroll target directory ${targetDirectory} does not match declared target ${targetId}.`);
    }
  }
  assertPythonEntryPoint(adapter, scroll.pythonEntryPoint);
  return {
    adapter,
    dir,
    scroll: {
      ...scroll,
      // Provenance needs a stable source identity. It is derived when the scroll does not name one,
      // so the directory layout remains checked context rather than a second wire identity.
      scrollId: scroll.scrollId ?? `${scroll.boxId}-${targetId}`,
    },
    reference: normalized,
    targetId,
  };
}

/**
 * Lists the scrolls named by a CLI/library reference.
 *
 * An exact `<boxId>/<targetId>` reference loads one scroll. A single box name expands to its
 * `scrolls/<boxId>/<targetId>/` children. Every child is validated before it is offered, so a
 * misleading directory never becomes a selectable target.
 */
export async function scrollCandidates(name) {
  const reference = safeRelativePath(name);
  if (reference.includes('/')) {
    if (reference.split('/').length !== 2
      || !await fileExists(join(scrollDirectory(reference), 'scroll.json'))) {
      fail(`Scroll not found: ${reference}.`);
    }
    return [await readExactScroll(reference)];
  }

  let entries;
  try {
    entries = await readdir(scrollDirectory(reference), { withFileTypes: true });
  } catch {
    return fail(`Scroll or box not found: ${reference}.`);
  }
  const candidates = [];
  for (const entry of entries.sort((left, right) => compareStableStrings(left.name, right.name))) {
    if (!entry.isDirectory()) continue;
    const nestedReference = `${reference}/${entry.name}`;
    if (await fileExists(join(scrollDirectory(nestedReference), 'scroll.json'))) {
      candidates.push(await readExactScroll(nestedReference));
    }
  }
  if (candidates.length === 0) fail(`Box ${reference} contains no target scrolls.`);
  return candidates;
}

/**
 * Loads a scroll without prompting.
 *
 * Library callers may select a target explicitly. An unambiguous box shorthand is also accepted;
 * ambiguity is a hard error here because only the CLI edge is allowed to ask a person.
 */
export async function readScroll(name, { targetId = null } = {}) {
  let candidates = await scrollCandidates(name);
  if (targetId) {
    candidates = candidates.filter((candidate) => candidate.targetId === targetId);
    if (candidates.length === 0) {
      fail(`Target ${targetId} is not available for ${name}.`);
    }
  }
  if (candidates.length > 1) {
    fail(
      `Box ${name} has multiple scroll targets (${candidates.map((candidate) => candidate.targetId).join(', ')}); `
      + 'use <boxId>/<targetId> or select a target explicitly.',
    );
  }
  return candidates[0];
}

/**
 * Build timestamp taken from the HEAD commit rather than the clock, so rebuilding the same commit
 * produces the same provenance. Falls back to the epoch outside a git checkout — deliberately a
 * constant, since a wall-clock fallback would reintroduce the nondeterminism this avoids.
 */
export function sourceBuildTime(cwd) {
  const result = runResult('git', ['show', '-s', '--format=%cI', 'HEAD'], { capture: true, cwd });
  return result.status === 0 ? result.stdout.trim() : new Date(0).toISOString();
}

/**
 * The commit a box was built from, and whether the tree had uncommitted changes at the time.
 *
 * Outside a git checkout there is no revision to record, which callers must handle explicitly rather
 * than inventing one: an unversioned build is reproducible by nobody.
 */
export function sourceBuildState(cwd) {
  const revision = runResult('git', ['rev-parse', 'HEAD'], { capture: true, cwd });
  if (revision.status !== 0) return null;
  const status = runResult('git', ['status', '--porcelain', '--untracked-files=all'], { capture: true, cwd });
  return { revision: revision.stdout.trim(), dirty: status.stdout.trim().length > 0 };
}
