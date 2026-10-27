import { defineConfig } from '@playwright/test';

// Runs against a stack that is already up: `docker compose up -d --build` from the project root.
// Locally it drives the Chrome you already have installed; in CI it uses Playwright's own Chromium.
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  // One test at a time: the tests share one stack (and its login rate limits), and each file makes its own organisation.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: process.env.E2E_WEB_URL ?? 'http://localhost:4311',
    channel: process.env.CI ? undefined : 'chrome',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
