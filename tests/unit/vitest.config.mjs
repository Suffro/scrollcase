import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.mjs'],
    // fileURLToPath, not URL.pathname: the latter renders a Windows path as "/D:/…", which vitest
    // then resolves to a doubled drive letter and finds no test files at all.
    root: fileURLToPath(new URL('../..', import.meta.url)),
  },
});
