import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeel,
  recordVibrations,
  startLevel,
  threatIconPoint,
  vibrations,
  WALK_BOUND_MS,
  waitFrames,
} from './support/game.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppSetFeel,
  ppWorld,
} from './support/testApi.ts';

// The activity bubble above a busy Papa and the refused tap (story 2.12) on the live level: a frozen level
// driven by the test API (`TapObject`, `ForceThreat`, `ppAdvance`) for the ring, the end and the refusal, and a
// real pause on a running level. Every bound comes from the live feel and the world's own `enteredAt` /
// `busyUntil`, never from a literal. `ppAdvance` runs steps without a frame: a frame is awaited (`waitFrames`)
// before the DOM is read, and the drawn time trails the sim by one step in a frozen frame, as in story 2.11.

const LEVEL = 'salon_crawler';
const SEED = 42;
const OUTLET = 'outlet';
const COFFEE_MS = (liveFeel as unknown as { fatigue: { coffeeDurationMs: number } }).fatigue
  .coffeeDurationMs;
const BUBBLE = '.pp-activity-bubble';
const BODY = '.pp-activity-body';
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

/** How much of the ring is paper, in whole percent: the custom property the bubble writes. */
const progressOf = (page: Page): Promise<number> =>
  page
    .locator(BUBBLE)
    .evaluate((bubble) =>
      Number((bubble as HTMLElement).style.getPropertyValue('--pp-activity-progress')),
    );

/** Starts the game for real (audio unlocked), then freezes it on a fresh level. */
async function openFrozen(page: Page): Promise<void> {
  await recordVibrations(page);
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** Taps the coffee machine and steps, one step at a time, until Papa drinks. */
async function startCoffee(page: Page) {
  await ppSend(page, { type: 'TapObject', objectId: 'coffee_machine' });
  const stepsMax = Math.ceil(WALK_BOUND_MS / STEP_MS);
  for (let i = 0; i < stepsMax; i++) {
    await ppAdvance(page, 1);
    const { papa } = await ppWorld(page);
    if (papa.state === 'drink') return papa;
  }
  throw new Error('Papa never started the coffee');
}

/** The whole percent the ring shows when the world is at `simMs`: the drawn time trails the sim by one step. */
const expectedPct = (papa: { enteredAt: number; busyUntil: number }, simMs: number): number => {
  const drawnMs = simMs - STEP_MS;
  const permille = ((papa.busyUntil - drawnMs) / (papa.busyUntil - papa.enteredAt)) * 1000;
  return Math.floor(Math.min(1000, Math.max(0, permille)) / 10);
};

test.describe('the bubble during a coffee', () => {
  test('shows the cup, drains with the sim time to busyUntil, then pops out with a ding and a light vibration', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(page.locator(BUBBLE)).toBeHidden();

    const papa = await startCoffee(page);
    await waitFrames(page, 3);
    expect(papa.busyUntil - papa.enteredAt).toBe(COFFEE_MS);
    const bubble = page.locator(BUBBLE);
    await expect(bubble).toBeVisible();
    await expect(bubble).toHaveClass(/pp-activity-bubble--cup/);
    // Full at the first drawn frame: the drawn time trails the step that made him drink.
    expect(await progressOf(page)).toBe(100);

    // After n more steps the ring shows what the sim time says, a step behind, never more than a percent off.
    for (const steps of [10, 20, 30]) {
      await ppAdvance(page, steps);
      await waitFrames(page, 3);
      const world = await ppWorld(page);
      const n = (world.time.sim - papa.enteredAt) / STEP_MS;
      const fromFeel = Math.floor(
        Math.min(1, Math.max(0, 1 - (n * STEP_MS - STEP_MS) / COFFEE_MS)) * 100,
      );
      const shown = await progressOf(page);
      expect(Math.abs(shown - fromFeel), `after ${n} steps`).toBeLessThanOrEqual(1);
      expect(Math.abs(shown - expectedPct(world.papa, world.time.sim))).toBeLessThanOrEqual(1);
    }
    const midway = await progressOf(page);
    expect(midway).toBeLessThan(100);
    expect(midway).toBeGreaterThan(0);

    // Still busy: no ding yet.
    expect((await ppCueLog(page)).filter((r) => r.cueId === 'papa_free')).toHaveLength(0);

    // At busyUntil: Papa is free, the bubble pops and goes, the ding plays once, with its light vibration.
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    const world = await ppWorld(page);
    await ppAdvance(page, Math.ceil((papa.busyUntil - world.time.sim) / STEP_MS));
    expect((await ppWorld(page)).papa.state).not.toBe('drink');
    await waitFrames(page, 3);
    await expect(bubble).toBeHidden();
    const dings = (await ppCueLog(page)).filter((r) => r.cueId === 'papa_free');
    expect(dings).toHaveLength(1);
    expect(dings[0]?.haptic).toBe('light');
    expect(dings[0]?.visuals).toEqual(['uiElement']);
    if (hasVibrate()) {
      const pattern = hapticPatternOfCue('papa_free');
      expect((await vibrations(page)).slice(vibrationsBefore)).toContainEqual(pattern);
    }
    expect(problems).toEqual([]);
  });
});

