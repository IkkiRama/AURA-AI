import { defineConfig } from '@playwright/test';

const baseURL = 'http://localhost:1420';

export default defineConfig({
  testDir: './tests/e2e',
  workers: 1,
  use: {
    baseURL,
    channel: process.env.AURA_E2E_CHANNEL,
    trace: 'retain-on-failure',
  },
  webServer: process.env.AURA_E2E_DIST === '1' ? undefined : {
    command: `"${process.execPath}" node_modules/vite/bin/vite.js`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
