/**
 * `audit` — the dependency licence inventory, without building anything.
 *
 * The inventory is a pure function of the committed lock, so it can be produced, reviewed and
 * checked into a repository long before any box exists. That matters because licence review is a
 * human step: it should happen when dependencies change, not in the middle of a multi-gigabyte build
 * that then fails at the end.
 *
 * The same function the build runs is used here, so a reviewed audit and the one a build produces
 * cannot disagree by construction.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { boxTargetId } from '../contract/targets.mjs';
import { compareStableStrings, fileExists, safeRelativePath } from './filesystem.mjs';
import { createCondaDependencyLicenseAudit, validateCondaDependencyLicenseAudit } from './licenses.mjs';
import { fail } from './process.mjs';
import { readScroll } from './scroll.mjs';
import { getWorkspace } from './workspace.mjs';

/**
 * Produces the inventory for a scroll, and either checks it against the reviewed copy or writes it.
 *
 * Writing is explicit (`write: true`) because overwriting the reviewed file is how an unreviewed
 * licence change would slip through: the default is to compare and fail on any difference.
 */
export async function auditScroll(name, { write = false, namespace } = {}) {
  const workspace = getWorkspace();
  const { dir, scroll } = await readScroll(name);
  const lockPath = join(dir, 'pixi.lock');
  if (!await fileExists(lockPath)) fail(`Missing dependency lock: ${lockPath}`);
  const inventory = createCondaDependencyLicenseAudit({
    lockBytes: await readFile(lockPath),
    targetId: boxTargetId(scroll.target),
    ...(namespace ? { namespace } : {}),
  });

  // A package with no declared licence never reaches here: parsing the lock rejects it outright,
  // which is the point — an unlicensed dependency is a legal problem, not a reporting gap.
  const licences = new Map();
  for (const entry of inventory.packages) {
    licences.set(entry.declaredLicense, (licences.get(entry.declaredLicense) ?? 0) + 1);
  }
  const summary = {
    scrollId: scroll.scrollId,
    targetId: inventory.targetId,
    packageCount: inventory.packages.length,
    licenses: [...licences]
      .sort((left, right) => right[1] - left[1] || compareStableStrings(left[0], right[0]))
      .map(([license, count]) => ({ license, count })),
  };

  if (!scroll.condaDependencyLicenseAudit) {
    if (write) fail('The scroll declares no condaDependencyLicenseAudit path to write to.');
    return { inventory, summary, reviewed: null };
  }
  const reviewedPath = join(workspace.root, safeRelativePath(scroll.condaDependencyLicenseAudit));
  if (write) {
    await mkdir(dirname(reviewedPath), { recursive: true });
    await writeFile(reviewedPath, `${JSON.stringify(inventory, null, 2)}\n`);
    return { inventory, summary, reviewed: reviewedPath, written: true };
  }
  if (!await fileExists(reviewedPath)) {
    fail(`Reviewed licence audit is missing: ${reviewedPath}. Run audit --write and review the result.`);
  }
  validateCondaDependencyLicenseAudit(JSON.parse(await readFile(reviewedPath, 'utf8')), inventory);
  return { inventory, summary, reviewed: reviewedPath, written: false };
}
