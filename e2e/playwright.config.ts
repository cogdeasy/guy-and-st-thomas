import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const BASE_URL = process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * E2E config. By default it boots the API and the built web preview, then runs
 * the suite against them. Set E2E_BASE_URL to run against an already-running
 * stack (and E2E_NO_SERVER=1 to skip launching servers).
 */
export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : [
        {
          command: 'pnpm --filter @trustos/api start',
          port: 4000,
          reuseExistingServer: true,
          timeout: 60_000,
        },
        {
          command: 'pnpm --filter @trustos/web preview',
          port: PORT,
          reuseExistingServer: true,
          timeout: 60_000,
        },
      ],
});
