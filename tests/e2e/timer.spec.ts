import { expect, type Page, test } from '@playwright/test';
import {
  HUD_MAX_DOM_NODES,
  MS_PER_S,
  RESUME_COUNTDOWN_MS,
  STEP_MS,
} from '../../src/shared/constants.ts';
import {
  canvasPoint,
  collectProblems,
  html,
  LEVEL_DURATION_MS,
  OVERRUN_MARGIN_MS,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The level timer (story 1.18): the HUD's `hud-timer` counts the sim time left, rounded up to the
// second, and the level ends at `durationMs`. Driven by the test API on a frozen level: steps by
// hand, nothing waits on a fixed delay. Chromium and WebKit both run it.

const LEVEL = 'salon_crawler';
const SEED = 42;
const TIMER = '[data-pp-zone="timer"] .pp-hud-timer';
const STEPS_PER_S = MS_PER_S / STEP_MS;
/** One `advance` call at most this long: a whole level in one call would block the page for long. */
const CHUNK_STEPS = 3000;

/** The clock as the level's duration makes it: `m:ss`, from whole seconds. */
const clock = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const START_CLOCK = clock(Math.ceil(LEVEL_DURATION_MS / MS_PER_S));

async function openFrozen(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

async function advanceTo(page: Page, simMs: number): Promise<void> {
  let remaining = Math.ceil((simMs - (await ppWorld(page)).time.sim) / STEP_MS);
  while (remaining > 0) {
    const chunk = Math.min(CHUNK_STEPS, remaining);
    await ppAdvance(page, chunk);
    remaining -= chunk;
  }
}

test.describe('the level timer', () => {
  test('reads the level’s duration at the start, with the Sieste name in its label', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(page.locator(TIMER)).toHaveText(START_CLOCK);
    await expect(page.locator(TIMER)).toHaveAttribute('role', 'timer');
    await expect(page.locator(TIMER)).toHaveAttribute(
      'aria-label',
      `${STRINGS['hud.timer_variant_nap']}, ${START_CLOCK}`,
    );
    expect(problems).toEqual([]);
  });

  test('counts down by whole seconds, rounded up: it changes once a second, not at every step', async ({
    page,
  }) => {
    await openFrozen(page);
    const startSeconds = Math.ceil(LEVEL_DURATION_MS / MS_PER_S);
    // One step into the level the second is not over yet: still the full time.
    await ppAdvance(page, 1);
    await expect(page.locator(TIMER)).toHaveText(START_CLOCK);
    // A whole second later, one second less; and one more.
    await ppAdvance(page, STEPS_PER_S - 1);
    await expect(page.locator(TIMER)).toHaveText(clock(startSeconds - 1));
    await ppAdvance(page, STEPS_PER_S);
    await expect(page.locator(TIMER)).toHaveText(clock(startSeconds - 2));
    await expect(page.locator(TIMER)).toHaveAttribute(
      'aria-label',
      `${STRINGS['hud.timer_variant_nap']}, ${clock(startSeconds - 2)}`,
    );
  });

  test('sits in the timer zone and stays within the HUD node budget', async ({ page }) => {
    await openFrozen(page);
    await expect(page.locator(`[data-pp-zone="timer"] > .pp-hud-timer`)).toHaveCount(1);
    const nodes = await page.evaluate(() => document.querySelectorAll('#pp-hud *').length);
    expect(nodes).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
    const box = await page.locator(TIMER).boundingBox();
    const viewport = page.viewportSize();
    if (box === null || viewport === null) throw new Error('no box');
    expect(box.x + box.width / 2).toBeCloseTo(viewport.width / 2, 0);
  });

  test('stays on screen during a slow-mo and counts the sim’s seconds, not the real ones', async ({
    page,
  }) => {
    await openFrozen(page);
    const startSeconds = Math.ceil(LEVEL_DURATION_MS / MS_PER_S);
    await ppSend(page, { type: 'SetTimeScale', t: (await ppWorld(page)).time.sim, scale: 0.2 });
    await ppAdvance(page, STEPS_PER_S);
    expect((await ppWorld(page)).time.scale).toBe(0.2);
    await expect(page.locator(TIMER)).toBeVisible();
    // A step is 10 sim ms whatever the scale: a second of steps is a second on the timer.
    await expect(page.locator(TIMER)).toHaveText(clock(startSeconds - 1));
  });

  test('ends the level at the duration: 0:00, one LevelEnded, the flow mirrored, and no input reaches the sim', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
    // Past the resume countdown, so that a tap is live; the control tap proves it plans a path.
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    const point = await canvasPoint(page, 0.5, 0.35);
    await page.touchscreen.tap(point.x, point.y);
    await ppAdvance(page, 1);
    expect(
      (await ppEvents(page)).filter((event) => event.type === 'PapaPathPlanned'),
    ).not.toHaveLength(0);
    await advanceTo(page, LEVEL_DURATION_MS - STEP_MS);
    await expect(page.locator(TIMER)).toHaveText('0:01');
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
    await ppAdvance(page, 1);

    await expect(page.locator(TIMER)).toHaveText('0:00');
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'ended');
    const ended = (await ppEvents(page)).filter((event) => event.type === 'LevelEnded');
    expect(ended).toEqual([{ type: 'LevelEnded', t: LEVEL_DURATION_MS, reason: 'timer' }]);

    // A tap on the floor after the end sends nothing: Papa plans no path, whatever the steps.
    const plannedBefore = (await ppEvents(page)).filter(
      (event) => event.type === 'PapaPathPlanned',
    ).length;
    await page.touchscreen.tap(point.x, point.y);
    await ppAdvance(page, 2 * STEPS_PER_S);
    const after = await ppEvents(page);
    expect(after.filter((event) => event.type === 'PapaPathPlanned')).toHaveLength(plannedBefore);
    expect(after.filter((event) => event.type === 'LevelEnded')).toHaveLength(1);
    // The frozen level stays on screen with the timer at 0:00.
    await expect(page.locator(TIMER)).toHaveText('0:00');
    await expect(page.locator(TIMER)).toBeVisible();
    expect(problems).toEqual([]);
  });
});
