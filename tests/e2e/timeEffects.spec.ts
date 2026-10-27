import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { PARRY_RELEASE_AFTER_MS } from '../support/timeEffects.ts';
import { collectProblems, FIRST_TELEGRAPH_MS, OVERRUN_MARGIN_MS } from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// A perfect response goes into slow-mo (story 1.14), driven by the test API: the level is frozen,
// every step is advanced by hand, the sim times are read from the world and the slow-mo numbers from
// `content/feel.json` (the build under test serves that file unchanged). The hitstop is a real-time freeze that `advance` ignores, so the loop test covers it, not this one.

const LEVEL = 'salon_crawler';
const SEED = 42;

const { timing } = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  timing: { slowMoPerfect: { timeScale: number; durationMs: number; returnMs: number } };
};
const { slowMoPerfect } = timing;

/** Steps per poll while waiting for the telegraph: it lands before the window, which is much longer. */
const TELEGRAPH_POLL_STEPS = 5;

const stepsTo = (fromMs: number, toMs: number): number => Math.ceil((toMs - fromMs) / STEP_MS);

test.describe('slow-mo on a perfect response', () => {
  test('starts at the judgement, holds, and gives the scale back to its base', async ({ page }) => {
    const problems = collectProblems(page);
    await page.goto('/');
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);

    // Up to the first telegraph of the live plan (a few steps more if the baby is busy), then to
    // the opening of its window.
    await ppAdvance(page, stepsTo(0, FIRST_TELEGRAPH_MS));
    await expect
      .poll(
        async () => {
          await ppAdvance(page, TELEGRAPH_POLL_STEPS);
          return (await ppWorld(page)).threats[0]?.state;
        },
        { timeout: OVERRUN_MARGIN_MS },
      )
      .toBe('telegraph');
    const telegraphed = await ppWorld(page);
    const outlet = telegraphed.threats[0];
    if (outlet === undefined || outlet.responseWindow === null) throw new Error('no window');
    await ppAdvance(page, stepsTo(telegraphed.time.sim, outlet.windowOpenAt));
    expect((await ppWorld(page)).threats[0]?.state).toBe('windowOpen');

    // A perfect Parry: the press at the centre of the window, the release shortly after.
    const centerMs = outlet.windowOpenAt + outlet.responseWindow.windowMs / 2;
    const resolvedAt = centerMs + PARRY_RELEASE_AFTER_MS;
    await ppSend(page, { type: 'PressThreat', t: centerMs as never, threatId: outlet.id });
    await ppSend(page, { type: 'Release', t: resolvedAt as never });
    const beforeResolve = await ppWorld(page);
    expect(beforeResolve.time.scale).toBe(1);
    await ppAdvance(page, stepsTo(beforeResolve.time.sim, resolvedAt) + 2);

    const slowed = await ppWorld(page);
    expect(slowed.time.scale).toBe(slowMoPerfect.timeScale);
    expect(slowed.time.slowMos).toHaveLength(1);
    // `ResponseResolved{perfect}` is followed by the `TimeScaleChanged` that enters the slow-mo.
    const events = await ppEvents(page);
    const resolved = events.findIndex((event) => event.type === 'ResponseResolved');
    expect(resolved).toBeGreaterThanOrEqual(0);
    expect(events[resolved]).toMatchObject({ quality: 'perfect' });
    expect(events[resolved + 1]).toMatchObject({
      type: 'TimeScaleChanged',
      from: 1,
      to: slowMoPerfect.timeScale,
    });

    // Past the hold and the return: the base scale is back and the slow-mo is gone.
    await ppAdvance(
      page,
      stepsTo(slowed.time.sim, resolvedAt + slowMoPerfect.durationMs + slowMoPerfect.returnMs) + 2,
    );
    const after = await ppWorld(page);
    expect(after.time.scale).toBe(1);
    expect(after.time.slowMos).toEqual([]);
    expect(problems).toEqual([]);
  });
});
