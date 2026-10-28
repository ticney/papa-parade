import { expect, test } from '@playwright/test';
import { collectProblems, html, startLevel, THREATS_OFF, waitFrames } from './support/game.ts';
import { ppPerf } from './support/testApi.ts';

// The debug FPS counter and `__PP__.perf()` (story 1.24). Only the shapes are asserted here: the
// one timing assertion of the project is `tests/e2e-dist/perf.spec.ts`, on the built bundle.

const COUNTER = '.pp-debug-perf';
const COUNTER_TEXT = /^\d+ FPS · \d+\.\d ms · p95 \d+\.\d ms · DPR \d+(\.\d+)?$/;

test.describe('the FPS counter', () => {
  test('is not there without ?debug=1', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page, THREATS_OFF);
    await waitFrames(page, 30);
    await expect(page.locator(COUNTER)).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('shows FPS, ms, p95 and DPR in a level started with ?debug=1, and never takes a tap', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page, `${THREATS_OFF.replace('?', '?debug=1&')}`);
    const counter = page.locator(COUNTER);
    await expect(counter).toBeVisible();
    await expect(counter).toHaveAttribute('aria-hidden', 'true');
    // It writes after the first frame, then once a whole second has passed it has real numbers.
    await expect(counter).toHaveText(COUNTER_TEXT);
    await expect(counter).toHaveText(/^[1-9]\d* FPS/, { timeout: 5000 });
    expect(await counter.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe('none');
    expect(await counter.evaluate((node) => node.parentElement?.tagName)).toBe('BODY');
    expect(problems).toEqual([]);
  });

  test('mirrors the pixel ratio in force', async ({ page }) => {
    await startLevel(page, THREATS_OFF);
    const ratio = Number(await html(page).getAttribute('data-pp-pixel-ratio'));
    expect(ratio).toBeGreaterThanOrEqual(1);
    expect(ratio).toBeLessThanOrEqual(2);
  });
});

test.describe('__PP__.perf()', () => {
  test('measures the frames of the level that runs', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page, THREATS_OFF);
    await waitFrames(page, 20);
    const report = await ppPerf(page);
    expect(report.frames).toBeGreaterThan(0);
    expect(report.frameMsP95).toBeGreaterThan(0);
    expect(report.drawCallsMax).toBeGreaterThan(0);
    expect(report.trianglesMax).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});
