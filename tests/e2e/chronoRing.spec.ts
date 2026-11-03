import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  LEVEL_DURATION_MS,
  liveFeel,
  liveThreat,
  mirrorWrites,
  OVERRUN_MARGIN_MS,
  recordMirrorWrites,
  recordVibrations,
  startLevel,
  telegraphDelayMsOf,
  threatIconPoint,
  vibrations,
  waitForThreat,
  waitFrames,
} from './support/game.ts';
import {
  ppAdvance,
  ppCueLog,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The chrono-ring (story 2.11) on the live level: a frozen level driven by the test API (`ForceThreat`,
// `ppAdvance`) for the geometry, the lit arc, the vibration, the modifiers and the hold; a real pause on a
// running level; and the perfect bot through the judged mirror. Every bound comes from the live def, the
// live feel and the frozen `responseWindow` of the world, never from a literal. Chromium and WebKit both run
// it (the vibration is checked on Chromium only).

const LEVEL = 'salon_crawler';
const SEED = 42;
const OUTLET = 'outlet';
const CUE = 'chrono_arc_lit';
const hasVibrate = (): boolean => test.info().project.name === 'chromium';
const { holdMinMs } = liveFeel.input;

/** The ring the player sees: hidden rings (the other threats') are `hidden`. */
const shownRing = (page: Page) => page.locator('.pp-chrono-ring:not([hidden])');

/** How full the shown ring is, in whole per-mille: the paper dash is `1000 − stroke-dashoffset`. */
const progressOf = (page: Page): Promise<number> =>
  shownRing(page)
    .locator('.pp-chrono-progress')
    .evaluate((circle) => 1000 - Number(circle.getAttribute('stroke-dashoffset')));

/** The share of the final arc, in per-mille: the first number of its dash (`<arc> <from>`). */
const arcShareOf = (page: Page): Promise<number> =>
  shownRing(page)
    .locator('.pp-chrono-arc')
    .evaluate((circle) => Number((circle.getAttribute('stroke-dasharray') ?? '').split(' ')[0]));

const isLit = (page: Page): Promise<boolean> =>
  shownRing(page).evaluate((ring) => ring.classList.contains('pp-chrono-ring--lit'));

/** Starts the game for real (audio unlocked), then freezes it on a fresh level. */
async function openFrozen(page: Page): Promise<void> {
  await recordVibrations(page);
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

async function outletThreat(page: Page) {
  const outlet = (await ppWorld(page)).threats.find((threat) => threat.defId === OUTLET);
  if (outlet === undefined) throw new Error('the level does not plan the outlet');
  return outlet;
}

/** Forces the outlet and steps once: it is telegraphed, its window frozen. */
async function telegraphOutlet(page: Page) {
  const outlet = await outletThreat(page);
  await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
  await ppAdvance(page, 1);
  await waitFrames(page, 2);
  const telegraphed = await outletThreat(page);
  if (telegraphed.state !== 'telegraph' || telegraphed.responseWindow === null) {
    throw new Error(`the outlet is ${telegraphed.state}, not telegraphed`);
  }
  return { ...telegraphed, responseWindow: telegraphed.responseWindow };
}

/** The per-mille the ring should show at `simMs`: the telegraph to the end of the window. */
const expectedPermille = (
  threat: { enteredAt: number; windowOpenAt: number; responseWindow: { windowMs: number } },
  simMs: number,
): number => {
  const spanMs = threat.windowOpenAt + threat.responseWindow.windowMs - threat.enteredAt;
  return Math.min(1000, Math.max(0, ((simMs - threat.enteredAt) / spanMs) * 1000));
};

/** One step of slack: the frame draws the sim time interpolated, and the ring is whole per-mille. */
const toleranceOf = (threat: {
  enteredAt: number;
  windowOpenAt: number;
  responseWindow: { windowMs: number };
}): number => {
  const spanMs = threat.windowOpenAt + threat.responseWindow.windowMs - threat.enteredAt;
  return Math.ceil((STEP_MS / spanMs) * 1000) + 1;
};

test.describe('the ring on a threat', () => {
  test('is not there before the telegraph; fills from it, in sim time, to the end of the window; lights at the opening; stays full; goes with the threat', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(shownRing(page)).toHaveCount(0);

    const threat = await telegraphOutlet(page);
    // The delay and the window come from the live def and the frozen window of the world.
    expect(threat.windowOpenAt - threat.enteredAt).toBe(telegraphDelayMsOf(liveThreat(OUTLET)));
    await expect(shownRing(page)).toHaveCount(1);
    const tolerance = toleranceOf(threat);
    expect(
      Math.abs((await progressOf(page)) - expectedPermille(threat, threat.enteredAt)),
    ).toBeLessThanOrEqual(tolerance);
    expect(await isLit(page)).toBe(false);

    // After n steps the progress is n × STEP_MS / (delay + window), and the arc is not lit before the opening.
    let steps = 0;
    while ((await ppWorld(page)).time.sim + 3 * STEP_MS < threat.windowOpenAt) {
      await ppAdvance(page, 7);
      steps += 7;
      await waitFrames(page, 2);
      const sim = (await ppWorld(page)).time.sim;
      expect(
        Math.abs((await progressOf(page)) - expectedPermille(threat, sim)),
        `after ${steps} steps`,
      ).toBeLessThanOrEqual(tolerance);
      expect(await isLit(page)).toBe(false);
    }

    // Single steps to the opening: not lit until the step that opens the window, lit at it.
    for (let i = 0; i < 20; i++) {
      const current = await outletThreat(page);
      if (current.state === 'windowOpen') break;
      expect(await isLit(page), `before the opening, step ${i}`).toBe(false);
      await ppAdvance(page, 1);
      await waitFrames(page, 2);
    }
    expect((await outletThreat(page)).state).toBe('windowOpen');
    // The drawn sim time trails the sim by up to one step (`world.time.sim − STEP_MS × (1 − alpha)`, and a
    // frozen frame has alpha 0): the arc lights by that drawn time, so the frame after the opening step shows it.
    await ppAdvance(page, 1);
    await waitFrames(page, 2);
    await expect(shownRing(page)).toHaveClass(/pp-chrono-ring--lit/);

    // Frames with no step leave the ring as it is (hitstop, pause: nothing runs).
    const frozen = await progressOf(page);
    await waitFrames(page, 6);
    expect(await progressOf(page)).toBe(frozen);

    // Full at the end of the window, and still shown and full until the sim settles the threat.
    const closeAt = threat.windowOpenAt + threat.responseWindow.windowMs;
    // (One step past the close: the drawn time trails the sim by a step. Still inside the hidden tolerance.)
    while ((await ppWorld(page)).time.sim < closeAt + STEP_MS) await ppAdvance(page, 1);
    await waitFrames(page, 2);
    expect((await outletThreat(page)).state).toBe('windowOpen');
    expect(await progressOf(page)).toBe(1000);

    // The threat is settled (a gag: nobody pressed): the ring goes with it.
    for (let i = 0; i < 40; i++) {
      const state = (await outletThreat(page)).state;
      if (state !== 'windowOpen' && state !== 'telegraph') break;
      await ppAdvance(page, 1);
    }
    await waitFrames(page, 2);
    await expect(shownRing(page)).toHaveCount(0);
    expect(problems).toEqual([]);
  });

  test('plays chrono_arc_lit once, at the step that opens the window, with a light vibration', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await telegraphOutlet(page);
    const countOf = async (): Promise<number> =>
      (await ppCueLog(page)).filter((record) => record.cueId === CUE).length;
    expect(await countOf()).toBe(0);
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;

    for (let i = 0; i < 400 && (await outletThreat(page)).state === 'telegraph'; i++) {
      expect(await countOf(), 'nothing before the opening').toBe(0);
      await ppAdvance(page, 1);
    }
    expect((await outletThreat(page)).state).toBe('windowOpen');
    expect(await countOf()).toBe(1);
    const record = (await ppCueLog(page)).find((entry) => entry.cueId === CUE);
    expect(record?.haptic).toBe('light');
    expect(record?.visuals).toEqual(['uiElement']);
    // Once: the rest of the window plays nothing new.
    await ppAdvance(page, 3);
    expect(await countOf()).toBe(1);

    if (hasVibrate()) {
      const pattern = hapticPatternOfCue(CUE);
      expect(pattern).not.toBeNull();
      expect((await vibrations(page)).slice(vibrationsBefore)).toContainEqual(pattern);
    }
    expect(problems).toEqual([]);
  });

  test('follows the frozen window: the lit arc grows with Fatherly Instinct and with the assistance tier', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    // What the arc's share must be: the window over the delay plus the window, from the frozen window.
    const shareOf = (threat: Awaited<ReturnType<typeof telegraphOutlet>>): number =>
      Math.round(
        (threat.responseWindow.windowMs /
          (threat.windowOpenAt - threat.enteredAt + threat.responseWindow.windowMs)) *
          1000,
      );

    const plain = await telegraphOutlet(page);
    const plainShare = await arcShareOf(page);
    expect(Math.abs(plainShare - shareOf(plain))).toBeLessThanOrEqual(1);

    await ppLoadLevel(page, LEVEL, SEED);
    await ppSend(page, { type: 'ForceInstinct' });
    await ppAdvance(page, 2);
    const instinct = await telegraphOutlet(page);
    expect(instinct.responseWindow.windowMs).toBeGreaterThan(plain.responseWindow.windowMs);
    const instinctShare = await arcShareOf(page);
    expect(Math.abs(instinctShare - shareOf(instinct))).toBeLessThanOrEqual(1);
    expect(instinctShare).toBeGreaterThan(plainShare);

    await ppLoadLevel(page, LEVEL, SEED);
    await ppSend(page, { type: 'SetDifficultyTier', tier: 'assistance' });
    await ppAdvance(page, 1);
    const assisted = await telegraphOutlet(page);
    expect(assisted.responseWindow.windowMs).toBeGreaterThan(plain.responseWindow.windowMs);
    const assistedShare = await arcShareOf(page);
    expect(Math.abs(assistedShare - shareOf(assisted))).toBeLessThanOrEqual(1);
    expect(assistedShare).toBeGreaterThan(plainShare);
    expect(problems).toEqual([]);
  });
});

