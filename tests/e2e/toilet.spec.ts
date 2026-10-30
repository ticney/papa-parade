import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { HUD_MAX_DOM_NODES, STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeedback,
  liveFeel,
  objectIconPoint,
  pagePointOf,
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
  ppWorld,
} from './support/testApi.ts';

// The pressing need (story 4.3) on the live level, driven by the test API on a frozen level: steps by
// hand, `SetBladder` to get needy without waiting 3 minutes, every bound read from the live feel,
// feedback and content. Chromium and WebKit both run it; the vibrations are checked on Chromium only
// (WebKit has no `navigator.vibrate`).

const LEVEL = 'salon_crawler';
const SEED = 42;
const CHUNK_STEPS = 10;
const PILL = '[data-pp-zone="gauges"] > .pp-hud-gauges';
const GAUGE_LABELS = [STRINGS['gauge.noise'], STRINGS['gauge.fatigue'], STRINGS['gauge.urge']];
const NEED_GAUGE = `${PILL} > .pp-hud-gauge[aria-label^="${STRINGS['gauge.urge']} "]`;
const DOOR = '.pp-object[data-pp-object="toilet"]';
const HINT = '.pp-papa-hint';
const { bladder } = liveFeel;
const HOLD_MS = (liveFeedback as unknown as { papaHint: { holdMs: number } }).papaHint.holdMs;
const geometry = JSON.parse(readFileSync('content/levels/salon_crawler.geometry.json', 'utf8')) as {
  anchors: { id: string; positionM: [number, number, number] }[];
};
const toiletAnchor = geometry.anchors.find((anchor) => anchor.id === 'toilet');
if (toiletAnchor === undefined) throw new Error('the live room has no toilet anchor');
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  // The audio is up (WebKit resumes its context a moment after the start). The context itself must
  // be running, not only the babble started: a tap on a context still suspended makes the game warn
  // (« resuming on this gesture »), which `collectProblems` counts as a problem.
  await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
  await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
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
      if (!(error instanceof Error) || !error.message.includes('did not happen within'))
        throw error;
    }
  }
  expect((await ppWorld(page)).baby.state).toBe('carried');
}

/** Sim steps a walk of Papa from his spawn takes to a floor point, from a tap to `idle`. */
async function walkSteps(page: Page, xM: number, zM: number): Promise<number> {
  await ppSend(page, { type: 'TapFloor', xM, zM });
  await ppAdvance(page, 1);
  let steps = 1;
  while ((await ppWorld(page)).papa.state === 'walkPath' && steps < 5000) {
    await ppAdvance(page, CHUNK_STEPS);
    steps += CHUNK_STEPS;
  }
  return steps;
}

/** A tap on the door's icon, as a finger would. */
async function tapDoor(page: Page): Promise<void> {
  const at = await objectIconPoint(page, 'toilet');
  await page.touchscreen.tap(at.x, at.y);
}

