import { expect, type Page, test } from '@playwright/test';
import {
  advanceToEnd,
  appHistory,
  canvasPoint,
  collectProblems,
  cueCount,
  hapticPatternOf,
  html,
  liveFeedback,
  liveFeel,
  recordAppStates,
  recordVibrations,
  stubGamepad,
  vibrations,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSetFeel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// Mama's note and the Result screen (story 1.22). A frozen level is stepped to its end through the
// test API; nothing waits on a fixed delay: the sequence is followed through `data-pp-result`. The
// score depends on the tuning, so no score is pinned: every bound is read from the live content.

const LEVEL = 'salon_crawler';
const SEED = 42;
const PANEL = '.pp-result-panel';
const REPLAY = `${PANEL} .pp-result-actions .pp-button-primary`;
/** Five thresholds every game reaches: all five stars, for the tests of the stamps. */
const EVERY_STAR = [1, 2, 3, 4, 5];
/** Long enough for the whole sequence on a loaded machine; it never waits this long on success. */
const SEQUENCE_TIMEOUT_MS = 15_000;
/** Real ms past the input grace of the live content, for a press that must count. */
const GRACE_MARGIN_MS = 60;
const PORTRAIT = { width: 390, height: 844 };
const LANDSCAPE = { width: 844, height: 390 };

interface Scored {
  laughPoints: number;
  babyStatePoints: number;
  sighPoints: number;
  screamPoints: number;
  scorePoints: number;
  stars: number;
}

/** Opens the game on a frozen level, optionally with a feel patch, and steps it to its end. */
async function openResult(page: Page, patch?: Parameters<typeof ppSetFeel>[1]): Promise<Scored> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  if (patch !== undefined) await ppSetFeel(page, patch);
  await advanceToEnd(page);
  await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
  const scored = (await ppEvents(page)).find((event) => event.type === 'LevelScored');
  if (scored === undefined) throw new Error('no LevelScored at the end of the level');
  return scored as unknown as Scored;
}

/**
 * A press that starts within `inputGraceMs` of the screen (or of its buttons) coming up is ignored
 * on purpose: the specs that press wait it out, whatever Geo sets it to.
 */
const waitForInputGrace = (page: Page): Promise<void> =>
  page.waitForTimeout(liveFeedback.resultScreen.inputGraceMs + GRACE_MARGIN_MS);

/** The buttons are up and their grace is over: « Rejouer » now answers a press. */
async function waitForActions(page: Page): Promise<void> {
  await expect(html(page)).toHaveAttribute('data-pp-result', 'actions', {
    timeout: SEQUENCE_TIMEOUT_MS,
  });
  await waitForInputGrace(page);
}

