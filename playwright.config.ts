import { defineConfig, devices } from '@playwright/test';
import { e2ePort } from './tests/e2e/support/e2ePort.ts';

const PORT = e2ePort();
const landscapePhone = { viewport: { width: 844, height: 390 }, hasTouch: true };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  // Screenshot references are per browser and per OS: `darwin` made on the Mac, `linux` made in
  // Docker for CI. The ratio is a guard against GPU dithering, never a slack for real changes: a
  // frame that needs more than 0.2 % is not deterministic, and that is the bug.
  snapshotPathTemplate:
    '{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}',
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.002,
    },
  },
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
