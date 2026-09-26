/** @type {import('ts-jest').JestConfigWithTsJest} */
/**
 * ⚠️ DEPRECATED — DO NOT USE for this package.
 *
 * This server's suites are vitest suites (173 of 288 files import from
 * 'vitest'). Running them under ts-jest fails every one of those files with
 * "TypeError: Cannot redefine property: Symbol($$jest-matchers-object)" because
 * jest cannot provide vitest's `expect`, so the run reports ~276 red suites
 * that are pure runner artifacts (vitest runs the same files green).
 *
 * Canonical commands (from D:/AgenticOS/server):
 *   npm test          -> vitest run
 *   npx vitest run <path>
 *
 * This config is kept only for history; it is not wired to any npm script.
 */
module.exports = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^shared/(.*)$': '<rootDir>/../shared/$1',
  },
  transformIgnorePatterns: [
    '<rootDir>/node_modules/(?!(drizzle-orm|better-sqlite3)/)',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        tsconfig: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          target: 'ES2022',
          isolatedModules: true,
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
        },
      },
    ],
  },
  setupFilesAfterEnv: [],
};
