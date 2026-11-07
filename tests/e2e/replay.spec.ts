import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import {
  advanceToEnd,
  appUrl,
  collectProblems,
  cueCount,
  html,
  LEVEL_DURATION_MS,
  liveFeedback,
  mirrorWrites,
  recordMirrorWrites,
  recordVibrations,
  THREATS_OFF,
  vibrations,
} from './support/game.ts';
import { ppFreeze, ppHighlights, ppLoadLevel, waitForTestApi } from './support/testApi.ts';

// The highlight replay (story 3.9, FR38): between the stars and the buttons the Result screen replays up to
// three moments of the game, each in a separate sim restored from a snapshot, under a « REPLAY » banner. A
// frozen level is stepped to its end through the test API, but for the one test that needs stars. An idle game on the old salon with seed 1 lets every
// threat through and ends on `mamaHome` at 16.8 s, so its replay is the cascade of its gags (three moments,
// found with the headless scoring of `tests/bots/highlightReplayLive.test.ts`); a game with the threats off has
// no moment at all.

const LEVEL = 'salon_crawler';
const SEED = 1;
const SEQUENCE_TIMEOUT_MS = 40_000;
const BANNER = '.pp-replay-banner';
const PANEL = '.pp-result-panel';
const REPLAY_BUTTON = `${PANEL} .pp-result-actions .pp-button-primary`;
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const SHOTS_DIR = process.env.PP_SCREENSHOTS_DIR;
const GRACE_MARGIN_MS = 60;
const PERFECT_SPEED = 4;

/** The idle game with moments (`?speed` makes the replay itself shorter where a press has no race to win). */
async function openEnd(
  page: Page,
  options: { threatsOff?: boolean; speed?: number } = {},
): Promise<void> {
  const query = [
    options.threatsOff === true ? THREATS_OFF.slice(1) : '',
    options.speed === undefined ? '' : `speed=${options.speed}`,
  ]
    .filter((part) => part !== '')
    .join('&');
  await page.goto(appUrl(`/${query === '' ? '' : `?${query}`}`));
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await advanceToEnd(page);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
}

/** The moments the page picked; fails when there are fewer than `atLeast` (the seed's game changed). */
async function momentsOf(page: Page, atLeast: number) {
  const moments = await ppHighlights(page);
  expect(moments).not.toBeNull();
  expect((moments ?? []).length).toBeGreaterThanOrEqual(atLeast);
  return moments ?? [];
}

const waitForPhase = (page: Page, phase: string | RegExp, timeoutMs = SEQUENCE_TIMEOUT_MS) =>
  expect(html(page)).toHaveAttribute('data-pp-result', phase, { timeout: timeoutMs });

/** Presses Space once, as a player skipping (the Result screen's input grace is over by the replay). */
const press = (page: Page) => page.keyboard.press('Space');

