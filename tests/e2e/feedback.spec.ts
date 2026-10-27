import { expect, type Page, test } from '@playwright/test';
import { RESUME_COUNTDOWN_DIGITS, RESUME_COUNTDOWN_MS } from '../../src/shared/constants.ts';
import { createConsoleSink } from '../../src/shared/log.ts';
import {
  areCountdownsSilent,
  audioContextActivations,
  audioDuringCountdowns,
  audioState,
  collectProblems,
  cueCount,
  hapticPatternOf,
  html,
  liveClipCount,
  liveFeedback,
  mirrorWrites,
  OVERRUN_MARGIN_MS,
  OWN_WARNINGS,
  openGame,
  pauseButton,
  recordAudioContexts,
  recordMirrorWrites,
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
const BUMP_CUE = liveFeedback.events.PapaBlocked as string;
const TICK_CUE = liveFeedback.events.CountdownTicked as string;
const BUMP_PATTERN = hapticPatternOf('PapaBlocked');
const TICK_PATTERN = hapticPatternOf('CountdownTicked');

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
    await recordAudioContexts(page);
    await recordMirrorWrites(page, ['data-pp-audio', 'data-pp-state']);
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
    // One context, made in the task of the gesture (not from a timer, a load or the countdown's
    // end): iOS unlocks audio there and nowhere else, and `GameResumed` later resumes outside any.
    expect(await audioContextActivations(page)).toEqual([true]);
    // The countdown settled on `suspended` and stayed there: the whole history, not one sample.
    const countdowns = audioDuringCountdowns(await mirrorWrites(page));
    expect(countdowns).toHaveLength(1);
    expect(areCountdownsSilent(countdowns), JSON.stringify(countdowns)).toBe(true);
    expect(problems).toEqual([]);
  });

  test('is suspended by a pause, still suspended during the countdown, and back once it is over', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordMirrorWrites(page, ['data-pp-audio', 'data-pp-state']);
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
    // Neither countdown (the level's, then this resume's) let the context run.
    const countdowns = audioDuringCountdowns(await mirrorWrites(page));
    expect(countdowns).toHaveLength(2);
    expect(areCountdownsSilent(countdowns), JSON.stringify(countdowns)).toBe(true);
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
    await expect(html(page)).toHaveAttribute('data-pp-cue', TICK_CUE);
    const before = await cueCount(page);
    const vibrationsBefore = (await vibrations(page)).length;

    await page.keyboard.down('ArrowUp');
    await expect(html(page)).toHaveAttribute('data-pp-cue', BUMP_CUE, { timeout: WALK_BOUND_MS });
    await page.keyboard.up('ArrowUp');
    // Once per blockage, not once per frame of it.
    await waitFrames(page, FRAMES_TO_SETTLE);
    expect(await cueCount(page)).toBe(before + 1);

    const patterns = (await vibrations(page)).slice(vibrationsBefore);
    if (!hasVibrate()) expect(patterns).toEqual([]);
    else if (BUMP_PATTERN !== null) expect(patterns).toEqual([BUMP_PATTERN]);
    else expect(patterns).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('ticks once per countdown digit: one vibration per digit over one pause and resume', async ({
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
    await expect.poll(() => cueCount(page)).toBe(countBefore + RESUME_COUNTDOWN_DIGITS);
    await expect(html(page)).toHaveAttribute('data-pp-cue', TICK_CUE);
    await waitFrames(page, FRAMES_TO_SETTLE);
    expect(await cueCount(page)).toBe(countBefore + RESUME_COUNTDOWN_DIGITS);

    const patterns = (await vibrations(page)).slice(vibrationsBefore);
    if (hasVibrate() && TICK_PATTERN !== null) {
      expect(patterns).toEqual(Array.from({ length: RESUME_COUNTDOWN_DIGITS }, () => TICK_PATTERN));
    } else expect(patterns).toEqual([]);
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

test.describe('the harness', () => {
  test('fails a session on a warning of the audio engine or of the feedback director', () => {
    // The very line the console sink prints for each warning (`[channel] message`).
    const printed: string[] = [];
    const sink = createConsoleSink({
      error: () => {},
      info: () => {},
      debug: () => {},
      warn: (line: string) => printed.push(line),
    });
    const warn = (channel: 'audio' | 'feedback' | 'platform', message: string): void =>
      sink({ level: 'warn', channel, message, atReal: 0 });
    warn('audio', 'audio resume failed: boom');
    warn('audio', 'audio clip papa_bump unavailable: HTTP 404');
    warn('audio', 'audio loop babble failed to start: too many sources');
    warn('audio', 'audio preload gave up after 5000 ms: the level starts without the rest');
    warn('feedback', 'feedback sound for PapaBlocked failed: boom');
    expect(printed).toHaveLength(5);
    for (const line of printed) expect(OWN_WARNINGS.test(line), line).toBe(true);
    // A warning of another channel is not the app's audio.
    printed.length = 0;
    warn('platform', 'navigator.vibrate refused the pattern (no user activation yet?)');
    expect(OWN_WARNINGS.test(printed[0] ?? ''), 'platform').toBe(false);
  });

  test('tells a silent countdown from one where the context runs', () => {
    const write = (name: string, value: string) => ({ name, value });
    const countdown = (...audio: string[]) => [
      write('data-pp-state', 'resuming'),
      ...audio.map((value) => write('data-pp-audio', value)),
      write('data-pp-state', 'running'),
    ];
    expect(areCountdownsSilent(audioDuringCountdowns(countdown()))).toBe(true);
    expect(areCountdownsSilent(audioDuringCountdowns(countdown('suspended')))).toBe(true);
    expect(areCountdownsSilent(audioDuringCountdowns(countdown('running', 'suspended')))).toBe(
      true,
    );
    expect(areCountdownsSilent(audioDuringCountdowns(countdown('running')))).toBe(false);
    expect(areCountdownsSilent(audioDuringCountdowns(countdown('suspended', 'running')))).toBe(
      false,
    );
    // The audio written after the countdown (the context resuming) is not the countdown's.
    expect(
      audioDuringCountdowns([...countdown('suspended'), write('data-pp-audio', 'running')]),
    ).toEqual([['suspended']]);
  });
});