test.describe('the gauge', () => {
  test('is the third in the pill, after Bruit and Fatigue, and rises with the time', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const labels = await page
      .locator(`${PILL} > .pp-hud-gauge`)
      .evaluateAll((elements) =>
        elements.map((element) => element.getAttribute('aria-label')?.replace(/ \d+ %$/, '')),
      );
    expect(labels).toEqual(GAUGE_LABELS);
    // Whole percent per frame: 20 s at the live rate is a clear rise.
    const seconds = 20;
    await ppAdvance(page, (seconds * 1000) / STEP_MS);
    const world = await ppWorld(page);
    expect(world.gauges.bladderPct).toBeCloseTo(bladder.perSec * seconds, 6);
    await expect(page.locator(NEED_GAUGE)).toHaveAttribute(
      'aria-label',
      new RegExp(`^${STRINGS['gauge.urge']} ${Math.round(bladder.perSec * seconds)} %$`),
    );
    // The mirror is written on events only, never per frame: it still holds the start value.
    await expect(html(page)).toHaveAttribute('data-pp-bladder', String(bladder.startPct));
    const nodes = await page.evaluate(() => document.querySelectorAll('#pp-hud *').length);
    expect(nodes).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
    expect(problems).toEqual([]);
  });

  test('never runs under the timer, from the narrowest landscape phone up: it moves aside when the screen is too narrow, and stays centred when there is room', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await ppAdvance(page, 3);
    const viewports = [
      { width: 667, height: 375 },
      { width: 740, height: 360 },
      { width: 812, height: 375 },
      { width: 844, height: 390 },
    ];
    for (const viewport of viewports) {
      await page.setViewportSize(viewport);
      await ppAdvance(page, 1);
      const boxes = await page.evaluate(() => {
        const box = (selector: string) => {
          const rect = document.querySelector(selector)?.getBoundingClientRect();
          return rect === undefined ? null : { left: rect.left, right: rect.right };
        };
        return { pill: box('.pp-hud-gauges'), timer: box('.pp-hud-timer') };
      });
      const label = `${viewport.width} x ${viewport.height}`;
      if (boxes.pill === null || boxes.timer === null)
        throw new Error(`${label}: no pill or timer`);
      expect(boxes.pill.right, label).toBeLessThanOrEqual(boxes.timer.left);
      // Centred whenever the pill leaves room for it.
      const centreOffsetPx = Math.abs(
        (boxes.timer.left + boxes.timer.right) / 2 - viewport.width / 2,
      );
      if (boxes.pill.right + 8 < boxes.timer.left) {
        expect(centreOffsetPx, `${label}: centred`).toBeLessThanOrEqual(1);
      }
      // The timer never meets the pause button either.
      const pause = await page.locator('[data-pp-zone="pause"] button').boundingBox();
      if (pause === null) throw new Error(`${label}: no pause button`);
      expect(boxes.timer.right, label).toBeLessThan(pause.x);
    }
    expect(problems).toEqual([]);
  });

  test('goes warm from the warn point, plays its cue on filling, and slows the walks', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    // The same walk, from the spawn, with an empty need and with a full one.
    const papa = (await ppWorld(page)).papa;
    const target = { xM: papa.xM - 3, zM: papa.zM };
    const calmSteps = await walkSteps(page, target.xM, target.zM);
    await ppLoadLevel(page, LEVEL, SEED);
    await ppFreeze(page, true);
    await ppSend(page, { type: 'SetBladder', pct: 100 });
    await ppAdvance(page, 3);
    await expect(page.locator(NEED_GAUGE)).toHaveClass(/pp-hud-gauge-warn/);
    await expect(html(page)).toHaveAttribute('data-pp-bladder', '100');
    expect((await ppCueLog(page)).map((entry) => entry.cueId)).toContain('bladder_full');
    if (hasVibrate()) {
      const pattern = hapticPatternOfCue('bladder_full');
      expect(pattern, 'bladder_full has a haptic').not.toBeNull();
      expect((await vibrations(page)).slice(vibrationsBefore).map(String)).toContain(
        String(pattern),
      );
    }
    const slowSteps = await walkSteps(page, target.xM, target.zM);
    const expected = calmSteps / (1 - bladder.slowdownPct / 100);
    // Chunks of CHUNK_STEPS: the measure is good to one chunk.
    expect(slowSteps).toBeGreaterThan(calmSteps);
    expect(Math.abs(slowSteps - expected)).toBeLessThanOrEqual(2 * CHUNK_STEPS);
    expect(problems).toEqual([]);
  });
});

test.describe('the door', () => {
  test('a real tap on its icon walks Papa in: he is out of the room, the door occupied, taps do nothing; then back at 0', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await page.addStyleTag({ content: '#pp-world, #pp-hud { visibility: hidden !important; }' });
    await ppSend(page, { type: 'SetBladder', pct: 90 });
    await ppAdvance(page, 2);
    await expect(page.locator(DOOR)).toHaveCount(1);
    // At 90 the door is warm (urgentFromPct is 70).
    expect(bladder.urgentFromPct).toBeLessThan(90);
    await expect(page.locator(DOOR)).toHaveClass(/pp-object-urgent/);

    const before = (await ppEvents(page)).length;
    await tapDoor(page);
    await ppAdvance(page, 1);
    expect((await ppEvents(page, before)).map((event) => event.type)).toContain('PapaPathPlanned');
    await advanceUntil(
      page,
      'the arrival',
      WALK_BOUND_MS * 2,
      (world) => world.papa.state === 'onToilet',
    );
    await ppAdvance(page, 2);
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'onToilet');
    await expect(page.locator(DOOR)).toHaveClass(/pp-object-occupied/);
    await expect(page.locator(DOOR)).not.toHaveClass(/pp-object-urgent/);

    // Papa's mesh is hidden: the canvas around his feet is what the floor alone gives, and differs
    // from the same frame with him there.
    const world = await ppWorld(page);
    const feet = await pagePointOf(page, world.papa.xM, 0.4, world.papa.zM);
    const clip = { x: feet.x - 24, y: feet.y - 24, width: 48, height: 48 };
    const away = await page.screenshot({ clip });
    // Taps do nothing: a floor tap and a tap on the coffee machine plan no walk.
    const tapsFrom = (await ppEvents(page)).length;
    await page.touchscreen.tap(200, 200);
    await ppSend(page, { type: 'TapObject', objectId: 'coffee_machine' });
    await ppAdvance(page, 5);
    expect((await ppEvents(page, tapsFrom)).map((event) => event.type)).not.toContain(
      'PapaPathPlanned',
    );
    expect((await ppWorld(page)).papa.state).toBe('onToilet');

    await advanceUntil(
      page,
      'the end of the visit',
      bladder.toiletDurationMs + 2000,
      (current) => current.papa.state === 'idle',
    );
    await ppAdvance(page, 2);
    const back = await ppWorld(page);
    // The need falls to 0 at the end (one step's gain is all that is left of it).
    expect(back.gauges.bladderPct).toBeLessThan(1);
    expect(back.papa.state).toBe('idle');
    await expect(html(page)).toHaveAttribute('data-pp-bladder', '0');
    await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'idle');
    await expect(page.locator(DOOR)).not.toHaveClass(/pp-object-occupied/);
    const here = await page.screenshot({ clip });
    expect(here.equals(away), 'Papa is drawn again, so the clip changed').toBe(false);
    expect(problems).toEqual([]);
  });

  test('plays the door, flush and fills cues with their vibrations on Chromium', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    await ppSend(page, { type: 'SetBladder', pct: 100 });
    await ppSend(page, { type: 'TapObject', objectId: 'toilet' });
    await advanceUntil(page, 'the visit', WALK_BOUND_MS * 2, (w) => w.papa.state === 'onToilet');
    await advanceUntil(
      page,
      'the end of the visit',
      bladder.toiletDurationMs + 2000,
      (w) => w.papa.state === 'idle',
    );
    const cues = (await ppCueLog(page)).map((entry) => entry.cueId);
    for (const cueId of ['bladder_full', 'toilet_entered', 'toilet_flushed']) {
      expect(cues, cueId).toContain(cueId);
    }
    if (hasVibrate()) {
      const seen = (await vibrations(page)).slice(vibrationsBefore).map(String);
      for (const cueId of ['bladder_full', 'toilet_entered', 'toilet_flushed']) {
        const pattern = hapticPatternOfCue(cueId);
        expect(pattern, `${cueId} has a haptic`).not.toBeNull();
        expect(seen).toContain(String(pattern));
      }
    }
    expect(problems).toEqual([]);
  });
});

