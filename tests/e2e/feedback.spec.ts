import { expect, type Page, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';
import {
  audioState,
  collectProblems,
  cueCount,
  html,
  liveClipCount,
  liveFeedback,
  OVERRUN_MARGIN_MS,
  openGame,
  pauseButton,
  recordVibrations,
  setVisibility,
  startLevel,
  vibrations,
  WALK_BOUND_MS,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';

// Playwright cannot hear: the app mirrors what its audio engine, platform and feedback director do
// on `<html>` (`data-pp-audio`, `data-pp-babble`, `data-pp-cue`...), on events and never per frame.
// The live feedback table is read here, never copied. WebKit reports no `navigator.vibrate` and
// Chromium does (measured); the two projects assert each side.

const COUNTDOWN_TIMEOUT_MS = RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS;
const FRAMES_TO_SETTLE = 10;
const LIGHT_PATTERN = liveFeedback.haptics.light.patternMs;

const hasVibrate = (): boolean => test.info().project.name === 'chromium';

async function waitForRunning(page: Page): Promise<void> {
  await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
    timeout: COUNTDOWN_TIMEOUT_MS,
  });
}

test.describe('audio', () => {
  test('is created by the first gesture, preloaded in loading, and plays the loops once the level runs', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openGame(page);
    // Nothing exists before the first gesture: our code creates the context, not the browser.
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'none');
    await expect(html(page)).toHaveAttribute('data-pp-audio-clips', '0');
    await expect(html(page)).toHaveAttribute('data-pp-babble', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');

    await page.locator('.pp-start-screen').click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    // Every clip of the table was decoded during loading, before the countdown.
    await expect(html(page)).toHaveAttribute('data-pp-audio-clips', String(liveClipCount));
    // The countdown is silent: the context is suspended until it is over.
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'suspended');

    await waitForRunning(page);
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
    await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');
    expect(problems).toEqual([]);
  });

  test('is suspended by a pause, still suspended during the countdown, and back once it is over', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');

    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'suspended');

    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'resuming');
    expect(await audioState(page)).toBe('suspended');
    await waitForRunning(page);
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
    expect(problems).toEqual([]);
  });

  test('is suspended in the background, and back after the panel and the countdown', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);

    await setVisibility(page, 'hidden');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'suspended');
    await setVisibility(page, 'visible');
    await waitFrames(page, FRAMES_TO_SETTLE);
    expect(await audioState(page)).toBe('suspended');

    await pauseButton(page, STRINGS['pause.resume']).click();
    await waitForRunning(page);
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
    expect(problems).toEqual([]);
  });
});

test.describe('feedback', () => {
  test('reports whether the device can vibrate: Chromium yes, WebKit (Safari) no', async ({
    page,
  }) => {
    await openGame(page);
    await expect(html(page)).toHaveAttribute('data-pp-haptics', String(hasVibrate()));
  });

  test('Papa walking into a wall plays the bump: its cue, and its vibration where the device has one', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await startLevel(page);
    await expect(html(page)).toHaveAttribute('data-pp-cue', 'countdown_tick');
    const before = await cueCount(page);
    const vibrationsBefore = (await vibrations(page)).length;

    await page.keyboard.down('ArrowUp');
    await expect(html(page)).toHaveAttribute('data-pp-cue', liveFeedback.events.PapaBlocked, {
      timeout: WALK_BOUND_MS,
    });
    await page.keyboard.up('ArrowUp');
    expect(await cueCount(page)).toBeGreaterThan(before);

    const patterns = (await vibrations(page)).slice(vibrationsBefore);
    if (hasVibrate()) expect(patterns).toContainEqual(LIGHT_PATTERN);
    else expect(patterns).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('ticks once per countdown digit: three light vibrations over one pause and resume', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await startLevel(page);
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    const countBefore = await cueCount(page);
    const vibrationsBefore = (await vibrations(page)).length;

    await page.keyboard.press('Escape');
    await waitForRunning(page);
    await expect.poll(() => cueCount(page)).toBe(countBefore + 3);
    await expect(html(page)).toHaveAttribute('data-pp-cue', 'countdown_tick');
    await waitFrames(page, FRAMES_TO_SETTLE);
    expect(await cueCount(page)).toBe(countBefore + 3);

    const patterns = (await vibrations(page)).slice(vibrationsBefore);
    if (hasVibrate()) expect(patterns).toEqual([LIGHT_PATTERN, LIGHT_PATTERN, LIGHT_PATTERN]);
    else expect(patterns).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('« Recommencer » restarts the loops once, decodes nothing again, and raises no problem', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await startLevel(page);
    await page.keyboard.press('Escape');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    // Every value of the loop and clip mirrors from now on, in order.
    await page.evaluate(() => {
      const seen: Record<string, string[]> = { babble: [], music: [], clips: [] };
      Object.assign(window, { ppLoopHistory: seen });
      const names = {
        'data-pp-babble': 'babble',
        'data-pp-music': 'music',
        'data-pp-audio-clips': 'clips',
      };
      new MutationObserver((records) => {
        for (const record of records) {
          const name = names[record.attributeName as keyof typeof names];
          seen[name]?.push(
            document.documentElement.getAttribute(record.attributeName as string) ?? '',
          );
        }
      }).observe(document.documentElement, {
        attributes: true,
        attributeFilter: Object.keys(names),
      });
    });

    await pauseButton(page, STRINGS['pause.restart']).click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await waitForRunning(page);
    await expect(html(page)).toHaveAttribute('data-pp-babble', 'on');
    await expect(html(page)).toHaveAttribute('data-pp-music', 'on');

    const history = await page.evaluate(
      () => (window as unknown as { ppLoopHistory: Record<string, string[]> }).ppLoopHistory,
    );
    // One stop, one start: not two loops on top of each other.
    expect(history.music).toEqual(['off', 'on']);
    expect(history.babble).toEqual(['off', 'on']);
    // Decoded once per page: the count never changed (a mirror is only written on a change).
    expect(history.clips).toEqual([]);
    await expect(html(page)).toHaveAttribute('data-pp-audio-clips', String(liveClipCount));
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
    expect(problems).toEqual([]);
  });
});
