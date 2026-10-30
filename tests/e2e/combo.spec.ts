import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  recordVibrations,
  startLevel,
  vibrations,
  WALK_BOUND_MS,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
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

// The combo (story 4.2) on the live level, driven by the test API on a frozen level: steps by hand,
// every bound read from the live feel and content (nothing waits on a fixed delay, nothing hard-codes
// a tuned number). The carry tick is shortened with `ppSetFeel` so that a multiplier climbs in a few
// steps. Chromium and WebKit both run it; the vibrations are checked on Chromium only (WebKit has no
// `navigator.vibrate`).

const LEVEL = 'salon_crawler';
const SEED = 42;
const CHUNK_STEPS = 10;
const BADGE = '.pp-combo-badge';
/** The carry tick the specs set, in sim ms: a multiplier climbs every ten steps. */
const SHORT_TICK_MS = STEP_MS * 10;
/** A tick and a cry in the arms that never come within a spec. */
const NEVER_MS = 100_000;
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

const liveFeelFile = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  combo: { minMultiplier: number; maxMultiplier: number };
  mama: { laughMaxPoints: number; laughPerPerfectPoints: number };
};
const { minMultiplier: MIN, maxMultiplier: MAX } = liveFeelFile.combo;
const geometry = JSON.parse(readFileSync('content/levels/salon_crawler.geometry.json', 'utf8')) as {
  zones: { id: string; kind: string; centerM: [number, number, number] }[];
};
const playpen = geometry.zones.find((zone) => zone.kind === 'safe');
if (playpen === undefined) throw new Error('the live room has no safe zone');

const multiplierText = (multiplier: number): string =>
  (STRINGS['combo.multiplier'] as string).replace('{count}', String(multiplier));
const cashInText = (points: number): string =>
  (STRINGS['combo.cash_in'] as string).replace('{points}', String(Math.round(points)));

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  // The audio is up (WebKit resumes its context a moment after the start): a first tap must not be
  // the gesture that rescues it.
  await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
}

/** Advances by chunks until `isDone` holds on the world; fails when `boundMs` of sim time passed. */
async function advanceUntil(
  page: Page,
  what: string,
  boundMs: number,
  isDone: (world: Awaited<ReturnType<typeof ppWorld>>) => boolean,
): Promise<void> {
  const chunks = Math.ceil(boundMs / (CHUNK_STEPS * STEP_MS));
  for (let i = 0; i <= chunks; i++) {
    if (isDone(await ppWorld(page))) return;
    await ppAdvance(page, CHUNK_STEPS);
  }
  throw new Error(`${what} did not happen within ${boundMs} ms`);
}

/** Takes the baby with a `TapBaby` (Papa walks there first), trying again if he crawled away. */
async function takeBaby(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if ((await ppWorld(page)).baby.state === 'carried') return;
    await ppSend(page, { type: 'TapBaby' });
    try {
      await advanceUntil(
        page,
        'the pick-up',
        WALK_BOUND_MS,
        (world) => world.baby.state === 'carried',
      );
    } catch (error) {
      // He was out of reach on arrival: the next attempt walks to where he is now. Anything else
      // (a page crash, a broken test API) is a failure, not a retry.
      if (!(error instanceof Error) || !error.message.includes('did not happen within'))
        throw error;
    }
  }
  expect((await ppWorld(page)).baby.state).toBe('carried');
}

/** Opens a frozen level, shortens the carry tick, keeps the cry in the arms away and takes the baby. */
async function carryWithShortTick(page: Page): Promise<void> {
  await openFrozen(page);
  await ppSetFeel(page, {
    combo: { carryTickMs: SHORT_TICK_MS },
    carry: { armsCryMinMs: NEVER_MS, armsCryMaxMs: NEVER_MS },
  });
  await takeBaby(page);
}

/** Carries until the multiplier has reached `multiplier` (the tick climbs it by itself). */
async function carryUntilMultiplier(page: Page, multiplier: number): Promise<void> {
  await advanceUntil(
    page,
    `x${multiplier}`,
    SHORT_TICK_MS * (multiplier - MIN + 2),
    (world) => world.combo.multiplier >= multiplier,
  );
}

/** Walks the carrying Papa into the playpen and returns the `ComboCashedIn` event of the put-down. */
async function cashIn(page: Page) {
  const before = (await ppEvents(page)).length;
  await ppSend(page, {
    type: 'TapFloor',
    xM: playpen?.centerM[0] ?? 0,
    zM: playpen?.centerM[2] ?? 0,
  });
  await advanceUntil(
    page,
    'the put-down',
    WALK_BOUND_MS,
    (world) => world.baby.state !== 'carried',
  );
  const cashed = (await ppEvents(page, before)).find((event) => event.type === 'ComboCashedIn');
  if (cashed === undefined) throw new Error('the put-down in the playpen cashed nothing in');
  return cashed;
}

