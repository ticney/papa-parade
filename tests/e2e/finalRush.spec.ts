import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  appUrl,
  CHUNK_STEPS,
  collectProblems,
  emulateReducedMotion,
  html,
  LEVEL_DURATION_MS,
  pagePointOf,
  THREATS_OFF,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppSend,
  ppSetFeel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The final rush (story 3.5): the door opens ten seconds before the end of the level, Papa tidies the mess,
// and the level ends on the photo. Driven by the test API on a frozen level (steps by hand, nothing waits on a
// fixed delay) with a REAL tap and a REAL key for the tidying; the rush is moved to the start of the level
// with a `SetFeel` (a feel value, as the story says), so no spec plays 170 s to get there. The door's numbers
// are the live ones (`feedback.json › door`). Chromium only (the story's call): the other engine is not asked.

const LEVEL = 'salon_crawler';
const SEED = 42;
/** The rush begins this far into the level (the level then lasts this much longer in the rush). */
const RUSH_AT_MS = 2000;
const TIMER = '[data-pp-zone="timer"] .pp-hud-timer';
const MARKER = '.pp-tidy-marker';
/** The « RANGE ! » markers on screen: a hidden one stays in the DOM, so it is the visible ones that count. */
const shownMarkers = (page: Page) =>
  page.locator(`${MARKER}:visible`).filter({ hasText: STRINGS['verb.tidy'] as string });

const feedback = JSON.parse(readFileSync('content/feedback.json', 'utf8')) as {
  door: { openMs: number; openAngleDeg: number };
};
const liveFeel = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  endOfLevel: { doorSpillCount: number };
};

async function advanceTo(page: Page, simMs: number): Promise<void> {
  let remaining = Math.ceil((simMs - (await ppWorld(page)).time.sim) / STEP_MS);
  while (remaining > 0) {
    const chunk = Math.min(CHUNK_STEPS, remaining);
    await ppAdvance(page, chunk);
    remaining -= chunk;
  }
}

/** Opens the frozen level with no planned threat, the mug on the floor, and the rush set to begin at `RUSH_AT_MS`. */
async function openRush(page: Page): Promise<void> {
  await page.goto(appUrl(`/${THREATS_OFF}`));
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  const start = await ppWorld(page);
  await ppSetFeel(page, { endOfLevel: { finalRushMs: LEVEL_DURATION_MS - RUSH_AT_MS } });
  // The mug leaves its table by the side away from the vase, and has landed well before the door.
  await ppSend(page, {
    type: 'PushProp',
    t: start.time.sim,
    propId: 'mug_01',
    impulseXNs: 0,
    impulseYNs: 0,
    impulseZNs: 0.72,
  });
  await advanceTo(page, RUSH_AT_MS - STEP_MS);
}

