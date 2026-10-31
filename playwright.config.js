// Automated browser tests (Chromium). Run: npm test
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.mjs/,
  timeout: 180000,
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    viewport: { width: 1400, height: 860 },
  },
  webServer: { command: 'node scripts/serve.mjs', port: 5173, reuseExistingServer: true },
});
