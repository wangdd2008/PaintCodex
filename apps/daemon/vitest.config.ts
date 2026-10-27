import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The runtime tests spawn a stand-in `codex app-server` child process.
    // On a loaded Windows machine (parallel `pnpm -r test`) process startup can
    // take several seconds, so vitest's 5s default is too tight for them.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
