import { defineConfig, devices } from '@playwright/test';

const PORT = 5179;
const landscapePhone = { viewport: { width: 844, height: 390 }, hasTouch: true };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...landscapePhone } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...landscapePhone } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
});
