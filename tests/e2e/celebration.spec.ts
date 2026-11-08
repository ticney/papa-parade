import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  html,
  LEVEL_DURATION_MS,
  recordVibrations,
  startLevel,
  THREATS_OFF,
  vibrations,
  waitForResultActions,
} from './support/game.ts';
import {
  ppAdvance,
  ppCueLog,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The level's finale on screen (story 7.4, AC 4 to 9 and 18): the cue `finale_reached` with its twins,
// the fireworks, Papa's victory dance, and the end of the level that waits for the celebration before the
// photo. A real finale takes a whole level to reach: `__PP__.celebrate()` plays the client half of one
// (the cue, the dance, the celebration) with no sim event; the bedroom's real `cycleDone` finale is pinned
// in `chambreNight.spec.ts`. WebKit has no `navigator.vibrate`: it checks the DOM and the cues only.

const LEVEL = 'salon_crawler';
const SEED = 42;
const FEEDBACK = JSON.parse(readFileSync('content/feedback.json', 'utf8')) as {
  celebration: {
    endHoldMs: number;
    musicMuteMs: number;
    fireworks: { bursts: { sparks: number }[] };
  };
  haptics: { fanfare: { patternMs: number[] } };
};
const { celebration } = FEEDBACK;
const SPARKS = celebration.fireworks.bursts.reduce((sum, burst) => sum + burst.sparks, 0);
// The stamp reads the strings file, a draft for Geo to change.
const STAMP_TEXT = (
  JSON.parse(readFileSync('content/strings.fr.json', 'utf8')) as Record<string, string>
)['stamp.finale'] as string;
/** Real time the page may take beyond a hold, frames and evaluates included. */
const MARGIN_MS = 3000;
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page, THREATS_OFF);
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

const celebrate = (page: Page): Promise<void> => page.evaluate(() => window.__PP__?.celebrate());

/** Steps the frozen level to `untilMs` of sim time, in chunks. */
async function advanceTo(page: Page, untilMs: number): Promise<void> {
  let remaining = Math.ceil((untilMs - (await ppWorld(page)).time.sim) / STEP_MS);
  while (remaining > 0) {
    const chunk = Math.min(3000, remaining);
    await ppAdvance(page, chunk);
    remaining -= chunk;
  }
}

test.describe('the celebration', () => {
  test('plays the cue with its twins, the fireworks, the stamp and Papa dances', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    await celebrate(page);
    const cue = (await ppCueLog(page)).find((record) => record.cueId === 'finale_reached');
    expect(cue?.visuals).toEqual(expect.arrayContaining(['soundWave', 'flash']));
    expect(cue?.haptic).toBe('fanfare');
    await expect(html(page)).toHaveAttribute('data-pp-finale', 'lastWave');
    await expect.poll(async () => (await ppFx(page)).fireworksAlive).toBe(SPARKS);
    const fx = await ppFx(page);
    expect(fx.celebrating).toBe(true);
    await expect.poll(async () => (await ppFx(page)).papaClip).toBe('victory_dance');
    await expect(page.locator('.pp-epic-stamp').last()).toHaveText(STAMP_TEXT);
    if (hasVibrate()) {
      expect(await vibrations(page)).toContainEqual(FEEDBACK.haptics.fanfare.patternMs);
    }
    // It ends by itself: the sparks die and nothing is left drawing.
    await expect
      .poll(async () => (await ppFx(page)).celebrating, {
        timeout: celebration.endHoldMs + MARGIN_MS,
      })
      .toBe(false);
    expect((await ppFx(page)).fireworksAlive).toBe(0);
    expect(problems).toEqual([]);
  });

  test('keeps a share of the sparks under reduced motion, and Papa still dances', async ({
    page,
  }) => {
    // The share itself is proven in `fireworks.test.ts`: here, only that the setting reaches the fireworks.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openFrozen(page);
    await celebrate(page);
    await expect.poll(async () => (await ppFx(page)).fireworksAlive).toBeGreaterThan(0);
    expect((await ppFx(page)).fireworksAlive).toBeLessThan(SPARKS);
    await expect.poll(async () => (await ppFx(page)).papaClip).toBe('victory_dance');
  });
});

test.describe('the end waits for it', () => {
  test('a level that ends during the celebration: the Result waits, then the photo flashes and the phases run', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page);
    await openFrozen(page);
    await advanceTo(page, LEVEL_DURATION_MS - 300);
    await celebrate(page);
    const flashesBefore = Number((await html(page).getAttribute('data-pp-flash-count')) ?? 0);
    await advanceTo(page, LEVEL_DURATION_MS + 20);
    // The level is over but the room is still on screen, the end held.
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'timer');
    await expect(html(page)).toHaveAttribute('data-pp-end-hold', 'on');
    // One read, so a slow machine cannot slip the end between them.
    expect(
      await page.evaluate(() => {
        const { dataset } = document.documentElement;
        return { hold: dataset.ppEndHold, app: dataset.ppApp, photo: dataset.ppPhoto ?? null };
      }),
    ).toEqual({ hold: 'on', app: 'level', photo: null });
    // Nothing pauses it: neither the pause button nor a hidden page.
    await page.locator('.pp-hud-row .pp-button').click({ force: true });
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      // Back to the prototype's getter.
      Reflect.deleteProperty(document, 'visibilityState');
    });
    expect(await html(page).getAttribute('data-pp-state')).toBe('running');
    // Then the end runs: the photo, its flash, the Result.
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result', {
      timeout: celebration.endHoldMs + MARGIN_MS,
    });
    await expect(html(page)).not.toHaveAttribute('data-pp-end-hold', /.+/);
    await expect(html(page)).toHaveAttribute('data-pp-photo', 'taken');
    await expect
      .poll(async () => Number(await html(page).getAttribute('data-pp-flash-count')))
      .toBeGreaterThan(flashesBefore);
    // The photo holds no firework: the effects were reset before it was taken.
    expect((await ppFx(page)).fireworksAlive).toBe(0);
    await waitForResultActions(page);
    await expect(html(page)).toHaveAttribute('data-pp-result', 'actions');
    expect(problems).toEqual([]);
  });

  test('with no celebration the end is at once, as before', async ({ page }) => {
    await openFrozen(page);
    // The loop stops at the end: no step can be asked for past it.
    await advanceTo(page, LEVEL_DURATION_MS);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    expect(await html(page).getAttribute('data-pp-end-hold')).toBeNull();
  });
});
