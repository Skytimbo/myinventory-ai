import { defineConfig, devices } from '@playwright/test';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: process.env.CI ? 'http://localhost:5000' : 'http://localhost:5173',
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // CI uses single-server mode (traditional), local uses dual-server mode
  webServer: process.env.CI
    ? {
        command: 'pnpm dev',
        url: 'http://localhost:5000',
        reuseExistingServer: false,
        timeout: 120000,
      }
    : [
        {
          command: 'pnpm dev:api',
          url: 'http://localhost:5000',
          reuseExistingServer: true,
          timeout: 120000,
        },
        {
          command: 'pnpm dev:ui',
          url: 'http://localhost:5173',
          reuseExistingServer: true,
          timeout: 120000,
        },
      ],
});
