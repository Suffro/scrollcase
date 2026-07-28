import { describe, expect, it } from 'vitest';
import { boxTargetAdapter } from '../../src/contract/targets.mjs';
import { assertExecutionFiles } from '../../src/build/execution.mjs';

describe('execution payload prerequisites', () => {
  it('requires a Python script to be a regular archive file at its exact safe path', () => {
    const adapter = boxTargetAdapter({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' });
    const execution = { kind: 'python-script', script: 'app/main.py', defaultArgs: [] };
    expect(() => assertExecutionFiles({
      execution,
      adapter,
      pythonVersion: '3.11.15',
      files: new Set(['app/main.py']),
    })).not.toThrow();
    expect(() => assertExecutionFiles({
      execution,
      adapter,
      pythonVersion: '3.11.15',
      files: new Set(),
    })).toThrow(/Execution script is missing/);
  });

  it('finds runnable modules in the POSIX and Windows environment layouts', () => {
    const moduleExecution = {
      kind: 'python-module',
      module: 'example_model.main',
      defaultArgs: ['--serve'],
    };
    const linux = boxTargetAdapter({ platform: 'linux', arch: 'x86_64', accelerator: 'cpu' });
    expect(() => assertExecutionFiles({
      execution: moduleExecution,
      adapter: linux,
      pythonVersion: '3.11.15',
      files: new Set(['venv/lib/python3.11/site-packages/example_model/main.py']),
    })).not.toThrow();

    const windows = boxTargetAdapter({ platform: 'windows', arch: 'x86_64', accelerator: 'cpu' });
    expect(() => assertExecutionFiles({
      execution: moduleExecution,
      adapter: windows,
      pythonVersion: '3.11.15',
      files: new Set(['venv/Lib/site-packages/example_model/main.py']),
    })).not.toThrow();

    expect(() => assertExecutionFiles({
      execution: { ...moduleExecution, module: 'json.tool' },
      adapter: linux,
      pythonVersion: '3.11.15',
      files: new Set(['venv/lib/python3.11/json/tool.py']),
    })).not.toThrow();
  });

  it('rejects a module absent from both the box root and its environment', () => {
    const adapter = boxTargetAdapter({ platform: 'macos', arch: 'aarch64', accelerator: 'metal' });
    expect(() => assertExecutionFiles({
      execution: { kind: 'python-module', module: 'missing.main', defaultArgs: [] },
      adapter,
      pythonVersion: '3.12.4',
      files: new Set(['venv/bin/python']),
    })).toThrow(/Execution module is not discoverable/);
  });
});
