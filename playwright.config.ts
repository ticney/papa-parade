import { defineConfig, devices } from '@playwright/test';
import { calibratedStorageState } from './tests/e2e/support/calibratedSave.ts';
import { e2ePort } from './tests/e2e/support/e2ePort.ts';
import { SMOKE_SPECS } from './tests/e2e/support/smokeSpecs.ts';

const PORT = e2ePort();
const BASE_URL = `http://localhost:${PORT}`;
const landscapePhone = { viewport: { width: 844, height: 390 }, hasTouch: true };

/**
 * Four browsers at once by default. Playwright's own default, half the cores (7 on Geo's Mac), each
 * drawing a WebGL level beside the dev server, loaded the machine until specs timed out (Geo,
 * 2026-11-08). `PP_E2E_WORKERS=<n>`, or `--workers=<n>` on the command line, changes it.
 */
const DEFAULT_E2E_WORKERS = 4;

function e2eWorkers(raw: string | undefined): number {
  if (raw === undefined || raw === '') return DEFAULT_E2E_WORKERS;
  const workers = Number(raw);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`PP_E2E_WORKERS must be a whole number of at least 1, not « ${raw} »`);
  }
  return workers;
}

/**
 * `PP_E2E_TIER=smoke` (`npm run e2e:smoke`, so `npm run ci:story`) plays the specs of
 * `SMOKE_SPECS` only; with no tier (`all`), every spec of `tests/e2e` (`npm run e2e`, `npm run ci`).
 */
function e2eTier(raw: string | undefined): 'all' | 'smoke' {
  if (raw === undefined || raw === '' || raw === 'all') return 'all';
  if (raw === 'smoke') return 'smoke';
  throw new Error(`PP_E2E_TIER must be « smoke » or « all », not « ${raw} »`);
}

const TIER = e2eTier(process.env.PP_E2E_TIER);

export default defineConfig({
  testDir: 'tests/e2e',
  ...(TIER === 'smoke' ? { testMatch: SMOKE_SPECS.map((file) => `**/${file}`) } : {}),
  fullyParallel: true,
  workers: e2eWorkers(process.env.PP_E2E_WORKERS),
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
