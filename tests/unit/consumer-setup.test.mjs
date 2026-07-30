import { describe, expect, it, vi } from 'vitest';
import {
  isCondaAvailable,
  installPythonConsumerDependency,
  installTypeScriptConsumerDependencies,
} from '../../src/build/consumer-setup.mjs';

describe('consumer template dependency setup', () => {
  it('detects whether Conda can start from the workspace root', () => {
    const runResult = vi.fn(() => ({ status: 0, stdout: 'conda 25', stderr: '' }));

    expect(isCondaAvailable({ root: '/work/project', runResult })).toBe(true);
    expect(runResult).toHaveBeenCalledWith(
      'conda',
      ['--version'],
      { capture: true, cwd: '/work/project' },
    );
  });

  it('reports Conda as unavailable when the executable cannot start', () => {
    expect(isCondaAvailable({
      root: '/work/project',
      runResult: () => ({ status: null, error: new Error('spawnSync conda ENOENT') }),
    })).toBe(false);
  });

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

  it('installs the Python consumer with the selected interpreter', () => {
    const run = vi.fn();
    const runResult = vi.fn((command, args) => ({
      status: command === 'python3' || args[0] === '--version' ? (
        command === 'python3' ? 0 : 1
      ) : 0,
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
      [
        'python3',
        ['-m', 'pip', 'install', 'scrollcase-consumer'],
        { capture: true, cwd: '/work/project' },
      ],
    ]);
    expect(run).not.toHaveBeenCalled();
  });

  it('falls back to a user install for a PEP 668 managed interpreter', () => {
    const run = vi.fn();
    const runResult = vi.fn((_command, args) => (
      args[0] === '--version'
        ? { status: 0, stdout: '', stderr: '' }
        : {
            status: 1,
            stdout: '',
            stderr: 'error: externally-managed-environment',
          }
    ));

    const installed = installPythonConsumerDependency({
      root: '/work/project',
      source: 'pypi',
      run,
      runResult,
    });

    expect(installed).toEqual({ source: 'pypi', command: 'python' });
    expect(run).toHaveBeenCalledWith(
      'python',
      [
        '-m',
        'pip',
        'install',
        '--user',
        '--break-system-packages',
        'scrollcase-consumer',
      ],
      { cwd: '/work/project' },
    );
  });

  it('installs the Python consumer with conda in the active environment', () => {
    const run = vi.fn();
    const runResult = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }));

    const installed = installPythonConsumerDependency({
      root: '/work/project',
      source: 'conda-forge',
      run,
      runResult,
    });

    expect(installed).toEqual({ source: 'conda-forge', command: 'python' });
    expect(runResult).toHaveBeenCalledWith(
      'conda',
      ['--version'],
      { capture: true, cwd: '/work/project' },
    );
    expect(run).toHaveBeenCalledWith(
      'conda',
      ['install', '--yes', '--channel', 'conda-forge', 'scrollcase-consumer'],
      { cwd: '/work/project' },
    );
  });

  it('reports a clear error if Conda disappears after source selection', () => {
    expect(() => installPythonConsumerDependency({
      root: '/work/project',
      source: 'conda-forge',
      runResult: () => ({
        status: null,
        error: new Error('spawnSync conda ENOENT'),
      }),
    })).toThrow('Conda is not installed. Re-run scrollcase init and choose PyPI with pip.');
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
