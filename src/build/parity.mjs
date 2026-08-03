/**
 * Accelerator parity: does this box compute the same thing on the GPU as on the CPU?
 *
 * That question sounds scientific but is a packaging question. It catches the failures this tool is
 * responsible for — the wrong wheels solved in, a CPU-only build shipped as CUDA, a broken BLAS —
 * and it catches them on the build machine rather than on a user's.
 *
 * The division of labour matters. Scrollcase owns the mechanism: run the declared check inside the
 * box once per accelerator, compare the numbers, enforce the declared tolerances, report what was
 * measured. The project owns the meaning: which input to feed the model, which tensor to read, and
 * what closeness is acceptable for it. The tool never decides what is scientifically correct — it
 * enforces a threshold its user wrote down.
 */

import { fail } from './process.mjs';
import { mergeEnvironmentLayers } from '../environment.mjs';

/** Reads the array of numbers a parity check prints, rejecting anything else. */
function readValues(output, accelerator) {
  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    fail(`Parity check on ${accelerator} did not print JSON: ${String(output).trim().slice(0, 200)}`);
  }
  const values = Array.isArray(parsed) ? parsed : parsed?.values;
  if (!Array.isArray(values) || values.length === 0) {
    fail(`Parity check on ${accelerator} printed no "values" array.`);
  }
  if (!values.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    // A NaN or an infinity is the classic symptom of a broken accelerator build, so it is reported
    // as such rather than being allowed to poison the comparison arithmetic below.
    fail(`Parity check on ${accelerator} produced non-finite values.`);
  }
  return values;
}

/** Compares two runs: largest absolute and relative difference, and cosine similarity. */
export function compareValues(reference, candidate) {
  if (reference.length !== candidate.length) {
    fail(`Parity outputs differ in length: ${reference.length} vs ${candidate.length}.`);
  }
  let maximumAbsolute = 0;
  let maximumRelative = 0;
  let dot = 0;
  let referenceNorm = 0;
  let candidateNorm = 0;
  for (const [index, expected] of reference.entries()) {
    const actual = candidate[index];
    const absolute = Math.abs(actual - expected);
    maximumAbsolute = Math.max(maximumAbsolute, absolute);
    // Relative error is meaningless around zero, so it is only counted where the reference has
    // magnitude; the absolute bound is what guards the near-zero entries.
    if (Math.abs(expected) > 0) maximumRelative = Math.max(maximumRelative, absolute / Math.abs(expected));
    dot += expected * actual;
    referenceNorm += expected * expected;
    candidateNorm += actual * actual;
  }
  const norms = Math.sqrt(referenceNorm) * Math.sqrt(candidateNorm);
  return {
    maximumAbsoluteError: maximumAbsolute,
    maximumRelativeError: maximumRelative,
    cosineSimilarity: norms > 0 ? dot / norms : 1,
  };
}

/** Reports which declared tolerance a measurement breaches, or null when it satisfies them all. */
export function breachedTolerance(measured, tolerances) {
  const { absolute = null, relative = null, minimumCosine = null } = tolerances ?? {};
  if (absolute !== null && measured.maximumAbsoluteError > absolute) {
    return `maximum absolute error ${measured.maximumAbsoluteError} exceeds ${absolute}`;
  }
  if (relative !== null && measured.maximumRelativeError > relative) {
    return `maximum relative error ${measured.maximumRelativeError} exceeds ${relative}`;
  }
  if (minimumCosine !== null && measured.cosineSimilarity < minimumCosine) {
    return `cosine similarity ${measured.cosineSimilarity} is below ${minimumCosine}`;
  }
  return null;
}

/**
 * Runs the scroll's parity check across the declared accelerators and enforces its tolerances.
 *
 * The first accelerator listed is the reference every other run is compared against — conventionally
 * `cpu`, because it is the one available everywhere and the least likely to be wrong. Returns the
 * measurements so they can be recorded as evidence even when nothing failed.
 */
export async function checkParity({ parity, adapter, interpreter, payloadDir, environment, run }) {
  if (!parity) return null;
  const { script, accelerators, tolerances } = parity;
  if (!Array.isArray(accelerators) || accelerators.length < 2) {
    fail('A parity check needs at least two accelerators to compare.');
  }
  const runs = [];
  for (const accelerator of accelerators) {
    const validationEnvironment = adapter.validationEnvironments[accelerator];
    if (!validationEnvironment) {
      fail(`Target ${adapter.id} defines no validation environment for accelerator ${accelerator}.`);
    }
    const output = run(interpreter, [script], {
      cwd: payloadDir,
      env: mergeEnvironmentLayers(adapter.platform, environment ?? {}, validationEnvironment),
      capture: true,
    });
    runs.push({ accelerator, values: readValues(output, accelerator) });
  }
  const [reference, ...others] = runs;
  const comparisons = others.map(({ accelerator, values }) => {
    const measured = compareValues(reference.values, values);
    const breach = breachedTolerance(measured, tolerances);
    if (breach) fail(`Parity check ${reference.accelerator} vs ${accelerator}: ${breach}.`);
    return { accelerator, reference: reference.accelerator, ...measured };
  });
  return { script, tolerances, valueCount: reference.values.length, comparisons };
}
