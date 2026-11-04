import { expect, type Page, test } from '@playwright/test';
import { DRAW_CALLS_MAX, TRIANGLES_MAX } from '../../src/shared/constants.ts';
import { shot, typesOf } from './support/duel.ts';
import {
  collectProblems,
  html,
  OWN_WARNINGS,
  startLevel,
  threatIconPoint,
  waitFrames,
} from './support/game.ts';
import { ppAdvance, ppFreeze, ppLoadLevel, ppWorld, waitForTestApi } from './support/testApi.ts';

// « Grand salon avec cuisine ouverte » (story 9.1): the new room plays the salon's gameplay on the
// fixed camera. Whether the room looks right is Geo's call (the screenshots of the story); these
// tests prove that it is drawn within budget, that a real finger parries in it, and that a bot plays
// it to the end with no complaint from the asset loader.
const LEVEL = 'salon_kitchen';
const SEED = 42;
const QUERY = `?level=${LEVEL}`;
/** The level lasts `durationMs` of sim time; at speed 4 that is under a minute of real time. */
const AUTOPLAY_TIMEOUT_MS = 180_000;
/** The asset loader's own lines (`log.warn('assets', …)`): a malformed node, a missing material. */
const ASSETS_WARNING = /^\[assets\] /;

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

  test('a real tap parries the outlet on the fixed camera', async ({ page }, testInfo) => {
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
});
