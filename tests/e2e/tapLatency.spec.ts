import { expect, test } from '@playwright/test';
import {
  collectProblems,
  FIRST_TELEGRAPH_MAX_MS,
  OVERRUN_MARGIN_MS,
  startLevel,
  threatIconPoint,
  waitForThreat,
} from './support/game.ts';

// NFR2: a tap on a threat is on screen within 50 ms. The app marks `press` in the pointer handler
// and `highlightRendered` in the first frame whose world UI shows the highlight (debug builds
// only); the gap between the two marks is what a player waits for. One attempt: a retry loop would
// hide a slow frame.

const BUDGET_MS = 50;

test('a tap on a telegraphed threat draws its highlight within 50 ms', async ({ page }) => {
  const problems = collectProblems(page);
  await startLevel(page);
  await waitForThreat(page, 'telegraph', FIRST_TELEGRAPH_MAX_MS + OVERRUN_MARGIN_MS);
  const icon = await threatIconPoint(page);
  await page.touchscreen.tap(icon.x, icon.y);
  await page.waitForFunction(
    () =>
      performance.getEntriesByName('press').length > 0 &&
      performance.getEntriesByName('highlightRendered').length > 0,
    undefined,
    { polling: 'raf', timeout: OVERRUN_MARGIN_MS },
  );
  const marks = await page.evaluate(() => ({
    press: performance.getEntriesByName('press').map((entry) => entry.startTime),
    highlight: performance.getEntriesByName('highlightRendered').map((entry) => entry.startTime),
  }));
  // Each mark clears its previous one: one entry each, no growing buffer.
  expect(marks.press).toHaveLength(1);
  expect(marks.highlight).toHaveLength(1);
  const latencyMs = (marks.highlight[0] as number) - (marks.press[0] as number);
  expect(latencyMs).toBeGreaterThanOrEqual(0);
  expect(latencyMs).toBeLessThanOrEqual(BUDGET_MS);
  expect(problems).toEqual([]);
});
