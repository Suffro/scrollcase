import { describe, expect, it } from 'vitest';
import { breachedTolerance, checkParity, compareValues } from '../../src/build/parity.mjs';
import { boxTargetAdapter } from '../../src/contract/targets.mjs';

const adapter = boxTargetAdapter({ platform: 'linux', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.9' });

/** A check script that prints a different vector per accelerator, as a real one would. */
function scriptedRun(outputs) {
  const seen = [];
  const run = (interpreter, args, options) => {
    const accelerator = options.env.CUDA_VISIBLE_DEVICES === '' ? 'cpu' : 'cuda';
    seen.push(accelerator);
    const output = outputs[accelerator];
    return typeof output === 'string' ? output : JSON.stringify({ values: output });
  };
  return { run, seen };
}

describe('comparing two runs', () => {
  it('measures absolute error, relative error, and cosine similarity', () => {
    const measured = compareValues([1, 2, 4], [1.001, 2, 4]);
    expect(measured.maximumAbsoluteError).toBeCloseTo(0.001, 12);
    expect(measured.maximumRelativeError).toBeCloseTo(0.001, 12);
    expect(measured.cosineSimilarity).toBeGreaterThan(0.9999);
  });

  it('ignores relative error where the reference is zero, and still bounds it absolutely', () => {
    // Relative error against zero is infinite and meaningless; the absolute bound is what guards it.
    const measured = compareValues([0, 10], [0.5, 10]);
    expect(measured.maximumRelativeError).toBe(0);
    expect(measured.maximumAbsoluteError).toBe(0.5);
  });

  it('refuses to compare outputs of different lengths', () => {
    expect(() => compareValues([1, 2], [1])).toThrow(/differ in length/);
  });

  it('reports which declared bound a measurement breaches', () => {
    const measured = { maximumAbsoluteError: 0.1, maximumRelativeError: 0.2, cosineSimilarity: 0.5 };
    expect(breachedTolerance(measured, { absolute: 0.01 })).toMatch(/absolute error/);
    expect(breachedTolerance(measured, { relative: 0.01 })).toMatch(/relative error/);
    expect(breachedTolerance(measured, { minimumCosine: 0.99 })).toMatch(/cosine similarity/);
    expect(breachedTolerance(measured, { absolute: 1, relative: 1, minimumCosine: 0.1 })).toBeNull();
  });
});

describe('the parity gate', () => {
  const parity = {
    script: 'checks/embedding.py',
    accelerators: ['cpu', 'cuda'],
    tolerances: { absolute: 1e-4, minimumCosine: 0.9999 },
  };
  const args = (run) => ({ parity, adapter, interpreter: '/box/venv/bin/python', payloadDir: '/box', run });

  it('runs the check once per accelerator, under each accelerator environment', async () => {
    const { run, seen } = scriptedRun({ cpu: [1, 2, 3], cuda: [1, 2, 3.00001] });
    const result = await checkParity(args(run));
    expect(seen).toEqual(['cpu', 'cuda']);
    expect(result.comparisons).toHaveLength(1);
    expect(result.comparisons[0]).toMatchObject({ accelerator: 'cuda', reference: 'cpu' });
    expect(result.valueCount).toBe(3);
  });

  it('applies the signed environment to every parity run', async () => {
    const calls = [];
    const run = (_interpreter, _args, options) => {
      calls.push(options.env);
      return JSON.stringify({ values: [1, 2, 3] });
    };
    await checkParity({
      ...args(run),
      environment: { SCROLLCASE_MODEL_ROOT: 'model-cache/example' },
    });
    expect(calls).toHaveLength(2);
    expect(calls.every((environment) =>
      environment.SCROLLCASE_MODEL_ROOT === 'model-cache/example')).toBe(true);
  });

  it('fails the build when the accelerator drifts outside the declared tolerance', async () => {
    const { run } = scriptedRun({ cpu: [1, 2, 3], cuda: [1, 2, 9] });
    await expect(checkParity(args(run))).rejects.toThrow(/Parity check cpu vs cuda/);
  });

  it('rejects non-finite output, the classic symptom of a broken accelerator build', async () => {
    const { run } = scriptedRun({ cpu: [1, 2, 3], cuda: '{"values": [1, 2, null]}' });
    await expect(checkParity(args(run))).rejects.toThrow(/non-finite/);
  });

  it('rejects a check that prints something other than numbers', async () => {
    const { run } = scriptedRun({ cpu: 'not json at all', cuda: [1] });
    await expect(checkParity(args(run))).rejects.toThrow(/did not print JSON/);
    const empty = scriptedRun({ cpu: '{"values": []}', cuda: [1] });
    await expect(checkParity(args(empty.run))).rejects.toThrow(/no "values" array/);
  });

  it('needs at least two accelerators, and one the target actually defines', async () => {
    const { run } = scriptedRun({ cpu: [1], cuda: [1] });
    await expect(checkParity({ ...args(run), parity: { ...parity, accelerators: ['cpu'] } }))
      .rejects.toThrow(/at least two accelerators/);
    await expect(checkParity({ ...args(run), parity: { ...parity, accelerators: ['cpu', 'metal'] } }))
      .rejects.toThrow(/no validation environment/);
  });

  it('is optional: a scroll without a parity block skips the gate entirely', async () => {
    expect(await checkParity({ parity: undefined, adapter, interpreter: 'x', payloadDir: '/box', run: () => '' }))
      .toBeNull();
  });
});
