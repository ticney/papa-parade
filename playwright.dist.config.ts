import { defineConfig, devices } from '@playwright/test';
import { e2eDistPort } from './tests/e2e/support/e2ePort.ts';

// The e2e of the BUILT playtest bundle (story 1.24): `npm run e2e:dist`. It serves the existing
// `dist/` (it never builds: `npm run build:playtest` comes first, and `dist:check` refuses a prod
// or missing `dist/`). With `PP_DIST_URL=https://…` there is no server and only `dist.spec.ts`
// runs: that is how a deployed build is checked.

const PORT = e2eDistPort();
const liveUrl = process.env.PP_DIST_URL;
const isLive = liveUrl !== undefined && liveUrl !== '';
const baseURL = isLive ? liveUrl : `http://127.0.0.1:${PORT}`;
const landscapePhone = { viewport: { width: 844, height: 390 }, hasTouch: true };

export default defineConfig({
  testDir: 'tests/e2e-dist',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL },
  projects: [
    {
      name: 'dist-chromium',
      testMatch: 'dist.spec.ts',
      use: { ...devices['Desktop Chrome'], ...landscapePhone },
    },
    {
      name: 'dist-webkit',
      testMatch: 'dist.spec.ts',
      use: { ...devices['Desktop Safari'], ...landscapePhone },
    },
    // Chromium only, and alone on the machine's Playwright (`tools/build/runDistE2e.ts` runs it in
    // its own invocation): a frame-time measure must not share the CPU with other specs.
    ...(isLive
      ? []
      : [
          {
            name: 'perf',
            testMatch: 'perf.spec.ts',
            use: { ...devices['Desktop Chrome'], ...landscapePhone },
          },
        ]),
  ],
  ...(isLive
    ? {}
    : {
        webServer: {
          command: `npx tsx tools/serve/serveDist.ts --port ${PORT}`,
          url: baseURL,
          reuseExistingServer: !process.env.CI,
        },
      }),
});