test.describe('with the baby in the arms', () => {
  test('the verb goes as soon as the baby is put down, well before holdMs', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await takeBaby(page);
    await tapDoor(page);
    await ppAdvance(page, 2);
    await expect(page.locator(HINT)).toBeVisible();
    await ppSend(page, { type: 'TapBaby' });
    await ppAdvance(page, 3);
    // Shorter than `holdMs`: only the put-down can have taken it away (the timeout never fails
    // a hint that is gone, so this can only miss a late hide, never flake).
    await expect(page.locator(HINT)).toBeHidden({ timeout: HOLD_MS / 2 });
    expect(problems).toEqual([]);
  });

  test('a tap on the door shows « POSE-LE D’ABORD ! », walks nowhere, and the verb goes after holdMs; after a put-down the tap works', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    await takeBaby(page);
    await expect(page.locator(HINT)).toBeHidden();
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    const before = (await ppEvents(page)).length;
    const markersBefore = await html(page).getAttribute('data-pp-tap');
    await tapDoor(page);
    await ppAdvance(page, 2);
    const events = (await ppEvents(page, before)).map((event) => event.type);
    expect(events).toContain('ToiletRefused');
    expect(events).not.toContain('PapaPathPlanned');
    expect(events).not.toContain('ObjectTapped');
    expect(await html(page).getAttribute('data-pp-tap')).toBe(markersBefore);
    await expect(page.locator(HINT)).toBeVisible();
    await expect(page.locator(HINT)).toHaveText(STRINGS['verb.put_down_first'] as string);
    expect((await ppCueLog(page)).map((entry) => entry.cueId)).toContain('toilet_refused');
    if (hasVibrate()) {
      const pattern = hapticPatternOfCue('toilet_refused');
      expect(pattern, 'toilet_refused has a haptic').not.toBeNull();
      expect((await vibrations(page)).slice(vibrationsBefore).map(String)).toContain(
        String(pattern),
      );
    }
    expect((await ppWorld(page)).papa.state).toBe('idle');
    // It is gone after `holdMs` of real time (the loop is frozen, the page still draws).
    await expect(page.locator(HINT)).toBeHidden({ timeout: HOLD_MS + 4000 });

    // Put the baby down (a tap on Papa), then the same tap on the door works.
    await ppSend(page, { type: 'TapBaby' });
    await ppAdvance(page, 3);
    expect((await ppWorld(page)).baby.state).not.toBe('carried');
    await tapDoor(page);
    await advanceUntil(
      page,
      'the arrival',
      WALK_BOUND_MS * 2,
      (world) => world.papa.state === 'onToilet',
    );
    expect(problems).toEqual([]);
  });

  test('Space beside the door puts the baby down; the next press goes in', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await takeBaby(page);
    // Back to the door, baby in the arms: a tap on the floor at its foot.
    await ppSend(page, {
      type: 'TapFloor',
      xM: toiletAnchor.positionM[0],
      zM: toiletAnchor.positionM[2],
    });
    await ppAdvance(page, 1);
    await advanceUntil(page, 'the walk', WALK_BOUND_MS, (world) => world.papa.state === 'idle');
    const before = (await ppEvents(page)).length;
    await page.keyboard.down('KeyD'); // the hand is on the keyboard
    await page.keyboard.up('KeyD');
    await ppSend(page, { type: 'MoveStop' });
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await ppAdvance(page, 3);
    const first = (await ppEvents(page, before)).map((event) => event.type);
    expect(first).toContain('BabyPutDown');
    expect(first).not.toContain('ToiletRefused');
    expect((await ppWorld(page)).baby.state).not.toBe('carried');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    await advanceUntil(
      page,
      'the visit',
      WALK_BOUND_MS,
      (world) => world.papa.state === 'onToilet',
    );
    expect(problems).toEqual([]);
  });
});
