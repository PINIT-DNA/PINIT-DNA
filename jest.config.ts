import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/jest.env.setup.ts'],
  moduleNameMapper: {
    '^jspdf$': '<rootDir>/client/node_modules/jspdf/dist/jspdf.node.min.js',
  },
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],

  // Speed. ts-jest used to type-check every test file (and everything it imports) on its
  // own, which dominated the run: trivial suites took 15-20 s each. Transpile-only is
  // several times faster; type safety for tests is kept by `npm run typecheck:tests`
  // (tests/tsconfig.json), which checks them all in a single pass.
  transform: {
    '^.+\.tsx?$': ['ts-jest', { isolatedModules: true, diagnostics: false }],
  },

  // Half the cores. Every worker runs sharp / OpenCV-style image work that is itself
  // multi-threaded; with one worker per core the machine was oversubscribed and even
  // tiny suites took minutes (e.g. health.test: 17 s alone, 523 s in a full run).
  maxWorkers: '50%',

  // Upper bound so `npm test` works without a --testTimeout flag; the heavy image /
  // video suites legitimately run for minutes.
  testTimeout: 180_000,

  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/app.ts',
    '!src/lib/prisma.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
};

export default config;
