import { describe, expect, it } from 'vitest';
import {
  formatEnvironmentReport,
  mergeEnvironmentLayers,
  resolveEnvironment,
  shouldReportEnvironment,
} from '../../src/environment.mjs';

describe('box environment resolution', () => {
  it('gives the last layer precedence across Windows name casing', () => {
    const environment = mergeEnvironmentLayers(
      'windows',
      { Path: 'host', KEEP: 'yes' },
      { PATH: 'release' },
    );
    expect(environment).toEqual({ KEEP: 'yes', PATH: 'release' });
  });

  it('keeps inheritance, masks host values, and selects declarations and code-loading controls', () => {
    const { environment, report } = resolveEnvironment({
      platform: 'linux',
      layers: [
        { source: 'host', values: { ORDINARY: 'host', PYTHONPATH: '/host/code', SHARED: 'secret' } },
        { source: 'caller', values: { SHARED: 'caller' } },
        { source: 'release', values: { SHARED: 'release', MODEL_ROOT: 'models' } },
      ],
      executionAffectingVariables: ['PYTHONPATH', 'LD_PRELOAD'],
    });

    expect(environment).toEqual({
      ORDINARY: 'host',
      PYTHONPATH: '/host/code',
      SHARED: 'release',
      MODEL_ROOT: 'models',
    });
    expect(report).toMatchObject({
      mode: 'summary',
      hostValuesRevealed: false,
      releaseVariableCount: 2,
      conflictCount: 1,
      dangerousHostVariables: ['PYTHONPATH'],
      remainingVariableCount: 1,
    });
    expect(report.variables.find((entry) => entry.name === 'PYTHONPATH').value).toBe('<masked>');
    expect(report.variables.find((entry) => entry.name === 'SHARED')).toMatchObject({
      source: 'release',
      value: 'release',
      conflict: true,
    });
    expect(shouldReportEnvironment(report)).toBe(true);
  });

  it('expands every name but reveals inherited host values only with explicit consent', () => {
    const masked = resolveEnvironment({
      platform: 'macos',
      layers: [{ source: 'host', values: { TOKEN: 'secret' } }],
      expanded: true,
    }).report;
    expect(masked.variables[0].value).toBe('<masked>');
    expect(masked.remainingVariableCount).toBe(0);

    const revealed = resolveEnvironment({
      platform: 'macos',
      layers: [{ source: 'host', values: { TOKEN: 'secret' } }],
      expanded: true,
      revealHostValues: true,
    }).report;
    expect(revealed.variables[0].value).toBe('secret');
    expect(formatEnvironmentReport(revealed)).toEqual([
      'Environment:',
      '  TOKEN=secret [host]',
    ]);
  });
});
