import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  setupFiles: ['<rootDir>/tests/jest.env.setup.ts'],
  transformIgnorePatterns: ['/node_modules/(?!@noble/)'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/app.ts',
    '!src/lib/prisma.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
};

export default config;
