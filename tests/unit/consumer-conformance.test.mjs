import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  loadConsumerConformanceSuite,
  runNodeConformanceCase,
} from '../helpers/consumer-conformance.mjs';

const suite = await loadConsumerConformanceSuite();

// Windows boxes are link-free, and creating a link there needs elevation, so a case that requires
// one cannot run on this host. Skipped rather than weakened: the rule it proves is real on the two
// platforms that carry links.
const symlinksSupported = process.platform !== 'win32';

describe('shared consumer conformance — Node', () => {
  for (const testCase of suite.cases) {
    it.skipIf(testCase.requiresSymlinks && !symlinksSupported)(testCase.id, async () => {
      const result = await runNodeConformanceCase({ ...testCase, suite });
      try {
        expect(result.actual).toEqual(result.expected);
      } finally {
        await rm(result.root, { recursive: true, force: true });
      }
    });
  }
});
