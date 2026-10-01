import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: [
      'src/__tests__/**/*.test.ts',
      'src/domains/**/__tests__/**/*.test.ts',
    ],
    // Legacy manual scripts that live under __tests__ but are NOT vitest suites.
    // They own their runner (own assert/runTest helpers) and end with
    // `process.exit(...)`, which kills the vitest worker and reports the whole
    // file as "suite failed to run". Run them directly with tsx instead:
    //   npx tsx src/__tests__/codexBridgeAdapter.test.ts
    exclude: ['**/node_modules/**', '**/dist/**', 'src/__tests__/codexBridgeAdapter.test.ts'],
    // Default 5s is below the real cost of the sqlite/git/spawn fixtures on this
    // Windows host; several suites legitimately need ~10s. Assertions still
    // fail fast — only the wall-clock ceiling is raised.
    testTimeout: 20000,
    hookTimeout: 60000,
    // Console output is NOT suppressed — all logs are visible to aid debugging.
  },
});
