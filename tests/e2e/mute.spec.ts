import { expect, test } from '@playwright/test';
import { RESUME_COUNTDOWN_MS, SCREEN_FLASH_MIN_INTERVAL_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  FIRST_TELEGRAPH_MAX_MS,
  FIRST_WAVE_RESPONSE_MAX_MS,
  hapticPatternOfCue,
  html,
  liveFeedback,
  liveThreat,
  liveWaves,
  OVERRUN_MARGIN_MS,
  recordVibrations,
  telegraphDelayMsOf,
  vibrations,
  windowOpenMsOf,
} from './support/game.ts';
import { ppCueLog, ppEvents, waitForTestApi } from './support/testApi.ts';

// Pillar 3 (story 2.4, NFR7): with the sound off, nothing is missed. `?autoplay=` starts the level
// with no gesture, so the audio context is `none`: the game is muted for real, not by a setting.
// Every bound is derived from the live plan and content; no fixed sleep, no cue id typed.

const SPEED = 4;
const SEED = 7;

const plannedDefs = [
  ...new Set(liveWaves.slice(0, 2).flatMap((wave) => wave.threats.map((threat) => threat.def))),
];
const secondWave = liveWaves[1];
if (secondWave === undefined) throw new Error('the live level has fewer than two waves');
/** The longest a threat of the first two waves takes from its telegraph to the end of its window. */
const RESPONSE_MAX_MS = Math.max(
  ...plannedDefs.map(
    (def) => telegraphDelayMsOf(liveThreat(def)) + windowOpenMsOf(liveThreat(def)),
  ),
);
/**
 * Sim ms by which every def of the first two waves has surely been telegraphed: the second wave
 * starts, then each def is drawn by the PRNG within a few gaps (a generous bound, not a time).
 */
const PLANNED_SIM_MS =
  secondWave.fromMs + plannedDefs.length * 4 * (secondWave.gapMaxMs + RESPONSE_MAX_MS);
const PLANNED_TIMEOUT_MS = RESUME_COUNTDOWN_MS + PLANNED_SIM_MS / SPEED + 2 * OVERRUN_MARGIN_MS;
const FIRST_GAG_TIMEOUT_MS =
  RESUME_COUNTDOWN_MS +
  (FIRST_TELEGRAPH_MAX_MS + FIRST_WAVE_RESPONSE_MAX_MS) / SPEED +
  2 * OVERRUN_MARGIN_MS;

const telegraphCues = plannedDefs.map((def) => liveThreat(def).feedback.telegraph);
const perfectCue = liveThreat(plannedDefs[0] ?? '').feedback.perfect;

