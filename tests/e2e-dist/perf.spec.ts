import { expect, test } from '@playwright/test';
import {
  DRAW_CALLS_MAX,
  FRAME_P95_MAX_MS,
  PERF_MIN_FPS_SAMPLED,
  RESUME_COUNTDOWN_MS,
  TRIANGLES_MAX,
} from '../../src/shared/constants.ts';
import {
  collectProblems,
  html,
  LEVEL_DURATION_MS,
  LEVEL_REAL_TIME_FACTOR_MAX,
  OVERRUN_MARGIN_MS,
} from '../e2e/support/game.ts';
import { ppPerf } from '../e2e/support/testApi.ts';

// NFR1 on the machine that runs this (story 1.24): the `human` bot plays a whole level of the BUILT
// playtest bundle in real time, and the frame budget is read from `__PP__.perf()`. Speed stays 1:
// speed changes the steps per frame, so only real time gives honest frame intervals. A real phone
// is measured by hand (docs/playtest/device-measurements.md); this is the CI proxy and the guard
// against a regression. A budget is never loosened to pass: if it fails, say so with the numbers.

const LOAD_MARGIN_MS = 30_000;

test.describe.configure({ mode: 'serial' });

test('a full level at speed 1 holds the frame, draw-call and triangle budgets', async ({
  page,
}, testInfo) => {
  // Real time: the level's duration is sim time, and the parries' slow-motion stretches it.
  const levelMs =
    LEVEL_DURATION_MS * LEVEL_REAL_TIME_FACTOR_MAX +
    RESUME_COUNTDOWN_MS +
    OVERRUN_MARGIN_MS +
    LOAD_MARGIN_MS;
  test.setTimeout(levelMs + 30_000);
  const problems = collectProblems(page);

  await page.goto('/?autoplay=human&seed=1&speed=1&debug=1');
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result', { timeout: levelMs });

  const report = await ppPerf(page);
  await testInfo.attach('perf.json', {
    body: JSON.stringify(report, null, 2),
    contentType: 'application/json',
  });
  process.stdout.write(
    `perf: ${report.frames} frames, p95 ${report.frameMsP95} ms (mean ${report.frameMsMean.toFixed(2)}, max ${report.frameMsMax.toFixed(1)}), ` +
      `draw calls max ${report.drawCallsMax}, triangles max ${report.trianglesMax}\n`,
  );

  // The measure really ran: a level's worth of frames, not a handful.
  expect(report.frames).toBeGreaterThanOrEqual((LEVEL_DURATION_MS / 1000) * PERF_MIN_FPS_SAMPLED);
  expect(report.frameMsP95).toBeLessThanOrEqual(FRAME_P95_MAX_MS);
  expect(report.drawCallsMax).toBeLessThanOrEqual(DRAW_CALLS_MAX);
  expect(report.trianglesMax).toBeLessThanOrEqual(TRIANGLES_MAX);
  expect(problems).toEqual([]);
});
