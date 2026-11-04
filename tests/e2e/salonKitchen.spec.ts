import { expect, type Page, test } from '@playwright/test';
import { DRAW_CALLS_MAX, TRIANGLES_MAX } from '../../src/shared/constants.ts';
import { shot, typesOf } from './support/duel.ts';
import {
  collectProblems,
  html,
  OWN_WARNINGS,
  objectIconPoint,
  startLevel,
  threatIconPoint,
  waitFrames,
} from './support/game.ts';
import {
  ppAdvance,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppPagePoint,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// « Grand salon avec cuisine ouverte » (story 9.1): the new room plays the salon's gameplay. Whether
// the room looks right is Geo's call (the screenshots of the story); these tests prove that it is
// drawn within budget, that a real finger parries in it, and that a bot plays it to the end with no
// complaint from the asset loader. Since story 9.2 its camera follows Papa: the last tests prove that
// the camera moves with him, never turns, and that a real finger still lands where it aims.
const LEVEL = 'salon_kitchen';
const SEED = 42;
const QUERY = `?level=${LEVEL}`;
/** The level lasts `durationMs` of sim time; at speed 4 that is under a minute of real time. */
const AUTOPLAY_TIMEOUT_MS = 180_000;
/** The asset loader's own lines (`log.warn('assets', …)`): a malformed node, a missing material. */
const ASSETS_WARNING = /^\[assets\] /;

/** The coffee machine's icon point (its anchor), at the kitchen end. */
const COFFEE_MACHINE = [-6.4, 1.05, -2] as const;
/** A walkable point at the kitchen end, and one nearby to tap, away from every object. */
const KITCHEN_END = [-5.5, -1.5] as const;
const FLOOR_POINT = [-4.5, -1] as const;
/** Papa's states in which the client sends no floor, object or baby tap. */
const BUSY = ['drink', 'asleep', 'onPhone', 'onToilet'];

/**
 * Walks Papa to the kitchen end (a `TapFloor` sent through `__PP__`), a few steps at a time with a
 * frame between them so the camera follows, then lets it settle (more than a second of sim time:
 * the follow snaps to its goal). `each` runs after every chunk.
 */
async function walkToKitchen(page: Page, each?: () => Promise<void>): Promise<void> {
  await ppSend(page, { type: 'TapFloor', xM: KITCHEN_END[0], zM: KITCHEN_END[1] });
  for (let i = 0; i < 200; i++) {
    await ppAdvance(page, 10);
    await waitFrames(page, 1);
    await each?.();
    const { papa } = await ppWorld(page);
    if (
      papa.state === 'idle' &&
      Math.hypot(papa.xM - KITCHEN_END[0], papa.zM - KITCHEN_END[1]) < 0.5
    ) {
      break;
    }
  }
  const { papa } = await ppWorld(page);
  expect(Math.hypot(papa.xM - KITCHEN_END[0], papa.zM - KITCHEN_END[1])).toBeLessThan(0.5);
  await ppAdvance(page, 150);
  await waitFrames(page, 3);
}

async function openFrozen(page: Page): Promise<void> {
  await page.goto(`/${QUERY}`);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

test.describe('Grand salon avec cuisine', () => {
  test('?level= shows the room, within the render budget', async ({ page }, testInfo) => {
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await page.setViewportSize({ width: 844, height: 390 });
    await startLevel(page, QUERY);
    await expect(html(page)).toHaveAttribute('data-pp-level', LEVEL);
    const drawCalls = Number(await html(page).getAttribute('data-pp-draw-calls'));
    const triangles = Number(await html(page).getAttribute('data-pp-triangles'));
    expect(drawCalls).toBeGreaterThan(0);
    expect(drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
    expect(triangles).toBeGreaterThan(0);
    expect(triangles).toBeLessThanOrEqual(TRIANGLES_MAX);
    await shot(page, testInfo, 'salon-kitchen-room.png');
    expect(problems).toEqual([]);
  });

  test('a real tap parries the outlet', async ({ page }, testInfo) => {
    test.setTimeout(60_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await openFrozen(page);
    // The first wave draws the outlet or the stairs, one at a time: step until the outlet is open.
    let open: Awaited<ReturnType<typeof ppWorld>>['threats'][number] | undefined;
    for (let i = 0; i < 2000 && open === undefined; i++) {
      await ppAdvance(page, 5);
      open = (await ppWorld(page)).threats.find(
        (threat) => threat.state === 'windowOpen' && threat.anchorId === 'outlet_01',
      );
    }
    expect(open).toBeDefined();
    await waitFrames(page, 3);
    await shot(page, testInfo, 'salon-kitchen-threat.png');
    const resolvedBefore = (await typesOf(page, 'ResponseResolved')).length;
    const at = await threatIconPoint(page);
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 3);
    const answered = (
      (await typesOf(page, 'ResponseResolved')) as unknown as {
        threatId: number;
        quality: string;
      }[]
    ).slice(resolvedBefore);
    expect(answered.map((event) => event.threatId)).toEqual([open?.id]);
    expect(answered[0]?.quality).not.toBe('fail');
    expect(problems).toEqual([]);
  });

  test('the perfect bot reaches the Result with no warning from the asset loader', async ({
    page,
  }) => {
    test.setTimeout(AUTOPLAY_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    const assetWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'warning' && ASSETS_WARNING.test(message.text())) {
        assetWarnings.push(message.text());
      }
    });
    await page.goto(`/${QUERY}&autoplay=perfect&seed=${SEED}&speed=4&debug=1`);
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-level', LEVEL);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
      timeout: AUTOPLAY_TIMEOUT_MS,
    });
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'timer');
    expect(assetWarnings).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('the camera follows Papa to the kitchen end, without turning', async ({ page }) => {
    test.setTimeout(60_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await openFrozen(page);
    await waitFrames(page, 3);
    const atSpawn = await ppFx(page);
    expect(atSpawn.cameraMode).toBe('follow');
    await walkToKitchen(page, async () => {
      expect((await ppFx(page)).cameraYawDeg).toBe(0);
    });
    const atKitchen = await ppFx(page);
    expect(atKitchen.cameraMode).toBe('follow');
    expect(atKitchen.cameraYawDeg).toBe(0);
    expect(atKitchen.cameraZoom).toBe(1);
    expect(
      Math.hypot(
        atKitchen.cameraCentreXM - atSpawn.cameraCentreXM,
        atKitchen.cameraCentreZM - atSpawn.cameraCentreZM,
      ),
    ).toBeGreaterThan(1);
    // The object tap points were written again for the moved camera.
    const mirrored = await objectIconPoint(page, 'coffee_machine');
    const live = await ppPagePoint(page, ...COFFEE_MACHINE);
    expect(Math.abs(mirrored.x - live.x)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(mirrored.y - live.y)).toBeLessThanOrEqual(0.1);
    expect(problems).toEqual([]);
  });

  test('real taps hit the floor, a threat and an object on the moved camera', async ({ page }) => {
    test.setTimeout(90_000);
    const problems = collectProblems(page, { allowedErrors: OWN_WARNINGS });
    await openFrozen(page);
    await walkToKitchen(page);
    const journalOf = () => page.evaluate(() => window.__PP__?.journal()?.entries ?? []);

    // The floor: the world point under the finger, within 0.1 m.
    const floor = await ppPagePoint(page, FLOOR_POINT[0], 0, FLOOR_POINT[1]);
    await page.touchscreen.tap(floor.x, floor.y);
    await ppAdvance(page, 2);
    const taps = (await journalOf()).filter((entry) => entry.command.type === 'TapFloor');
    const tapped = taps.at(-1)?.command as { xM: number; zM: number } | undefined;
    expect(tapped).toBeDefined();
    expect(
      Math.hypot((tapped?.xM ?? 0) - FLOOR_POINT[0], (tapped?.zM ?? 0) - FLOOR_POINT[1]),
    ).toBeLessThan(0.1);

    // A threat, at its tap point mirrored for the camera as it is now.
    let open: Awaited<ReturnType<typeof ppWorld>>['threats'][number] | undefined;
    for (let i = 0; i < 2000 && open === undefined; i++) {
      await ppAdvance(page, 5);
      open = (await ppWorld(page)).threats.find(
        (threat) => threat.state === 'windowOpen' && threat.anchorId !== null,
      );
    }
    expect(open).toBeDefined();
    await waitFrames(page, 3);
    const resolvedBefore = (await typesOf(page, 'ResponseResolved')).length;
    const at = await threatIconPoint(page);
    await page.touchscreen.tap(at.x, at.y);
    await ppAdvance(page, 3);
    const answered = (
      (await typesOf(page, 'ResponseResolved')) as unknown as { threatId: number }[]
    ).slice(resolvedBefore);
    expect(answered.map((event) => event.threatId)).toEqual([open?.id]);

    // An object, once Papa is free to go to it (a busy Papa sends no object tap).
    for (let i = 0; i < 400 && BUSY.includes((await ppWorld(page)).papa.state); i++) {
      await ppAdvance(page, 10);
    }
    await ppAdvance(page, 150);
    await waitFrames(page, 3);
    const cup = await ppPagePoint(page, ...COFFEE_MACHINE);
    await page.touchscreen.tap(cup.x, cup.y);
    await ppAdvance(page, 2);
    const objectTaps = (await journalOf())
      .map((entry) => entry.command)
      .filter((command) => command.type === 'TapObject') as { objectId: string }[];
    expect(objectTaps.map((command) => command.objectId)).toEqual(['coffee_machine']);
    expect(problems).toEqual([]);
  });
});
