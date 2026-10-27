import { expect, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';
import {
  anchorMirror,
  babyAt,
  collectProblems,
  html,
  liveFeel,
  OVERRUN_MARGIN_MS,
  pauseButton,
  sceneShot,
  startLevel,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';

const FEEL = liveFeel.baby;
const spawn = anchorMirror('baby_spawn');
/** Frames the scene is watched while paused, enough for a crawling baby to move visibly. */
const FRAMES_PAUSED = 30;
/**
 * A wander ends at most `wanderMaxDistM` away as the crow flies (plus a cell), and furniture makes
 * the path longer: three times the straight distance is a generous bound for the living room. It
 * catches a baby who never arrives, it is not a duration to wait for.
 */
const DETOUR_FACTOR = 3;
const WANDER_BOUND_MS =
  ((FEEL.wanderMaxDistM * DETOUR_FACTOR) / FEEL.crawlSpeedMps) * 1000 + OVERRUN_MARGIN_MS;

test.describe('the baby lives in the living room', () => {
  test.setTimeout(60_000);

  test('sits at the baby_spawn anchor, babbling, when the level opens', async ({ page }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'babble');
    expect(await babyAt(page)).toEqual(spawn);
    expect(problems).toEqual([]);
  });

  test('sets off after its first babble, arrives somewhere else and babbles again, with no input', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    // `startLevel` returns once the countdown is over: the sim has just started running.
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'wander', {
      timeout: FEEL.babbleMinMs + RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'babble', {
      timeout: WANDER_BOUND_MS,
    });
    expect(await babyAt(page)).not.toEqual(spawn);
    expect(problems).toEqual([]);
  });

  test('freezes with the pause: its state, its position and the picture of the room', async ({
    page,
  }) => {
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'wander', {
      timeout: FEEL.babbleMinMs + RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await waitFrames(page, FRAMES_PAUSED);
    const stateBefore = await html(page).getAttribute('data-pp-baby-state');
    const atBefore = await babyAt(page);
    const shot = await sceneShot(page);
    await waitFrames(page, FRAMES_PAUSED);
    expect(await html(page).getAttribute('data-pp-baby-state')).toBe(stateBefore);
    expect(await babyAt(page)).toEqual(atBefore);
    expect((await sceneShot(page)).equals(shot)).toBe(true);
  });

  test('« Recommencer » puts the baby back at the spawn, babbling', async ({ page }) => {
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'wander', {
      timeout: FEEL.babbleMinMs + RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'babble', {
      timeout: WANDER_BOUND_MS,
    });
    expect(await babyAt(page)).not.toEqual(spawn);

    await page.keyboard.press('Escape');
    await pauseButton(page, STRINGS['pause.restart']).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'babble');
    expect(await babyAt(page)).toEqual(spawn);
  });
});
