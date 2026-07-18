import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/tests',
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://127.0.0.1:42173', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm --filter @swarm-script/web dev --host 127.0.0.1 --port 42173',
    url: 'http://127.0.0.1:42173',
    reuseExistingServer: true,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