test.describe('the highlight replay', () => {
  test('a game with moments goes photo, mama, rows, stars, replay, actions, and walks its moments in order', async ({
    page,
  }) => {
    // The perfect bot plays the whole level (at ×4), so the game earns stars and has dozens of perfects.
    test.setTimeout(LEVEL_DURATION_MS / PERFECT_SPEED + 90_000);
    await recordMirrorWrites(page, ['data-pp-result', 'data-pp-replay-moment']);
    const problems = collectProblems(page);
    await page.goto(appUrl(`/?autoplay=perfect&seed=${SEED}&speed=${PERFECT_SPEED}`));
    await waitForTestApi(page);
    await waitForPhase(page, 'actions', LEVEL_DURATION_MS / PERFECT_SPEED + 60_000);
    const moments = await momentsOf(page, 3);
    const writes = await mirrorWrites(page);
    expect(
      writes.filter(({ name }) => name === 'data-pp-result').map(({ value }) => value),
    ).toEqual(['photo', 'mama', 'rows', 'stars', 'replay', 'actions']);
    // 0 … n−1, then the mirror is removed (written as '' by the recorder).
    expect(
      writes.filter(({ name }) => name === 'data-pp-replay-moment').map(({ value }) => value),
    ).toEqual([...moments.map((_moment, index) => String(index)), '']);
    // The moments are in chronological order and spaced, as the rules say.
    const times = moments.map((moment) => moment.t);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    for (let index = 1; index < times.length; index++) {
      expect((times[index] as number) - (times[index - 1] as number)).toBeGreaterThanOrEqual(
        liveFeedback.replay.minSpacingMs,
      );
    }
    expect(moments.length).toBeLessThanOrEqual(liveFeedback.replay.momentCount);
    expect(problems).toEqual([]);
  });

  test('shows the REPLAY banner for the replay and only then, over the scene', async ({ page }) => {
    await openEnd(page);
    await expect(page.locator(BANNER)).toBeHidden();
    await waitForPhase(page, 'replay');
    const banner = page.locator(BANNER);
    await expect(banner).toBeVisible();
    await expect(banner).toHaveText('REPLAY');
    // The scrim, the panel, the polaroid and Mama are out of the way: the canvas is what is seen.
    await expect(page.locator(PANEL)).toBeHidden();
    await expect(page.locator('.pp-polaroid')).toBeHidden();
    await expect(page.locator('.pp-result-screen')).toHaveCSS(
      'background-color',
      'rgba(0, 0, 0, 0)',
    );
    // Inside the frame, whatever the phone.
    const box = await banner.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect((box?.x ?? -1) >= 0 && (box?.y ?? -1) >= 0).toBe(true);
    expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(viewport?.width ?? 0);
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(viewport?.height ?? 0);
    // Still there for the whole replay, gone once the buttons are up.
    await press(page);
    await expect(banner).toBeVisible();
    await press(page);
    await waitForPhase(page, 'actions');
    await expect(banner).toBeHidden();
    await expect(page.locator(PANEL)).toBeVisible();
  });

  test('one press moves to the next moment, a second goes to the buttons without pressing « Rejouer »', async ({
    page,
  }) => {
    await openEnd(page);
    await momentsOf(page, 2);
    await waitForPhase(page, 'replay');
    await expect(html(page)).toHaveAttribute('data-pp-replay-moment', '0');
    await press(page);
    await expect(html(page)).toHaveAttribute('data-pp-replay-moment', '1');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'replay');
    const appBefore = await html(page).getAttribute('data-pp-app');
    await press(page);
    await waitForPhase(page, 'actions');
    await expect(page.locator(REPLAY_BUTTON)).toBeFocused();
    await expect(html(page)).not.toHaveAttribute('data-pp-replay-moment', /.*/);
    // The press that ended it did not start a new game.
    await page.waitForTimeout(liveFeedback.resultScreen.inputGraceMs + GRACE_MARGIN_MS);
    await expect(html(page)).toHaveAttribute('data-pp-app', appBefore ?? 'result');
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
  });

  test('a press before the replay goes straight to the buttons, with no replay phase', async ({
    page,
  }) => {
    await recordMirrorWrites(page, ['data-pp-result', 'data-pp-replay-moment']);
    await openEnd(page);
    await momentsOf(page, 1);
    await waitForPhase(page, /rows|stars/);
    await press(page);
    await waitForPhase(page, 'actions');
    await page.waitForTimeout(liveFeedback.replay.delayMs + 500);
    const writes = await mirrorWrites(page);
    expect(writes.map(({ value }) => value)).not.toContain('replay');
    expect(writes.filter(({ name }) => name === 'data-pp-replay-moment')).toEqual([]);
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
  });

  test('leaves the live game as it was: the same journal, the same world, the same cues and vibrations', async ({
    page,
  }) => {
    await recordVibrations(page);
    await openEnd(page, { speed: 4 });
    const journalBefore = await page.evaluate(() => window.__PP__?.journal());
    const worldBefore = await page.evaluate(() => JSON.stringify(window.__PP__?.state()));
    await waitForPhase(page, 'replay');
    const cuesAtReplay = await cueCount(page);
    const vibrationsAtReplay = (await vibrations(page)).length;
    const counts = () =>
      page.evaluate(() => ({
        stamps: document.documentElement.dataset.ppStampCount,
        flashes: document.documentElement.dataset.ppFlashCount,
      }));
    const countsAtReplay = await counts();
    await waitForPhase(page, 'actions');
    // The replay played sounds and puffs, but the controller did not buzz and nothing was counted.
    expect(await cueCount(page)).toBe(cuesAtReplay);
    expect((await vibrations(page)).length).toBe(vibrationsAtReplay);
    expect(await counts()).toEqual(countsAtReplay);
    expect(await page.evaluate(() => window.__PP__?.journal())).toEqual(journalBefore);
    expect(await page.evaluate(() => JSON.stringify(window.__PP__?.state()))).toBe(worldBefore);
  });

  test('a game with no moment has no replay phase', async ({ page }) => {
    await recordMirrorWrites(page, ['data-pp-result', 'data-pp-replay-moment']);
    await openEnd(page, { threatsOff: true });
    expect(await ppHighlights(page)).toEqual([]);
    await waitForPhase(page, 'actions');
    const writes = await mirrorWrites(page);
    expect(
      writes.filter(({ name }) => name === 'data-pp-result').map(({ value }) => value),
    ).toEqual(['photo', 'mama', 'rows', 'stars', 'actions']);
    expect(writes.filter(({ name }) => name === 'data-pp-replay-moment')).toEqual([]);
    await expect(page.locator(BANNER)).toBeHidden();
  });

  test('a portrait rebuild during the replay lands on the buttons, and the moments stay the same', async ({
    page,
  }) => {
    await openEnd(page);
    const moments = await momentsOf(page, 2);
    await waitForPhase(page, 'replay');
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    await expect(page.locator(BANNER)).toBeHidden();
    await expect(html(page)).not.toHaveAttribute('data-pp-replay-moment', /.*/);
    // The rebuilt screen reuses the pick: no second one.
    expect(await ppHighlights(page)).toEqual(moments);
    await expect(page.locator('#pp-hud')).toBeHidden();
  });

  test('« Rejouer » after a replay starts a new game with no replay left over', async ({
    page,
  }) => {
    await openEnd(page, { speed: 4 });
    await waitForPhase(page, 'actions');
    await page.waitForTimeout(liveFeedback.resultScreen.inputGraceMs + GRACE_MARGIN_MS);
    await page.locator(REPLAY_BUTTON).click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', { timeout: 20_000 });
    expect(await ppHighlights(page)).toBeNull();
    await expect(html(page)).not.toHaveAttribute('data-pp-replay-moment', /.*/);
  });
});

