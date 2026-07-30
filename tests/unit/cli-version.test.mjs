import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const cli = fileURLToPath(new URL('../../src/cli.mjs', import.meta.url));
const packageJson = JSON.parse(readFileSync(
  new URL('../../package.json', import.meta.url),
  'utf8',
));

describe('CLI version', () => {
  it.each(['-v', '--version'])('prints the installed version with %s', (flag) => {
    const result = spawnSync(process.execPath, [cli, flag], {
      cwd: tmpdir(),
      encoding: 'utf8',
    });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe(`${packageJson.version}\n`);
    expect(result.stderr).toBe('');
  });
});
