import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'server/src/__tests__/hermesExecutionMode.test.ts',
      'server/src/__tests__/hermesOperationalLoop.test.ts',
      'server/src/__tests__/hermesWorkerLiveness.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
