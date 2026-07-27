import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.mjs'],
    // fileURLToPath, not URL.pathname: the latter renders a Windows path as "/D:/…", which vitest
    // then resolves to a doubled drive letter and finds no test files at all.
    root: fileURLToPath(new URL('../..', import.meta.url)),
    // Several tests shell out to a real toolchain — tsc over the public entry points, the two type
    // generators in --check mode. Those take seconds on Linux and considerably longer on a Windows
    // runner, where process spawn and file stats are slower; the 5s default failed CI there while
    // the same tests passed everywhere else. The timeout is a guard against a hang, not a
    // performance budget, so it is set well clear of the slowest honest run.
    testTimeout: 120_000,
  },
});
