import { describe, expect, it } from 'vitest';
import { parseArgs } from '../../src/cli-args.mjs';

describe('CLI argument parsing', () => {
  it('preserves every application argument after the separator exactly', () => {
    expect(parseArgs([
      'release.json',
      '--archive', 'box with spaces.zip',
      '--',
      '--flag',
      'value with spaces',
      '"quoted"',
      '$(touch never)',
      'semi;colon',
    ])).toEqual({
      positional: ['release.json'],
      flags: new Map([['archive', 'box with spaces.zip']]),
      passthrough: [
        '--flag',
        'value with spaces',
        '"quoted"',
        '$(touch never)',
        'semi;colon',
      ],
    });
  });

  it('keeps the existing inline, separated, and bare flag forms before the separator', () => {
    expect(parseArgs(['item', '--one=1', '--two', '2', '--bare'])).toEqual({
      positional: ['item'],
      flags: new Map([
        ['one', '1'],
        ['two', '2'],
        ['bare', true],
      ]),
      passthrough: [],
    });
  });
});