test.describe('a muted game (story 2.4)', () => {
  test('every sound has its visual twin, its vibration, and the perfect flashes the screen', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(PLANNED_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await recordVibrations(page);
    await page.goto(`/?autoplay=perfect&seed=${SEED}&speed=${SPEED}`);
    await waitForTestApi(page);

    // The game is muted for real: no gesture, so no audio context and nothing decoded.
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'none');
    await expect(html(page)).toHaveAttribute('data-pp-audio-clips', '0');

    await expect
      .poll(
        async () => {
          const played = new Set((await ppCueLog(page)).map((record) => record.cueId));
          return [...telegraphCues, perfectCue].filter((cueId) => !played.has(cueId));
        },
        { timeout: PLANNED_TIMEOUT_MS, message: 'cues still missing from __PP__.cueLog()' },
      )
      .toEqual([]);

    // One synchronous read of the log and of the mirrors: the game keeps playing (autoplay), a second
    // read could see one more cue than the first.
    const { log, flashCount, cueCount } = await page.evaluate(() => ({
      log: window.__PP__?.cueLog() ?? [],
      flashCount: Number(document.documentElement.dataset.ppFlashCount),
      cueCount: Number(document.documentElement.dataset.ppCueCount),
    }));
    const heard = log.filter((record) => liveFeedback.cues[record.cueId]?.audio !== undefined);
    expect(heard.length).toBeGreaterThan(0);

    // Every cue with a sound drew something to see, of the kinds the live cue asks for.
    // The 3 Hz rule: a flash comes at least `SCREEN_FLASH_MIN_INTERVAL_MS` real ms after the previous
    // one, and a flash is skipped only when the previous one is that close (a speed-4 run puts two
    // perfects close in real time). `atReal` is read a few ms after the flash itself: a small slack.
    const SLACK_MS = 10;
    let lastFlashAtReal: number | null = null;
    for (const record of log) {
      const cue = liveFeedback.cues[record.cueId] as
        | { audio?: unknown; visual?: { kind: string }; flash?: unknown }
        | undefined;
      if (cue?.audio === undefined) continue;
      expect(record.visuals, `${record.cueId} drew nothing`).not.toEqual([]);
      if (cue.visual?.kind === 'soundWave') expect(record.visuals).toContain('soundWave');
      if (cue.visual?.kind === 'uiElement') expect(record.visuals).toContain('uiElement');
      if (cue.flash === undefined) continue;
      const sinceLastMs: number =
        lastFlashAtReal === null ? Infinity : record.atReal - lastFlashAtReal;
      if (record.visuals.includes('flash')) {
        expect(sinceLastMs, `${record.cueId}: flashed faster than 3 Hz`).toBeGreaterThanOrEqual(
          SCREEN_FLASH_MIN_INTERVAL_MS - SLACK_MS,
        );
        lastFlashAtReal = record.atReal;
      } else {
        expect(sinceLastMs, `${record.cueId}: a flash skipped without a close one`).toBeLessThan(
          SCREEN_FLASH_MIN_INTERVAL_MS + SLACK_MS,
        );
      }
    }

    // The perfect: a flash, drawn by the overlay that exists and takes no tap.
    const perfects = log.filter((record) => record.cueId === perfectCue);
    expect(perfects.length).toBeGreaterThan(0);
    // Unless the log has dropped its oldest cues (it keeps 200), its first perfect is the game's first.
    if (cueCount === log.length) expect(perfects[0]?.visuals).toContain('flash');
    // The mirror `data-pp-flash-count` counts the flashes drawn: a poll of `getAnimations()` could
    // miss a 180 ms fade at speed 4. It counts every flash, the log only its last cues.
    const loggedFlashes = log.filter((record) => record.visuals.includes('flash')).length;
    if (cueCount === log.length) expect(flashCount).toBe(loggedFlashes);
    else expect(flashCount).toBeGreaterThanOrEqual(loggedFlashes);
    const overlay = page.locator('.pp-screen-flash');
    await expect(overlay).toHaveCount(1);
    await expect(overlay).toHaveCSS('pointer-events', 'none');

    // The vibrations: Chromium records `navigator.vibrate`; WebKit has none, the visuals carry it.
    // Each cue that vibrated left one entry: a pattern appears at least as often as the cues of its kind.
    if (browserName === 'chromium') {
      const patterns = (await vibrations(page)).map((pattern) => JSON.stringify(pattern));
      const wanted = new Map<string, number>();
      for (const record of log) {
        if (record.haptic === null) continue;
        const pattern = hapticPatternOfCue(record.cueId);
        expect(pattern, `${record.cueId} has a haptic kind but no pattern`).not.toBeNull();
        const key = JSON.stringify(pattern);
        wanted.set(key, (wanted.get(key) ?? 0) + 1);
      }
      for (const [key, count] of wanted) {
        const recordedCount = patterns.filter((pattern) => pattern === key).length;
        expect(recordedCount, `vibrations ${key}`).toBeGreaterThanOrEqual(count);
      }
      for (const cueId of [...telegraphCues, perfectCue]) {
        expect(log.find((record) => record.cueId === cueId)?.haptic).not.toBeNull();
      }
    } else {
      await expect(html(page)).toHaveAttribute('data-pp-haptics', 'false');
    }

    expect(problems).toEqual([]);
  });

  test('a gag has its wave and its heavy vibration with the sound off', async ({
    page,
    browserName,
  }) => {
    test.setTimeout(FIRST_GAG_TIMEOUT_MS + 30_000);
    const problems = collectProblems(page);
    await recordVibrations(page);
    await page.goto(`/?autoplay=idle&seed=${SEED}&speed=${SPEED}`);
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'none');

    let gagId = '';
    await expect
      .poll(
        async () => {
          const gag = (await ppEvents(page)).find((event) => event.type === 'GagTriggered');
          gagId = gag !== undefined && 'gag' in gag ? String(gag.gag) : '';
          return gagId;
        },
        { timeout: FIRST_GAG_TIMEOUT_MS },
      )
      .not.toBe('');

    const gagCues = plannedDefs
      .map((def) => liveThreat(def))
      .filter((def) => def.gag === gagId)
      .map((def) => def.feedback.gag);
    expect(gagCues.length, `no live def ends in the gag ${gagId}`).toBeGreaterThan(0);
    await expect
      .poll(async () => (await ppCueLog(page)).some((record) => gagCues.includes(record.cueId)), {
        timeout: OVERRUN_MARGIN_MS,
      })
      .toBe(true);
    const record = (await ppCueLog(page)).find((entry) => gagCues.includes(entry.cueId));
    expect(record?.visuals).toContain('soundWave');
    expect(record?.haptic).toBe('heavy');
    if (browserName === 'chromium') {
      const pattern = hapticPatternOfCue(record?.cueId ?? '');
      expect((await vibrations(page)).map((entry) => JSON.stringify(entry))).toContain(
        JSON.stringify(pattern),
      );
    }
    expect(problems).toEqual([]);
  });
});