test.describe('the Result screen', () => {
  test('shows Mama’s note: four rows from LevelScored and the live feel that add up, the stars, then « Rejouer » focused', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const scored = await openResult(page);
    await expect(page.locator('#pp-hud')).toBeHidden();
    await expect(html(page)).toHaveAttribute('data-pp-score', String(scored.scorePoints));
    await expect(html(page)).toHaveAttribute('data-pp-stars', String(scored.stars));
    await waitForActions(page);

    const { mama } = liveFeel;
    await expect(page.locator(`${PANEL} .pp-score-label`)).toHaveText([
      STRINGS['result.score_laughs'] as string,
      STRINGS['result.score_baby_state'] as string,
      STRINGS['result.score_no_sigh'] as string,
      STRINGS['result.score_no_scream'] as string,
    ]);
    const rows = [
      scored.laughPoints,
      scored.babyStatePoints,
      mama.sighMaxPoints - scored.sighPoints,
      mama.screamMaxPoints - scored.screamPoints,
    ];
    await expect(page.locator(`${PANEL} .pp-score-value`)).toHaveText(rows.map(String));
    await expect(page.locator(`${PANEL} .pp-score-max`)).toHaveText(
      [mama.laughMaxPoints, mama.babyStateMaxPoints, mama.sighMaxPoints, mama.screamMaxPoints].map(
        (max) => `/${max}`,
      ),
    );
    expect(rows.reduce((sum, value) => sum + value, 0)).toBe(scored.scorePoints);
    await expect(page.locator(`${PANEL} .pp-score-total-value`)).toHaveText(
      String(scored.scorePoints),
    );

    await expect(page.locator(`${PANEL} .pp-star-earned`)).toHaveCount(scored.stars);

    const replay = page.locator(REPLAY);
    await expect(replay).toBeFocused();
    await expect(replay).toHaveText(STRINGS['result.replay_button'] as string);
    const box = await replay.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText(STRINGS['result.copy_log'] as string)).toHaveCount(0);

    const smallest = await page.evaluate((selector) => {
      const panel = document.querySelector(selector);
      if (panel === null) return null;
      const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
      const sizes: number[] = [];
      for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (node.textContent?.trim() === '' || node.parentElement === null) continue;
        sizes.push(Number.parseFloat(getComputedStyle(node.parentElement).fontSize));
      }
      return sizes.length === 0 ? null : Math.min(...sizes);
    }, PANEL);
    const textMinPx = await page.evaluate(() =>
      Number.parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--pp-spacing-text-min'),
      ),
    );
    expect(textMinPx).toBe(16);
    expect(smallest).toBeGreaterThanOrEqual(textMinPx);
    expect(problems).toEqual([]);
  });

  test('stamps each star with its cue, the last one marked: the light vibration, then the heavy one', async ({
    page,
    browserName,
  }) => {
    await recordVibrations(page);
    const scored = await openResult(page, { mama: { starThresholdPoints: EVERY_STAR } });
    expect(scored.stars).toBe(EVERY_STAR.length);
    // The level's own vibrations are behind: only the stamps come from here.
    const vibrationsBefore = (await vibrations(page)).length;
    const cuesBefore = await cueCount(page);
    await waitForActions(page);
    expect(await cueCount(page)).toBe(cuesBefore + scored.stars);
    // Five stars, whatever the game: the outline of every star is the ink (a star on cream is 1.6:1).
    const strokes = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--pp-color-ink)';
      document.body.append(probe);
      const ink = getComputedStyle(probe).color;
      probe.remove();
      const stars = [...document.querySelectorAll('.pp-star-earned')];
      return { ink, strokes: stars.map((star) => getComputedStyle(star).stroke) };
    });
    expect(strokes.strokes).toHaveLength(EVERY_STAR.length);
    for (const stroke of strokes.strokes) expect(stroke).toBe(strokes.ink);
    if (browserName === 'chromium') {
      const light = hapticPatternOf('ResultStarStamped');
      const heavy = hapticPatternOf('ResultLastStarStamped');
      expect(light).not.toBeNull();
      expect(heavy).not.toBeNull();
      expect((await vibrations(page)).slice(vibrationsBefore)).toEqual([
        ...Array.from({ length: scored.stars - 1 }, () => light),
        heavy,
      ]);
    }
  });

  test('a press on the screen skips the sequence at once, silently, without pressing « Rejouer »', async ({
    page,
  }) => {
    await recordVibrations(page);
    await openResult(page, { mama: { starThresholdPoints: EVERY_STAR } });
    await recordAppStates(page);
    await expect(html(page)).toHaveAttribute('data-pp-result', 'rows');
    const cuesBefore = await cueCount(page);
    const vibrationsBefore = (await vibrations(page)).length;
    await waitForInputGrace(page);
    await expect(html(page)).toHaveAttribute('data-pp-result', /rows|stars/);
    await page.locator(`${PANEL} .pp-score-card`).click();
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    await expect(page.locator(`${PANEL} .pp-star-earned`)).toHaveCount(EVERY_STAR.length);
    await expect(page.locator(`${PANEL} .pp-star-stamped`)).toHaveCount(0);
    await expect(page.locator(REPLAY)).toBeFocused();
    expect(await cueCount(page)).toBe(cuesBefore);
    expect((await vibrations(page)).length).toBe(vibrationsBefore);
    expect(await appHistory(page)).not.toContain('loading');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
  });

  test.describe('« Rejouer » starts the level again, without a reload, with a new seed', () => {
    const replays: [string, (page: Page) => Promise<void>][] = [
      ['a touch', (page) => page.locator(REPLAY).click()],
      ['Enter', (page) => page.keyboard.press('Enter')],
    ];
    for (const [how, press] of replays) {
      test(`with ${how}`, async ({ page }) => {
        await openResult(page);
        await waitForActions(page);
        await page.evaluate(() => Object.assign(window, { __ppMarker: 1 }));
        await recordAppStates(page);
        await press(page);
        await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
        expect(await appHistory(page)).toEqual(['loading', 'level']);
        expect(await page.evaluate(() => (window as { __ppMarker?: number }).__ppMarker)).toBe(1);
        await expect(html(page)).not.toHaveAttribute('data-pp-seed', String(SEED));
        await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
        await expect(html(page)).not.toHaveAttribute('data-pp-score', /.*/);
        await expect(html(page)).not.toHaveAttribute('data-pp-result', /.*/);
      });
    }

    test('with a pad: A skips, then A replays', async ({ page }) => {
      const pad = await stubGamepad(page);
      await openResult(page);
      await pad.setPadPresent(true);
      await recordAppStates(page);
      await expect(html(page)).toHaveAttribute('data-pp-result', 'rows');
      await waitForInputGrace(page);
      await pad.tapButton(0);
      await waitForActions(page);
      expect(await appHistory(page)).toEqual([]);
      await pad.tapButton(0);
      await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
      expect(await appHistory(page)).toEqual(['loading', 'level']);
    });
  });

  test('a screen rebuilt by the portrait overlay in the middle of the stars shows the end at once: no star stamps twice', async ({
    page,
  }) => {
    await recordVibrations(page);
    await openResult(page, { mama: { starThresholdPoints: EVERY_STAR } });
    await expect(html(page)).toHaveAttribute('data-pp-result', 'stars', {
      timeout: SEQUENCE_TIMEOUT_MS,
    });
    await page.setViewportSize(PORTRAIT);
    await expect(page.locator('.pp-portrait-screen')).toBeVisible();
    // The Result screen is gone with its timers: nothing stamps behind the portrait overlay.
    const cuesBefore = await cueCount(page);
    const vibrationsBefore = (await vibrations(page)).length;
    await page.setViewportSize(LANDSCAPE);
    await expect(page.locator(PANEL)).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    await expect(page.locator(`${PANEL} .pp-star-earned`)).toHaveCount(EVERY_STAR.length);
    await expect(page.locator(`${PANEL} .pp-star-stamped`)).toHaveCount(0);
    await expect(page.locator(REPLAY)).toBeFocused();
    expect(await cueCount(page)).toBe(cuesBefore);
    expect((await vibrations(page)).length).toBe(vibrationsBefore);
  });

  test('a tap on the floor behind the Result screen plans no path: it skips the sequence and nothing more', async ({
    page,
  }) => {
    await openResult(page);
    await expect(html(page)).toHaveAttribute('data-pp-result', 'rows');
    const plannedBefore = (await ppEvents(page)).filter(
      (event) => event.type === 'PapaPathPlanned',
    ).length;
    const timeBefore = (await ppWorld(page)).time.sim;
    await waitForInputGrace(page);
    const point = await canvasPoint(page, 0.5, 0.35);
    await page.touchscreen.tap(point.x, point.y);
    await waitForActions(page);
    const events = await ppEvents(page);
    expect(events.filter((event) => event.type === 'PapaPathPlanned')).toHaveLength(plannedBefore);
    expect(events.filter((event) => event.type === 'LevelEnded')).toHaveLength(1);
    expect((await ppWorld(page)).time.sim).toBe(timeBefore);
  });

  test('under reduced motion, a star fades in: no stamp animation', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openResult(page, { mama: { starThresholdPoints: EVERY_STAR } });
    await waitForActions(page);
    const names = await page
      .locator(`${PANEL} .pp-star-stamped`)
      .evaluateAll((stars) => stars.map((star) => getComputedStyle(star).animationName));
    expect(names).toHaveLength(EVERY_STAR.length);
    for (const name of names) expect(name).toBe('pp-fade-in');
  });

  test('fits a short landscape phone (750 × 340) without scrolling', async ({ page }) => {
    await page.setViewportSize({ width: 750, height: 340 });
    await openResult(page);
    await waitForActions(page);
    const fit = await page.locator(PANEL).evaluate((panel) => ({
      scrollHeight: panel.scrollHeight,
      clientHeight: panel.clientHeight,
      bottom: panel.getBoundingClientRect().bottom,
      top: panel.getBoundingClientRect().top,
    }));
    expect(fit.scrollHeight).toBeLessThanOrEqual(fit.clientHeight);
    expect(fit.top).toBeGreaterThanOrEqual(0);
    expect(fit.bottom).toBeLessThanOrEqual(340);
    const box = await page.locator(REPLAY).boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(44);
    expect(box?.height).toBeGreaterThanOrEqual(44);
  });
});
