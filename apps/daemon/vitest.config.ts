import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The Codex runtime tests spawn a real child process per test. Under a
    // parallel workspace run (daemon + web + typecheck) their process startup
    // alone can approach Vitest's 5s default, so the budget is generous.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
