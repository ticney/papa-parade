import { defineConfig, devices } from '@playwright/test';
import { calibratedStorageState } from './tests/e2e/support/calibratedSave.ts';
import { e2ePort } from './tests/e2e/support/e2ePort.ts';

const PORT = e2ePort();
const BASE_URL = `http://localhost:${PORT}`;
const landscapePhone = { viewport: { width: 844, height: 390 }, hasTouch: true };

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  // Screenshot references are per browser and made on the Mac (`darwin`); there are none for Linux,
  // so `autoplay.spec.ts` only compares the frame on macOS. The ratio is a guard against GPU
  // dithering, never a slack for real changes: a frame that needs more than 0.2 % is not
  // deterministic, and that is the bug.
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
  // Every spec plays as a returning player: a save that holds a calibration of 0 ms sends it straight
  // to the level (story 2.7). `calibration.spec.ts` starts from an empty storage instead.
  use: { baseURL: BASE_URL, storageState: calibratedStorageState(BASE_URL) },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], ...landscapePhone } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...landscapePhone } },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
  },
});
