import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    // Builds/updates the separate helpdesk_test database with the real migrations before any test runs.
    globalSetup: ['./test/global-setup.mjs'],
    // Points every test worker at that test database (never the dev database).
    setupFiles: ['./test/setup-env.ts'],
    // One file at a time: they share Postgres, Redis and Kafka, and the events tests run the real relay and
    // consumers, which (correctly) process any organisation's events, including another test file's.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