test.describe('a refused tap', () => {
  test('on a threat while Papa drinks: TapRefused, the « occupé » cue, a shaking bubble, no tap marker, no press', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await startCoffee(page);

    // The outlet comes up during the coffee: its marker is a threat the player can tap, but Papa cannot answer.
    const outlet = (await ppWorld(page)).threats.find((threat) => threat.defId === OUTLET);
    if (outlet === undefined) throw new Error('the level does not plan the outlet');
    await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
    await ppAdvance(page, 1);
    await waitFrames(page, 3);
    await expect(page.locator(BUBBLE)).toBeVisible();
    const point = await threatIconPoint(page);
    const eventsBefore = (await ppEvents(page)).length;

    // A real pointer click on the marker. The sim decides at its next step.
    await page.mouse.click(point.x, point.y);
    // The shake class is put on at the very step that refuses, and it lasts 150 ms of real time:
    // read it in the same call as the step.
    const probe = await page.evaluate(() => {
      window.__PP__?.advance(1);
      return {
        isShaking:
          document
            .querySelector('.pp-activity-body')
            ?.classList.contains('pp-activity-body--refused') ?? false,
        tapMarkers: document.querySelectorAll('.pp-tap-marker').length,
      };
    });
    expect(probe.isShaking).toBe(true);
    expect(probe.tapMarkers).toBe(0);

    const refused = (await ppEvents(page, eventsBefore)).filter((e) => e.type === 'TapRefused');
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ type: 'TapRefused', threatId: outlet.id });
    const cues = (await ppCueLog(page)).filter((r) => r.cueId === 'papa_busy_refused');
    expect(cues).toHaveLength(1);
    expect(cues[0]?.haptic).toBe('light');
    expect(cues[0]?.visuals).toEqual(['uiElement']);

    const after = await ppWorld(page);
    expect(after.threats.find((threat) => threat.id === outlet.id)?.press).toBeNull();
    expect(after.papa.state).toBe('drink');
    await expect(page.locator('.pp-tap-marker:visible')).toHaveCount(0);

    // The shake is a short class: it is gone a frame after its 150 ms.
    await expect(page.locator(BODY)).not.toHaveClass(/pp-activity-body--refused/);
    expect(problems).toEqual([]);
  });

  test('on the floor while Papa drinks: nothing is sent and the bubble does not shake', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await startCoffee(page);
    await waitFrames(page, 2);
    const eventsBefore = (await ppEvents(page)).length;
    await page.mouse.click(300, 200);
    await ppAdvance(page, 2);
    const events = await ppEvents(page, eventsBefore);
    expect(events.filter((e) => e.type === 'TapRefused' || e.type === 'PapaPathPlanned')).toEqual(
      [],
    );
    await expect(page.locator(BODY)).not.toHaveClass(/pp-activity-body--refused/);
    expect(problems).toEqual([]);
  });
});

test.describe('the game stops the ring', () => {
  test('a real pause on a running level leaves the ring where it was', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    // A long coffee, so that the pause lands well inside it whatever the machine's speed.
    await ppSetFeel(page, { fatigue: { coffeeDurationMs: 10 * COFFEE_MS } });
    await ppSend(page, { type: 'TapObject', objectId: 'coffee_machine' });
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'drink', {
      timeout: WALK_BOUND_MS,
    });
    await expect(page.locator(BUBBLE)).toBeVisible();
    await page.locator('.pp-hud-pause').click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await waitFrames(page, 3);
    const paused = await progressOf(page);
    expect(paused).toBeLessThanOrEqual(100);
    await waitFrames(page, 20);
    expect(await progressOf(page)).toBe(paused);
    await expect(page.locator(BUBBLE)).toBeVisible();
    expect(problems).toEqual([]);
  });
});