// The screenshots of the story (look at them, say what you saw): written only when asked,
// `PP_SCREENSHOTS_DIR=<dir> npm run e2e -- tests/e2e/replay.spec.ts --project=chromium -g screenshots`.
test.describe('a moment in a picture', () => {
  test.skip(SHOTS_DIR === undefined, 'set PP_SCREENSHOTS_DIR to take the screenshots of story 3.9');
  const VIEWPORTS = [
    { width: 844, height: 390 },
    { width: 750, height: 340 },
  ];
  for (const viewport of VIEWPORTS) {
    test(`screenshots: a replayed moment with the banner at ${viewport.width} × ${viewport.height}`, async ({
      page,
    }) => {
      const dir = SHOTS_DIR as string;
      mkdirSync(dir, { recursive: true });
      await page.setViewportSize(viewport);
      await openEnd(page);
      await waitForPhase(page, 'replay');
      for (const [index, atMs] of [
        [0, 1500],
        [1, 1500],
      ] as const) {
        await expect(html(page)).toHaveAttribute('data-pp-replay-moment', String(index));
        await page.waitForTimeout(atMs);
        await page.screenshot({
          path: `${dir}/moment-${index}-${viewport.width}x${viewport.height}.png`,
        });
        await press(page);
      }
      // The end of the game is back behind the buttons: the frozen live world through the game camera.
      await waitForPhase(page, 'actions');
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `${dir}/actions-after-replay-${viewport.width}x${viewport.height}.png`,
      });
    });
  }
});
