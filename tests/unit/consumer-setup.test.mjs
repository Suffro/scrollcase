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

  it('creates a project-local virtual environment before installing with pip', () => {
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
      exists: () => false,
    });

    expect(installed).toEqual({
      source: 'pypi',
      command: '/work/project/.venv/bin/python',
      environmentDir: '/work/project/.venv',
    });
    expect(runResult.mock.calls).toEqual([
      ['python', ['--version'], { capture: true, cwd: '/work/project' }],
      ['python3', ['--version'], { capture: true, cwd: '/work/project' }],
    ]);
    expect(run.mock.calls).toEqual([
      ['python3', ['-m', 'venv', '.venv'], { cwd: '/work/project' }],
      [
        '/work/project/.venv/bin/python',
        ['-m', 'pip', 'install', 'scrollcase-consumer'],
        { cwd: '/work/project' },
      ],
    ]);
  });

  it('creates a project-local conda environment from conda-forge', () => {
    const run = vi.fn();
    const runResult = vi.fn();

    const installed = installPythonConsumerDependency({
      root: '/work/project',
      source: 'conda-forge',
      run,
      runResult,
      exists: () => false,
    });

    expect(installed).toEqual({
      source: 'conda-forge',
      command: '/work/project/.venv/bin/python',
      environmentDir: '/work/project/.venv',
    });
    expect(runResult).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      'conda',
      [
        'create',
        '--yes',
        '--prefix',
        '/work/project/.venv',
        '--channel',
        'conda-forge',
        'scrollcase-consumer',
      ],
      { cwd: '/work/project' },
    );
  });

  it('uses the Windows interpreter layout for a project-local environment', () => {
    const run = vi.fn();
    const runResult = vi.fn(() => ({ status: 0, stdout: '', stderr: '' }));

    const installed = installPythonConsumerDependency({
      root: 'D:\\work\\project',
      source: 'pypi',
      platform: 'win32',
      run,
      runResult,
      exists: () => false,
    });

    expect(installed.command).toBe('D:\\work\\project\\.venv\\Scripts\\python.exe');
    expect(run.mock.calls.at(-1)).toEqual([
      'D:\\work\\project\\.venv\\Scripts\\python.exe',
      ['-m', 'pip', 'install', 'scrollcase-consumer'],
      { cwd: 'D:\\work\\project' },
    ]);
  });

  it('uses the conda prefix interpreter layout on Windows', () => {
    const run = vi.fn();

    const installed = installPythonConsumerDependency({
      root: 'D:\\work\\project',
      source: 'conda-forge',
      platform: 'win32',
      run,
      exists: () => false,
    });

    expect(installed.command).toBe('D:\\work\\project\\.venv\\python.exe');
  });

  it('reuses an existing conda environment when pip is selected later', () => {
    const run = vi.fn();
    const runResult = vi.fn();

    const installed = installPythonConsumerDependency({
      root: 'D:\\work\\project',
      source: 'pypi',
      platform: 'win32',
      run,
      runResult,
      exists: (path) => (
        path.endsWith('\\conda-meta') || path.endsWith('\\.venv\\python.exe')
      ),
    });

    expect(installed.command).toBe('D:\\work\\project\\.venv\\python.exe');
    expect(runResult).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledWith(
      'D:\\work\\project\\.venv\\python.exe',
      ['-m', 'pip', 'install', 'scrollcase-consumer'],
      { cwd: 'D:\\work\\project' },
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
