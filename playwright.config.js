// Automated browser tests (Chromium). Run: npm test
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.mjs/,
  timeout: 180000,
  workers: 1, // one at a time: the timing tests (e.g. "no freezing") must not compete with the 4 GB test for CPU
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] },
    viewport: { width: 1400, height: 860 },
  },
  webServer: { command: 'node scripts/serve.mjs', port: 5173, reuseExistingServer: true },
});