test.describe('the combo badge', () => {
  test('is hidden at x1, reads x2 after a success and goes back down on a missed threat', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(html(page)).toHaveAttribute('data-pp-combo', String(MIN));
    await expect(page.locator(BADGE)).toBeHidden();

    // A forced outlet, parried as soon as its window is open.
    const outlet = (await ppWorld(page)).threats.find((threat) => threat.defId === 'outlet');
    if (outlet === undefined) throw new Error('the level has no outlet');
    await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
    await advanceUntil(
      page,
      'the window',
      WALK_BOUND_MS,
      (world) => world.threats.find((threat) => threat.id === outlet.id)?.state === 'windowOpen',
    );
    await ppSend(page, { type: 'PressThreat', threatId: outlet.id });
    await ppAdvance(page, 5);
    await ppSend(page, { type: 'Release' });
    await advanceUntil(
      page,
      'the response',
      WALK_BOUND_MS,
      (world) => world.threats.find((threat) => threat.id === outlet.id)?.state === 'resolved',
    );
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-combo', String(MIN + 1));
    await expect(page.locator(BADGE)).toBeVisible();
    await expect(page.locator(BADGE)).toHaveText(multiplierText(MIN + 1));
    expect(problems).toEqual([]);
  });

  test('stops at the maximum: the multiplier, the mirror and the text no longer move', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await carryWithShortTick(page);
    await carryUntilMultiplier(page, MAX);
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-combo', String(MAX));
    await expect(page.locator(BADGE)).toHaveText(multiplierText(MAX));
    const basePoints = (await ppWorld(page)).combo.basePoints;
    await ppAdvance(page, CHUNK_STEPS * 3);
    expect((await ppWorld(page)).combo.multiplier).toBe(MAX);
    // x8 stays worth holding: the base points still grow.
    expect((await ppWorld(page)).combo.basePoints).toBeGreaterThan(basePoints);
    await expect(html(page)).toHaveAttribute('data-pp-combo', String(MAX));
    await expect(page.locator(BADGE)).toHaveText(multiplierText(MAX));
    expect(problems).toEqual([]);
  });

  test('a missed threat before the drop resets it to x1: the badge goes, nothing is cashed', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await carryWithShortTick(page);
    await carryUntilMultiplier(page, MIN + 2);
    // The ticks stop: only the missed threat may move the multiplier from here.
    await ppSetFeel(page, { combo: { carryTickMs: NEVER_MS } });
    await ppAdvance(page, CHUNK_STEPS * 2);
    const climbed = (await ppWorld(page)).combo.multiplier;
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-combo', String(climbed));
    await expect(page.locator(BADGE)).toBeVisible();

    const outlet = (await ppWorld(page)).threats.find((threat) => threat.defId === 'outlet');
    if (outlet === undefined) throw new Error('the level has no outlet');
    await ppSend(page, { type: 'ForceThreat', threatId: outlet.id });
    await advanceUntil(
      page,
      'the gag',
      WALK_BOUND_MS,
      (world) => world.threats.find((threat) => threat.id === outlet.id)?.state === 'gag',
    );
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-combo', String(MIN));
    await expect(page.locator(BADGE)).toBeHidden();
    await expect(html(page)).not.toHaveAttribute('data-pp-combo-cashed', /.+/);
    expect(problems).toEqual([]);
  });

  test('moves aside while the cry in the arms is up, so that its verb stays readable', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await ppSetFeel(page, {
      combo: { carryTickMs: SHORT_TICK_MS },
      carry: { armsCryMinMs: SHORT_TICK_MS * 5, armsCryMaxMs: SHORT_TICK_MS * 5 },
    });
    await takeBaby(page);
    await carryUntilMultiplier(page, MIN + 1);
    await ppAdvance(page, 1);
    await expect(page.locator(BADGE)).toBeVisible();
    await expect(page.locator(BADGE)).not.toHaveClass(/pp-combo-badge--aside/);

    const cry = (await ppWorld(page)).threats.find((threat) => threat.defId === 'arms_cry');
    if (cry === undefined) throw new Error('the level has no cry in the arms');
    await advanceUntil(
      page,
      'the cry in the arms',
      SHORT_TICK_MS * 8,
      (world) => world.threats.find((threat) => threat.id === cry.id)?.state === 'telegraph',
    );
    await ppAdvance(page, 1);
    await expect(page.locator(BADGE)).toHaveClass(/pp-combo-badge--aside/);
    const verb = page.locator('.pp-threat-verb');
    await expect(verb).toHaveText(STRINGS['verb.rock'] as string);
    const badgeBox = await page.locator(BADGE).boundingBox();
    const verbBox = await verb.boundingBox();
    if (badgeBox === null || verbBox === null) throw new Error('the badge or the verb has no box');
    const isApart =
      badgeBox.x + badgeBox.width <= verbBox.x ||
      verbBox.x + verbBox.width <= badgeBox.x ||
      badgeBox.y + badgeBox.height <= verbBox.y ||
      verbBox.y + verbBox.height <= badgeBox.y;
    expect(isApart, 'the badge and the verb overlap').toBe(true);
    expect(problems).toEqual([]);
  });
});

