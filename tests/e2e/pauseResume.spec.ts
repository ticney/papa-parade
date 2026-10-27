import { expect, type Locator, type Page, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';

/** A frame or so of tolerance on the measured countdown (frames are 16.7 ms apart at 60 Hz). */
const FRAME_SLACK_MS = 50;
/** The countdown may overrun on a loaded CI machine; this only catches a countdown that never ends. */
const OVERRUN_MARGIN_MS = 2000;
const FRAMES_TO_SETTLE = 10;

function state(page: Page): Locator {
  return page.locator('html');
}

/** Waits for `count` display frames inside the page: a bounded count, never a timeout. */
function waitFrames(page: Page, count: number): Promise<void> {
  return page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames;
        const onFrame = (): void => {
          remaining--;
          if (remaining <= 0) resolve();
          else requestAnimationFrame(onFrame);
        };
        requestAnimationFrame(onFrame);
      }),
    count,
  );
}

function setVisibility(page: Page, visibilityState: 'hidden' | 'visible'): Promise<void> {
  return page.evaluate((next) => {
    // Headless browsers do not hide pages on demand: override the property and fire the event.
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => next });
    document.dispatchEvent(new Event('visibilitychange'));
  }, visibilityState);
}

test('pauses in the background, stays paused when back, and resumes after the countdown', async ({
  page,
}) => {
  await page.goto('/');
  await expect(state(page)).toHaveAttribute('data-pp-state', 'running');
  const canvas = page.locator('#pp-canvas');

  // 1. The loop steps and the renderer draws: the probe cube moves.
  const firstShot = await canvas.screenshot();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(firstShot), { message: 'the cube moves' })
    .toBe(false);

  // 2. Going to the background pauses, and nothing moves any more.
  await setVisibility(page, 'hidden');
  await expect(state(page)).toHaveAttribute('data-pp-state', 'paused');
  await waitFrames(page, FRAMES_TO_SETTLE);
  const pausedShot = await canvas.screenshot();
  await waitFrames(page, FRAMES_TO_SETTLE);
  expect((await canvas.screenshot()).equals(pausedShot)).toBe(true);

  // 3. Coming back does not resume.
  await setVisibility(page, 'visible');
  await waitFrames(page, FRAMES_TO_SETTLE);
  await expect(state(page)).toHaveAttribute('data-pp-state', 'paused');
  expect((await canvas.screenshot()).equals(pausedShot)).toBe(true);

  // 4. A tap starts the countdown; the game goes on only when it is over.
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
  await canvas.click();
  await expect(state(page)).toHaveAttribute('data-pp-state', 'resuming');
  await waitFrames(page, FRAMES_TO_SETTLE);
  // Mid-countdown nothing has moved: no step ran.
  expect((await canvas.screenshot()).equals(pausedShot)).toBe(true);

  await expect(state(page)).toHaveAttribute('data-pp-state', 'running', {
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

  // 5. The sim runs again after the resume.
  await expect
    .poll(async () => (await canvas.screenshot()).equals(pausedShot), {
      message: 'the cube moves again after the resume',
    })
    .toBe(false);
});
