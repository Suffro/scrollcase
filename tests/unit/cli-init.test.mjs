import { describe, expect, it, vi } from 'vitest';
import {
  resolvePythonConsumerSource,
  runInitDependencySetup,
} from '../../src/cli-init.mjs';

describe('init dependency setup', () => {
  it('offers PyPI when conda-forge was selected but Conda is unavailable', async () => {
    const confirmPyPIFallback = vi.fn(async () => true);

    await expect(resolvePythonConsumerSource({
      selectedSource: 'conda-forge',
      condaAvailable: false,
      confirmPyPIFallback,
    })).resolves.toBe('pypi');
    expect(confirmPyPIFallback).toHaveBeenCalledOnce();
  });

  it('skips Python installation when the PyPI fallback is declined', async () => {
    await expect(resolvePythonConsumerSource({
      selectedSource: 'conda-forge',
      condaAvailable: false,
      confirmPyPIFallback: async () => false,
    })).resolves.toBeNull();
  });

  it('collects every answer before starting any installation', async () => {
    const events = [];

    const result = await runInitDependencySetup({
      hasExample: true,
      confirmTypeScript: async () => {
        events.push('answer:typescript');
        return true;
      },
      confirmPython: async () => {
        events.push('answer:python');
        return true;
      },
      choosePythonSource: async () => {
        events.push('answer:python-source');
        return 'pypi';
      },
      installToolchain: async () => {
        events.push('answer:toolchain');
        events.push('install:toolchain');
        return { installed: ['pixi'] };
      },
      installTypeScript: () => {
        events.push('install:typescript');
        return { scrollcaseVersion: '0.4.6' };
      },
      installPython: (source) => {
        events.push(`install:python:${source}`);
        return { source };
      },
    });

    expect(events).toEqual([
      'answer:typescript',
      'answer:python',
      'answer:python-source',
      'answer:toolchain',
      'install:toolchain',
      'install:typescript',
      'install:python:pypi',
    ]);
    expect(result).toMatchObject({
      installTypeScript: true,
      pythonSource: 'pypi',
      toolchain: { installed: ['pixi'] },
    });
  });

  it('asks no consumer questions when no example was generated', async () => {
    const confirmTypeScript = vi.fn();
    const confirmPython = vi.fn();
    const choosePythonSource = vi.fn();
    const installTypeScript = vi.fn();
    const installPython = vi.fn();

    await runInitDependencySetup({
      hasExample: false,
      confirmTypeScript,
      confirmPython,
      choosePythonSource,
      installToolchain: async () => ({ installed: [] }),
      installTypeScript,
      installPython,
    });

    expect(confirmTypeScript).not.toHaveBeenCalled();
    expect(confirmPython).not.toHaveBeenCalled();
    expect(choosePythonSource).not.toHaveBeenCalled();
    expect(installTypeScript).not.toHaveBeenCalled();
    expect(installPython).not.toHaveBeenCalled();
  });
});