test.describe('cashing the combo in', () => {
  test('a put-down in the playpen cashes it in: the points, the cues, the slow-mo and the badge', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await carryWithShortTick(page);
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    await carryUntilMultiplier(page, MIN + 2);
    const cashed = await cashIn(page);
    expect(cashed.points).toBeGreaterThan(0);
    expect(cashed.points).toBeCloseTo(cashed.multiplier * cashed.basePoints, 9);

    // The slow-mo is the sim's: it holds right after the put-down.
    expect((await ppWorld(page)).time.scale).toBeLessThan(1);
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-combo-cashed', String(cashed.points));
    await expect(html(page)).toHaveAttribute('data-pp-combo', String(MIN));
    // The multiplier is back to x1 but the badge shows the points for a moment, then goes.
    await expect(page.locator(BADGE)).toHaveText(cashInText(cashed.points));
    await expect(page.locator(BADGE)).toBeHidden({ timeout: 5000 });

    const cues = (await ppCueLog(page)).map((entry) => entry.cueId);
    expect(cues).toContain('combo_cashed_in');
    expect(cues).toContain('baby_put_down');
    if (hasVibrate()) {
      const seen = (await vibrations(page)).slice(vibrationsBefore).map(String);
      const heavy = hapticPatternOfCue('combo_cashed_in');
      expect(heavy, 'combo_cashed_in has a haptic').not.toBeNull();
      expect(seen).toContain(String(heavy));
    }
    expect(problems).toEqual([]);
  });

  test('a put-down on bare floor neither cashes in nor resets', async ({ page }) => {
    const problems = collectProblems(page);
    await carryWithShortTick(page);
    await carryUntilMultiplier(page, MIN + 2);
    // Stop the ticks, so that only the put-down could move the multiplier.
    await ppSetFeel(page, { combo: { carryTickMs: NEVER_MS } });
    await ppAdvance(page, CHUNK_STEPS * 2);
    const before = (await ppWorld(page)).combo;
    const from = (await ppEvents(page)).length;
    await ppSend(page, { type: 'TapBaby' });
    await ppAdvance(page, 2);
    expect((await ppEvents(page, from)).map((event) => event.type)).toContain('BabyPutDown');
    await expect(html(page)).toHaveAttribute('data-pp-put-down', 'unsafe');
    await expect(html(page)).toHaveAttribute('data-pp-combo', String(before.multiplier));
    await expect(html(page)).not.toHaveAttribute('data-pp-combo-cashed', /.+/);
    const after = (await ppWorld(page)).combo;
    expect(after.multiplier).toBe(before.multiplier);
    expect(after.basePoints).toBe(before.basePoints);
    expect(after.carryTickAt).toBeNull();
    expect((await ppEvents(page, from)).map((event) => event.type)).not.toContain('ComboCashedIn');
    await expect(page.locator(BADGE)).toBeVisible();
    expect(problems).toEqual([]);
  });

  test('the points feed the Rire of the note', async ({ page }) => {
    const problems = collectProblems(page);
    await carryWithShortTick(page);
    await carryUntilMultiplier(page, MIN + 2);
    const cashed = await cashIn(page);
    const world = await ppWorld(page);
    expect(world.score.comboPoints).toBeCloseTo(cashed.points, 9);

    // A forced end: Mama wakes, and the note is given in that very step.
    const from = (await ppEvents(page)).length;
    await ppSend(page, { type: 'SetNoise', pct: 100 });
    await ppAdvance(page, 2);
    const scored = (await ppEvents(page, from)).find((event) => event.type === 'LevelScored');
    if (scored === undefined || scored.type !== 'LevelScored') throw new Error('no note was given');
    const { laughMaxPoints, laughPerPerfectPoints } = liveFeelFile.mama;
    const expected = Math.round(
      Math.min(
        laughMaxPoints,
        world.score.perfects * laughPerPerfectPoints + world.score.comboPoints,
      ),
    );
    expect(scored.laughPoints).toBe(expected);
    expect(scored.laughPoints).toBeGreaterThan(
      Math.round(Math.min(laughMaxPoints, world.score.perfects * laughPerPerfectPoints)),
    );
    expect(problems).toEqual([]);
  });
});