test.describe('the hold drains the ring', () => {
  /** The outlet served as a Firmness held from the opening to well past `holdMinMs` (as `holdRing.spec.ts` does). */
  const FIRM_HOLD_UNTIL_MS =
    (liveThreat(OUTLET).windowMs ?? liveFeel.timing.windowMs) + holdMinMs * 2;

  async function serveOutletAsFirm(page: Page): Promise<void> {
    const outlet = JSON.parse(readFileSync('content/threats/outlet.json', 'utf8')) as Record<
      string,
      unknown
    >;
    const firm = JSON.stringify({ ...outlet, response: 'firm', holdUntilMs: FIRM_HOLD_UNTIL_MS });
    await page.route(/\/content\/threats\/outlet\.json\?/, (route) =>
      route.fulfill({
        contentType: 'text/javascript',
        body: `export default ${JSON.stringify(firm)};`,
      }),
    );
  }

  test('a held press switches the ring to --hold, with no lit arc, and its progress falls; the ring goes with the threat', async ({
    page,
  }) => {
    await serveOutletAsFirm(page);
    const problems = collectProblems(page);
    await openFrozen(page);
    const threat = await telegraphOutlet(page);
    // Before the press the ring fills and is a plain ring.
    await expect(shownRing(page)).not.toHaveClass(/pp-chrono-ring--hold/);
    for (let i = 0; i < 400 && (await outletThreat(page)).state === 'telegraph'; i++) {
      await ppAdvance(page, 1);
    }
    expect((await outletThreat(page)).state).toBe('windowOpen');
    // The drawn time trails the sim by a step: one more step, and the arc is lit.
    await ppAdvance(page, 1);
    await waitFrames(page, 2);
    await expect(shownRing(page)).toHaveClass(/pp-chrono-ring--lit/);

    const point = await threatIconPoint(page);
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await ppAdvance(page, 2);
    await waitFrames(page, 2);
    await expect(shownRing(page)).toHaveClass(/pp-chrono-ring--hold/);
    await expect(shownRing(page)).not.toHaveClass(/pp-chrono-ring--lit/);
    const early = await progressOf(page);
    expect(early).toBeGreaterThan(500);

    // It drains: later in the hold the ring holds less.
    await ppAdvance(page, Math.ceil(holdMinMs / STEP_MS / 2));
    await waitFrames(page, 2);
    const later = await progressOf(page);
    expect(later).toBeLessThan(early);
    await expect(shownRing(page)).toHaveClass(/pp-chrono-ring--hold/);

    // To the end of the attack: the hold resolves the threat and the ring goes.
    await ppAdvance(page, Math.ceil(FIRM_HOLD_UNTIL_MS / STEP_MS) + 2);
    await waitFrames(page, 2);
    expect((await outletThreat(page)).state).not.toBe('windowOpen');
    await expect(shownRing(page)).toHaveCount(0);
    await page.mouse.up();
    expect(threat.id).toBeGreaterThan(0);
    expect(problems).toEqual([]);
  });
});

