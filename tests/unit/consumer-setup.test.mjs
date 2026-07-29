import { describe, expect, it, vi } from 'vitest';
import {
  installPythonConsumerDependency,
  installTypeScriptConsumerDependencies,
} from '../../src/build/consumer-setup.mjs';

describe('consumer template dependency setup', () => {
  it('installs Node dependencies from the workspace root', () => {
    const run = vi.fn();

    installTypeScriptConsumerDependencies({
      root: '/work/project',
      scrollcaseVersion: '0.4.6',
      run,
    });

    expect(run.mock.calls).toEqual([
      ['npm', ['install', 'scrollcase@0.4.6'], { cwd: '/work/project' }],
      ['npm', ['install', '--save-dev', 'tsx', 'typescript'], { cwd: '/work/project' }],
    ]);
  });

  it('runs npm through cmd.exe on Windows', () => {
    const run = vi.fn();

    installTypeScriptConsumerDependencies({
      root: 'D:\\work\\project',
      scrollcaseVersion: '0.4.6',
      platform: 'win32',
      comspec: 'C:\\Windows\\System32\\cmd.exe',
      run,
    });

    expect(run.mock.calls).toEqual([
      [
        'C:\\Windows\\System32\\cmd.exe',
        ['/d', '/s', '/c', 'npm', 'install', 'scrollcase@0.4.6'],
        { cwd: 'D:\\work\\project' },
      ],
      [
        'C:\\Windows\\System32\\cmd.exe',
        ['/d', '/s', '/c', 'npm', 'install', '--save-dev', 'tsx', 'typescript'],
        { cwd: 'D:\\work\\project' },
      ],
    ]);
  });

  it('installs the Python consumer with pip from the workspace root', () => {
    const run = vi.fn();
    const runResult = vi.fn((command) => ({
      status: command === 'python3' ? 0 : 1,
      stdout: '',
      stderr: '',
    }));

    const installed = installPythonConsumerDependency({
      root: '/work/project',
      source: 'pypi',
      run,
      runResult,
    });

    expect(installed).toEqual({ source: 'pypi', command: 'python3' });
    expect(runResult.mock.calls).toEqual([
      ['python', ['--version'], { capture: true, cwd: '/work/project' }],
      ['python3', ['--version'], { capture: true, cwd: '/work/project' }],
    ]);
    expect(run).toHaveBeenCalledWith(
      'python3',
      ['-m', 'pip', 'install', 'scrollcase-consumer'],
      { cwd: '/work/project' },
    );
  });

  it('installs the Python consumer with conda from the workspace root', () => {
    const run = vi.fn();
    const runResult = vi.fn();

    const installed = installPythonConsumerDependency({
      root: '/work/project',
      source: 'conda-forge',
      run,
      runResult,
    });

    expect(installed).toEqual({ source: 'conda-forge', command: 'conda' });
    expect(runResult).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      'conda',
      ['install', '--yes', '--channel', 'conda-forge', 'scrollcase-consumer'],
      { cwd: '/work/project' },
    );
  });

  it('rejects an unknown Python package source before running anything', () => {
    const run = vi.fn();

    expect(() => installPythonConsumerDependency({
      root: '/work/project',
      source: 'unknown',
      run,
    })).toThrow('Unsupported Python consumer source unknown.');
    expect(run).not.toHaveBeenCalled();
  });
});