test.describe('the final rush', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only (story 3.5)');

  test('opens the door, shows « RANGE ! » over the mess, lets a real tap and a real key tidy it, and ends on the photo', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openRush(page);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
    await expect(page.locator(TIMER)).not.toHaveClass(/pp-hud-timer--rush/);
    // Only the mug is on the floor, and the door is shut: no marker is shown yet (the flow is playing).
    expect((await ppWorld(page)).mess.propsOnFloor).toBe(1);
    await expect(shownMarkers(page)).toHaveCount(0);
    expect((await ppFx(page)).doorOpenDeg).toBe(0);

    // The door opens: the cue, the flow, the timer, and the door not jumped open.
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'finalRush');
    const started = (await ppEvents(page)).filter((event) => event.type === 'FinalRushStarted');
    expect(started).toEqual([{ type: 'FinalRushStarted', t: RUSH_AT_MS }]);
    await expect(page.locator(TIMER)).toHaveClass(/pp-hud-timer--rush/);
    await expect
      .poll(async () => (await ppFx(page)).doorOpenDeg)
      .toBeLessThan(feedback.door.openAngleDeg);
    // Half the opening time later it is part open, then it is open and stays open.
    await ppAdvance(page, Math.ceil(feedback.door.openMs / 2 / STEP_MS));
    await expect
      .poll(async () => {
        const { doorOpenDeg } = await ppFx(page);
        return doorOpenDeg > 0 && doorOpenDeg < feedback.door.openAngleDeg;
      })
      .toBe(true);
    await ppAdvance(page, Math.ceil(feedback.door.openMs / STEP_MS));
    await expect
      .poll(async () => (await ppFx(page)).doorOpenDeg)
      .toBeCloseTo(feedback.door.openAngleDeg, 5);

    // The door knocked the toy and the book over; with the mug that is three messes, three markers.
    await ppAdvance(page, 300);
    const world = await ppWorld(page);
    expect(
      world.props
        .filter((prop) => prop.isMess)
        .map((prop) => prop.id)
        .sort(),
    ).toEqual(['book_01', 'mug_01', 'toy_01']);
    expect(world.mess.propsOnFloor).toBe(liveFeel.endOfLevel.doorSpillCount + 1);
    await expect(shownMarkers(page)).toHaveCount(3);
    await expect(html(page)).not.toHaveAttribute('data-pp-props-tidied', /.+/);

    // A real tap on the mug: Papa walks to it, tidies it, the marker goes, the mirror counts it.
    const mug = world.props.find((prop) => prop.id === 'mug_01');
    if (mug === undefined) throw new Error('no mug');
    const at = await pagePointOf(page, mug.xM, mug.yM, mug.zM);
    await page.mouse.click(at.x, at.y);
    await ppAdvance(page, 400);
    await expect(html(page)).toHaveAttribute('data-pp-props-tidied', '1');
    await expect(shownMarkers(page)).toHaveCount(2);

    // A real key: Space tidies the nearest mess within reach.
    await page.keyboard.press('Space');
    await ppAdvance(page, 400);
    await expect(html(page)).toHaveAttribute('data-pp-props-tidied', '2');

    // The last one by command; then the photo.
    const last = (await ppWorld(page)).props.find((prop) => prop.isMess);
    if (last === undefined) throw new Error('nothing left to tidy');
    await ppSend(page, { type: 'TapObject', t: (await ppWorld(page)).time.sim, objectId: last.id });
    await ppAdvance(page, 400);
    await expect(html(page)).toHaveAttribute('data-pp-props-tidied', '3');
    await expect(shownMarkers(page)).toHaveCount(0);
    expect((await ppWorld(page)).mess.propsOnFloor).toBe(0);

    await advanceTo(page, LEVEL_DURATION_MS - STEP_MS);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'finalRush');
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'photo');
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'timer');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    const events = await ppEvents(page);
    expect(events.filter((event) => event.type === 'LevelEnded')).toEqual([
      { type: 'LevelEnded', t: LEVEL_DURATION_MS, reason: 'timer' },
    ]);
    const scored = events.find((event) => event.type === 'LevelScored');
    expect(scored).toMatchObject({ sighPoints: 0 });
    // The door stays open through the photo.
    expect((await ppFx(page)).doorOpenDeg).toBeCloseTo(feedback.door.openAngleDeg, 5);
    expect(problems).toEqual([]);
  });

  test('under reduced motion the door jumps open and the timer does not pulse', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openRush(page);
    await emulateReducedMotion(page);
    await ppAdvance(page, 1);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'finalRush');
    await expect
      .poll(async () => (await ppFx(page)).doorOpenDeg)
      .toBeCloseTo(feedback.door.openAngleDeg, 5);
    await expect(page.locator(TIMER)).toHaveClass(/pp-hud-timer--rush/);
    await expect
      .poll(() => page.locator(TIMER).evaluate((node) => getComputedStyle(node).animationName))
      .toBe('none');
  });

  test('keeps the timer pulsing, and the door swinging, when motion is not reduced', async ({
    page,
  }) => {
    await openRush(page);
    await ppAdvance(page, 1);
    await expect
      .poll(() => page.locator(TIMER).evaluate((node) => getComputedStyle(node).animationName))
      .not.toBe('none');
    // Half the opening time after the rush began, the door is on its way: neither shut nor open.
    await ppAdvance(page, Math.ceil(feedback.door.openMs / 2 / STEP_MS));
    await expect
      .poll(async () => {
        const { doorOpenDeg } = await ppFx(page);
        return doorOpenDeg > 0 && doorOpenDeg < feedback.door.openAngleDeg;
      })
      .toBe(true);
  });
});
