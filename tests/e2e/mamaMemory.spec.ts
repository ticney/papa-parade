import { mkdirSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { calibratedSave, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import { advanceToEnd, appUrl, collectProblems, html } from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppMamaLines,
  ppSilenceCatastrophe,
  waitForTestApi,
} from './support/testApi.ts';

// Mama remembers (story 3.8, FR36): the lines she says for each reaction come from `content/mama-lines.json`,
// the most specific one that holds, and the save counts the games in which each gag happened. A frozen
// `salon_crawler` is stepped to its end with nobody answering, so the stairs threat times out and slides;
// the catastrophe gauge is silenced (a Mama come home early would pick between two lines at random, story 3.16
// D14). The lines the page chose are read from `__PP__.mamaLines()` and the known ones are pinned by id and
// text, so this spec does not copy how the product picks a line.

const LEVEL = 'salon_crawler';
const SEED = 42;
const SEQUENCE_TIMEOUT_MS = 15_000;
const BUBBLE_TEXT = '.pp-mum-bubble-text';
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };
const SHOTS_DIR = process.env.PP_SCREENSHOTS_DIR;

const FIRST_TIME = { lineId: 'stairs_first', text: "Pas si près de l'escalier !" };
const AGAIN = { lineId: 'stairs_again', text: "*Encore* l'escalier ?!" };

/** What the save remembers, as `localStorage` holds it. */
const counts = (page: Page): Promise<Record<string, number> | null> =>
  page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? 'null')?.mamaMemory?.counts ?? null,
    SAVE_STORAGE_KEY,
  );

/** The save as `localStorage` holds it. */
const storedSave = (page: Page): Promise<Record<string, unknown> | null> =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? 'null'), SAVE_STORAGE_KEY);

const stairsSlides = async (page: Page): Promise<number> =>
  (await ppEvents(page)).filter(
    (event) => event.type === 'GagTriggered' && event.gag === 'stairs_slide',
  ).length;

/** Loads the level, lets nobody answer to the end, and waits for the Result. */
async function playStairsGame(page: Page): Promise<void> {
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await ppSilenceCatastrophe(page);
  await advanceToEnd(page);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
  // The stairs threat timed out: that is the tag Mama remembers.
  expect(await stairsSlides(page)).toBeGreaterThan(0);
}

async function openGame(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
}

async function waitForActions(page: Page): Promise<void> {
  await expect(html(page)).toHaveAttribute('data-pp-result', 'actions', {
    timeout: SEQUENCE_TIMEOUT_MS,
  });
}

const screamOf = async (page: Page) => {
  const lines = await ppMamaLines(page);
  if (lines === null) throw new Error('__PP__.mamaLines() is null: no level was scored');
  return lines.find((line) => line.reaction === 'scream');
};

/** Seeds a save before the page loads, over the calibrated one every spec starts from. */
const seedSave = async (page: Page, save: unknown): Promise<void> => {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [SAVE_STORAGE_KEY, JSON.stringify(save)],
  );
};