test.describe('the game stops the ring', () => {
  test('a real pause on a running level leaves the ring where it was', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await waitForThreat(page, 'telegraph', 60_000);
    await expect(shownRing(page).first()).toBeVisible();
    await page.locator('.pp-hud-pause').click();
    await expect(page.locator('html')).toHaveAttribute('data-pp-state', 'paused');
    await waitFrames(page, 3);
    const paused = await progressOf(page);
    await waitFrames(page, 20);
    expect(await progressOf(page)).toBe(paused);
    expect(problems).toEqual([]);
  });
});

test.describe('every perfect press is in the notch', () => {
  const SPEED = 4;
  const RINGS_NEEDED = 5;
  test.setTimeout(RESUME_COUNTDOWN_MS + LEVEL_DURATION_MS / SPEED + 4 * OVERRUN_MARGIN_MS + 60_000);

  test('the perfect bot on salon_crawler: each judged press lands between the arc start and the end, inside the notch', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    // A recorder, as `photo.spec.ts` does: the mirror changes at every judgement and polling would miss some.
    await recordMirrorWrites(page, ['data-pp-chrono-judged']);
    await page.goto(`/?autoplay=perfect&seed=${SEED}&speed=${SPEED}`);
    await waitForTestApi(page);

    await expect
      .poll(async () => (await mirrorWrites(page)).length, {
        timeout: RESUME_COUNTDOWN_MS + LEVEL_DURATION_MS / SPEED + 2 * OVERRUN_MARGIN_MS,
      })
      .toBeGreaterThanOrEqual(RINGS_NEEDED);

    const judged = (await mirrorWrites(page)).filter(
      (write) => write.name === 'data-pp-chrono-judged',
    );
    expect(judged.length).toBeGreaterThanOrEqual(RINGS_NEEDED);
    for (const write of judged) {
      const [, , press, arcFrom, notchFrom, notchTo] = write.value.split(':').map(Number) as [
        number,
        number,
        number,
        number,
        number,
        number,
      ];
      const label = `judgement ${write.value}`;
      expect(Number.isFinite(press), label).toBe(true);
      expect(arcFrom, label).toBeLessThanOrEqual(press);
      expect(press, label).toBeLessThanOrEqual(1000);
      expect(notchFrom, label).toBeLessThanOrEqual(press);
      expect(press, label).toBeLessThanOrEqual(notchTo);
    }
    expect(problems).toEqual([]);
  });
});
