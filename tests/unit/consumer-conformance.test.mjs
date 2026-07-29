import { rm } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  loadConsumerConformanceSuite,
  runNodeConformanceCase,
} from '../helpers/consumer-conformance.mjs';

const suite = await loadConsumerConformanceSuite();

describe('shared consumer conformance — Node', () => {
  for (const testCase of suite.cases) {
    it(testCase.id, async () => {
      const result = await runNodeConformanceCase({ ...testCase, suite });
      try {
        expect(result.actual).toEqual(result.expected);
      } finally {
        await rm(result.root, { recursive: true, force: true });
      }
    });
  }
});