test.describe('Mama’s memory', () => {
  test('the first time the stairs slide she says the first-time line, with no emphasis, and remembers one game (13a)', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openGame(page);
    expect(await counts(page)).toEqual({});
    await playStairsGame(page);
    expect(await screamOf(page)).toMatchObject(FIRST_TIME);
    await waitForActions(page);
    await expect(page.locator(BUBBLE_TEXT)).toHaveText(FIRST_TIME.text);
    await expect(page.locator(`${BUBBLE_TEXT} em`)).toHaveCount(0);
    await expect.poll(() => counts(page)).toMatchObject({ stairs_slide: 1 });
    expect(problems).toEqual([]);
  });

  test('with one game remembered she says « Encore l’escalier ?! » with Encore in an em, and the count becomes 2 (13b, seeded)', async ({
    page,
  }) => {
    await seedSave(page, calibratedSave({}, {}, { stairs_slide: 1 }));
    await openGame(page);
    await playStairsGame(page);
    expect(await screamOf(page)).toMatchObject(AGAIN);
    await waitForActions(page);
    await expect(page.locator(BUBBLE_TEXT)).toHaveText("Encore l'escalier ?!");
    await expect(page.locator(`${BUBBLE_TEXT} em`)).toHaveCount(1);
    await expect(page.locator(`${BUBBLE_TEXT} em`)).toHaveText('Encore');
    await expect.poll(() => counts(page)).toMatchObject({ stairs_slide: 2 });
  });

  test('a second game in the same page remembers the first one (13b, played)', async ({ page }) => {
    await openGame(page);
    await playStairsGame(page);
    expect(await screamOf(page)).toMatchObject(FIRST_TIME);
    await expect.poll(() => counts(page)).toMatchObject({ stairs_slide: 1 });
    await playStairsGame(page);
    expect(await screamOf(page)).toMatchObject(AGAIN);
    await waitForActions(page);
    await expect(page.locator(`${BUBBLE_TEXT} em`)).toHaveText('Encore');
    await expect.poll(() => counts(page)).toMatchObject({ stairs_slide: 2 });
  });

  test('a game counts once however many times the stairs slid in it', async ({ page }) => {
    await openGame(page);
    await playStairsGame(page);
    // The precondition that gives « 1 » its meaning: it slid more than once on SEED, and a count of
    // occurrences would be 2 or more. If a wave change loses it, pick another SEED here.
    expect(await stairsSlides(page)).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await counts(page))?.stairs_slide).toBe(1);
  });

  test('a level left before its end counts nothing (no LevelScored)', async ({ page }) => {
    await openGame(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    await ppSilenceCatastrophe(page);
    // Nobody answers until the stairs have slid, then the level is restarted, not finished.
    for (let chunk = 0; chunk < 150 && (await stairsSlides(page)) === 0; chunk++) {
      await ppAdvance(page, 50);
    }
    expect(await stairsSlides(page)).toBeGreaterThan(0);
    await ppLoadLevel(page, LEVEL, SEED);
    expect(await ppMamaLines(page)).toBeNull();
    expect(await counts(page)).toEqual({});
  });

  test('mamaLines() is null before the first level is scored and again once the next one loads', async ({
    page,
  }) => {
    await openGame(page);
    expect(await ppMamaLines(page)).toBeNull();
    await playStairsGame(page);
    expect(await ppMamaLines(page)).not.toBeNull();
    await ppLoadLevel(page, LEVEL, SEED);
    expect(await ppMamaLines(page)).toBeNull();
  });

  test('a v3 save is migrated to v4 with the calibration and the settings kept and an empty memory (13c)', async ({
    page,
  }) => {
    const v3 = {
      version: 3,
      calibration: {
        visualOffsetMs: 0,
        audioOffsetMs: 0,
        audioSkipped: true,
        measuredAt: '2026-01-01T00:00:00.000Z',
        device: 'web-touch',
      },
      settings: {
        tier: 'normal',
        volumes: { music: 40, sfx: 100, voice: 55, ui: 100 },
        haptics: false,
        reducedMotion: false,
        largeVerbs: true,
      },
    };
    const problems = collectProblems(page);
    await seedSave(page, v3);
    await page.goto(appUrl('/'));
    await expect(html(page)).toHaveAttribute('data-pp-app', 'start');
    // It was usable (no calibration screen in front of the start screen, nothing set aside) and written back as v4.
    await expect.poll(async () => (await storedSave(page))?.version).toBe(4);
    expect(await storedSave(page)).toEqual({
      ...v3,
      version: 4,
      mamaMemory: { counts: {} },
    });
    expect(await page.evaluate(() => localStorage.getItem('papa-parade.save.invalid'))).toBeNull();
    expect(problems).toEqual([]);
  });

  test('a screen rebuilt by the portrait overlay shows the same line and does not count the game again (13d)', async ({
    page,
  }) => {
    await openGame(page);
    await playStairsGame(page);
    const lines = await ppMamaLines(page);
    await expect.poll(() => counts(page)).toMatchObject({ stairs_slide: 1 });
    await waitForActions(page);
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator('.pp-result-panel')).toBeVisible();
    await expect(page.locator(BUBBLE_TEXT)).toHaveText(FIRST_TIME.text);
    expect(await ppMamaLines(page)).toEqual(lines);
    // Give a late write its chance to show: the count stays at 1.
    await page.waitForTimeout(300);
    expect(await counts(page)).toEqual(expect.objectContaining({ stairs_slide: 1 }));
  });

  test('?autoplay neither reads nor writes the memory (13e)', async ({ page }) => {
    // The player remembers a game; the bot picks from an empty memory and leaves the save alone.
    await seedSave(page, calibratedSave({}, {}, { stairs_slide: 1 }));
    await page.goto(appUrl('/?autoplay=idle&seed=42'));
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', { timeout: 20_000 });
    await ppFreeze(page, true);
    await ppSilenceCatastrophe(page);
    await advanceToEnd(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    expect(await stairsSlides(page)).toBeGreaterThan(0);
    // First-time line, not « Encore »: the memory it chose from was empty.
    expect(await screamOf(page)).toMatchObject(FIRST_TIME);
    await page.waitForTimeout(300);
    expect(await counts(page)).toEqual({ stairs_slide: 1 });
  });

  test('?autoplay from a fresh save writes no memory at all', async ({ page }) => {
    await page.goto(appUrl('/?autoplay=idle&seed=42'));
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', { timeout: 20_000 });
    await ppFreeze(page, true);
    await ppSilenceCatastrophe(page);
    await advanceToEnd(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    await page.waitForTimeout(300);
    expect(await counts(page)).toEqual({});
  });
});

// The screenshots of the story (look at the bubble, say what you saw): written only when asked,
// `PP_SCREENSHOTS_DIR=<dir> npm run e2e -- tests/e2e/mamaMemory.spec.ts --project=chromium -g screenshots`.
test.describe('the bubble in a picture', () => {
  test.skip(SHOTS_DIR === undefined, 'set PP_SCREENSHOTS_DIR to take the screenshots of story 3.8');
  const VIEWPORTS = [
    { width: 844, height: 390 },
    { width: 750, height: 340 },
  ];
  for (const viewport of VIEWPORTS) {
    test(`screenshots: the first-time and « Encore » bubbles at ${viewport.width} × ${viewport.height}`, async ({
      page,
    }) => {
      const dir = SHOTS_DIR as string;
      mkdirSync(dir, { recursive: true });
      await page.setViewportSize(viewport);
      await openGame(page);
      const shoot = async (name: string) => {
        await playStairsGame(page);
        await waitForActions(page);
        await page.waitForTimeout(400);
        await page.screenshot({ path: `${dir}/${name}-${viewport.width}x${viewport.height}.png` });
      };
      await shoot('first-time');
      await shoot('encore');
    });
  }
});
