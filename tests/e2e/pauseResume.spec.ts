import { expect, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';
import {
  html,
  OVERRUN_MARGIN_MS,
  pauseButton,
  sceneShot,
  setVisibility,
  startLevel,
  startWalking,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';

/** A frame or so of tolerance on the measured countdown (frames are 16.7 ms apart at 60 Hz). */
const FRAME_SLACK_MS = 50;
const FRAMES_TO_SETTLE = 10;

test('pauses in the background, stays paused when back, and resumes through the panel and the countdown', async ({
  page,
}) => {
  await startLevel(page);
  await startWalking(page);

  // 1. The loop steps and the renderer draws: Papa walks.
  const firstShot = await sceneShot(page);
  await expect
    .poll(async () => (await sceneShot(page)).equals(firstShot), { message: 'Papa walks' })
    .toBe(false);
  // Still on his way when the game is paused: what moves again after the resume is the walk.
  await expect(html(page)).toHaveAttribute('data-pp-papa-state', 'walkPath');

  // 2. Going to the background pauses, opens the panel, and nothing moves any more.
  await setVisibility(page, 'hidden');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
  await expect(page.locator('.pp-panel')).toBeVisible();
  await waitFrames(page, FRAMES_TO_SETTLE);
  const pausedShot = await sceneShot(page);
  await waitFrames(page, FRAMES_TO_SETTLE);
  expect((await sceneShot(page)).equals(pausedShot)).toBe(true);

  // 3. Coming back does not resume: the panel waits for the player.
  await setVisibility(page, 'visible');
  await waitFrames(page, FRAMES_TO_SETTLE);
  await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
  await expect(page.locator('.pp-panel')).toBeVisible();
  expect((await sceneShot(page)).equals(pausedShot)).toBe(true);

  // 4. « Reprendre » starts the countdown; the game goes on only when it is over.
  await page.evaluate(() => {
    const marks: Array<{ ppState: string; atReal: number }> = [];
    new MutationObserver(() => {
      marks.push({
        ppState: document.documentElement.dataset.ppState ?? '',
        atReal: performance.now(),
      });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-pp-state'] });
    Object.assign(window, { ppStateMarks: marks });
  });
  await pauseButton(page, STRINGS['pause.resume']).click();
  await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
  await waitFrames(page, FRAMES_TO_SETTLE);
  // Mid-countdown nothing has moved: no step ran.
  expect((await sceneShot(page)).equals(pausedShot)).toBe(true);

  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
  });
  const marks = await page.evaluate(
    () =>
      (window as unknown as { ppStateMarks: Array<{ ppState: string; atReal: number }> })
        .ppStateMarks,
  );
  const resuming = marks.find((mark) => mark.ppState === 'resuming');
  const running = marks.find((mark) => mark.ppState === 'running');
  expect(resuming).toBeDefined();
  expect(running).toBeDefined();
  const countdownMs = (running?.atReal ?? 0) - (resuming?.atReal ?? 0);
  expect(countdownMs).toBeGreaterThanOrEqual(RESUME_COUNTDOWN_MS - FRAME_SLACK_MS);
  expect(countdownMs).toBeLessThanOrEqual(RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS);
  await expect(page.locator('.pp-pause-screen')).toHaveCount(0);

  // 5. The sim runs again after the resume.
  await expect
    .poll(async () => (await sceneShot(page)).equals(pausedShot), {
      message: 'Papa walks again after the resume',
    })
    .toBe(false);
});
