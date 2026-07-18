import { defineConfig, devices } from '@playwright/test';

const externalBaseURL = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './apps/web/tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: externalBaseURL ?? 'http://127.0.0.1:42173', trace: 'retain-on-failure' },
  webServer: externalBaseURL
    ? undefined
    : {
        command: 'pnpm --filter @swarm-script/web dev --host 127.0.0.1 --port 42173',
        url: 'http://127.0.0.1:42173',
        reuseExistingServer: true,
      },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
