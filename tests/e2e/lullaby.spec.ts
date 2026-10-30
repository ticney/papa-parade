import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, type TestInfo, test } from '@playwright/test';
import type { BeatsStep } from '../../src/content/schemas/sequence.ts';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import { beatTimelineOf } from '../../src/sim/index.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeedback,
  OVERRUN_MARGIN_MS,
  pauseButton,
  recordVibrations,
  startLevel,
  vibrations,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppState,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// « Les 100 pas en rythme » (story 4.5) on the live level, driven by the test API on a frozen level
// (steps by hand) for the taps, the decoy, the ring and the failure, and in real time for the
// synchronisation of the notes with the game clock (AC 22). Every bound is read from the live content;
// nothing waits on a fixed delay. Chromium and WebKit both run the frozen specs; the vibrations are
// checked on Chromium only (WebKit has no `navigator.vibrate`), and so is the real-time one.

const LEVEL = 'salon_crawler';
const SEED = 42;
const lullaby = JSON.parse(readFileSync('content/sequences/lullaby_walk.json', 'utf8')) as {
  steps: BeatsStep[];
  failure: { missWakePct: number; decoyWakePct: number; strayWakePct: number };
};
const STEP = lullaby.steps[0] as BeatsStep;
const TIMELINE = beatTimelineOf(STEP);
const BEATS = TIMELINE.filter((entry) => entry.kind === 'beat');
const DECOY = TIMELINE.find((entry) => entry.kind === 'decoy');
const DECOY_AFTER = DECOY?.judgedIndex ?? 0;
const { missWakePct, decoyWakePct, strayWakePct } = lullaby.failure;
const feedback = liveFeedback as unknown as {
  beatRing: { approachMs: number };
  beatScheduler: { scheduleAheadMs: number };
};
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

const BAR = '.pp-hud-sequence-bar';
const RING = '.pp-beat-ring';
const DISC = '.pp-beat-ring-disc';
const OVERLAY = '[data-debug-overlay]';
const pauseHud = (page: Page) => pauseButton(page, STRINGS['hud.pause_button'] as string);

async function openFrozen(page: Page): Promise<void> {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  // The audio is up before any tap: a first tap must not be the gesture that rescues it.
  await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
}

async function start(page: Page): Promise<number> {
  await ppSend(page, { type: 'StartSequence', sequenceId: 'lullaby_walk' });
  await ppAdvance(page, 2);
  return (await ppWorld(page)).sequence.startedAt;
}

/** Steps, by hand, to the first step at or after `untilMs` of sim time. */
async function advanceTo(page: Page, untilMs: number): Promise<void> {
  const now = (await ppWorld(page)).time.sim;
  const steps = Math.max(0, Math.ceil((untilMs - now) / STEP_MS));
  if (steps > 0) await ppAdvance(page, steps);
  // The loop records the new clock at its next frames: an input stamped before that is mapped
  // between the old clock and the new one, not onto the new one (the loop is frozen, the map flat).
  await waitFrames(page, 3);
}

/** Taps judged beats `0..count - 1` dead on, by the test API (each lands at its own step). */
async function tapBeats(page: Page, startedAt: number, count: number): Promise<void> {
  for (let i = 0; i < count; i++) {
    await ppSend(page, { type: 'TapBeat', t: startedAt + (BEATS[i]?.offsetMs ?? 0) });
  }
}

/** A real click at a point of the canvas clear of every icon and of the HUD's corners. */
async function realTap(page: Page): Promise<void> {
  const box = await page.locator('#pp-canvas').boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.62);
}

/** A screenshot to look at: in `PP_SHOTS_DIR` when it is set (the story's review), else in the test's output. */
const shot = (page: Page, testInfo: TestInfo, name: string) =>
  page.screenshot({
    path:
      process.env.PP_SHOTS_DIR === undefined
        ? testInfo.outputPath(name)
        : join(process.env.PP_SHOTS_DIR, `${testInfo.project.name}-${name}`),
  });

const typesOf = async (page: Page, type: string) =>
  (await ppEvents(page)).filter((event) => event.type === type);

test.describe('starting from the overlay', () => {
  test('the « Start » row starts the walk: the flow, the bar says « Calme », the stems give way to the pad', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toHaveAttribute('data-debug-overlay', 'open');
    await page.locator('[data-debug="sequenceSelect"]').selectOption('lullaby_walk');
    await page.locator('[data-debug="startSequence"]').click();
    await page.keyboard.press('F1');
    await ppAdvance(page, 2);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'sequence');
    await expect(html(page)).toHaveAttribute('data-pp-sequence', 'lullaby_walk');
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carried');
    await expect(page.locator(BAR)).toHaveAttribute(
      'aria-label',
      STRINGS['hud.sequence_lullaby_walk'] as string,
    );
    await expect(page.locator(BAR)).toHaveAttribute('aria-valuenow', '100');
    expect(STRINGS['hud.sequence_lullaby_walk']).toBe('Calme');
    // The level stems are off, the sequence's pad is on (a clip that fails to start would show here).
    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-music', 'on');
    expect(problems).toEqual([]);
  });
});

test.describe('tapping to the beat', () => {
  test('a real tap in a window is a hit, Space too; a tap on the pause button pauses and costs nothing', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const startedAt = await start(page);
    await advanceTo(page, startedAt + (BEATS[0]?.offsetMs ?? 0));
    await realTap(page);
    await ppAdvance(page, 2);
    await expect(html(page)).toHaveAttribute('data-pp-beat-hits', '1');
    const hit = (await typesOf(page, 'BeatHit'))[0] as { judgedIndex: number; offsetMs: number };
    expect(hit.judgedIndex).toBe(0);
    expect(Math.abs(hit.offsetMs)).toBeLessThanOrEqual(2 * STEP_MS);
    expect((await ppCueLog(page)).map((entry) => entry.cueId)).toContain('beat_hit');

    await advanceTo(page, startedAt + (BEATS[1]?.offsetMs ?? 0));
    await page.keyboard.press('Space');
    await ppAdvance(page, 2);
    await expect(html(page)).toHaveAttribute('data-pp-beat-hits', '2');

    // The HUD's pause button pauses: it is not a tap to the beat.
    const before = (await typesOf(page, 'BeatStrayTapped')).length;
    await pauseHud(page).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    const journal = await page.evaluate(() => window.__PP__?.journal());
    expect(journal?.entries.filter((entry) => entry.command.type === 'TapBeat')).toHaveLength(2);
    expect((await typesOf(page, 'BeatStrayTapped')).length).toBe(before);
    await pauseButton(page, STRINGS['pause.resume'] as string).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    expect(problems).toEqual([]);
  });

  test('a tap on the decoy, then a stray tap: the baby stirs, the bar falls, the wake matches the JSON', async ({
    page,
  }) => {
    await recordVibrations(page);
    const problems = collectProblems(page);
    await openFrozen(page);
    const startedAt = await start(page);
    // Walk in time up to the decoy, by the API; the decoy itself is tapped for real.
    await tapBeats(page, startedAt, DECOY_AFTER + 1);
    await advanceTo(page, startedAt + (DECOY?.offsetMs ?? 0));
    await realTap(page);
    await ppAdvance(page, 2);
    await expect(html(page)).toHaveAttribute('data-pp-baby-wake', String(decoyWakePct));
    expect((await typesOf(page, 'DecoyTapped')).length).toBe(1);
    // A second tap on the spent decoy is a stray.
    await realTap(page);
    await ppAdvance(page, 2);
    await expect(html(page)).toHaveAttribute(
      'data-pp-baby-wake',
      String(decoyWakePct + strayWakePct),
    );
    expect((await typesOf(page, 'BeatStrayTapped')).length).toBe(1);
    expect((await ppCueLog(page)).filter((entry) => entry.cueId === 'baby_stirred')).toHaveLength(
      2,
    );
    await waitFrames(page, 3);
    await expect(page.locator(BAR)).toHaveAttribute(
      'aria-valuenow',
      String(100 - decoyWakePct - strayWakePct),
    );
    if (hasVibrate()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue('baby_stirred'));
    }
    expect(problems).toEqual([]);
  });

  test('doing nothing wakes him: baby_woke, sequence_failed, the outcome, the baby still carried', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const missesToWake = Math.ceil(100 / missWakePct);
    for (let i = 0; i < Math.ceil(STEP.durationMs / (10 * STEP_MS)) + 2; i++) {
      if ((await ppWorld(page)).flow.state !== 'sequence') break;
      await ppAdvance(page, 10);
    }
    expect((await ppWorld(page)).flow.state).toBe('playing');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'failed');
    await expect(html(page)).toHaveAttribute('data-pp-beat-misses', String(missesToWake));
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carried');
    const cues = (await ppCueLog(page)).map((entry) => entry.cueId);
    expect(cues).toContain('baby_woke');
    expect(cues).toContain('sequence_failed');
    expect(await typesOf(page, 'PapaSnored')).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe('seeing and feeling the beat without the music', () => {
  test('with the music bus at 0 the ring and the vibrations are all still there', async ({
    page,
  }) => {
    await recordVibrations(page);
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [
        SAVE_STORAGE_KEY,
        calibratedSaveValue({}, { volumes: { music: 0, sfx: 100, voice: 100, ui: 100 } }),
      ],
    );
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(html(page)).toHaveAttribute('data-pp-volumes', '0,100,100,100');
    const startedAt = await start(page);
    const approachMs = feedback.beatRing.approachMs;
    await advanceTo(page, startedAt + (TIMELINE[0]?.offsetMs ?? 0) - approachMs / 2);
    await waitFrames(page, 2);
    await expect(page.locator(RING)).toBeVisible();
    await expect(page.locator(RING)).toHaveCSS('--pp-beat-progress', /0\.[4-6]/);
    // Past the first note and the first judged beat: the cues for the tempo are in the log.
    await advanceTo(page, startedAt + (BEATS[0]?.offsetMs ?? 0) + STEP_MS);
    const cues = (await ppCueLog(page)).map((entry) => entry.cueId);
    expect(cues).toContain('beat_cued');
    if (hasVibrate()) {
      const light = hapticPatternOfCue('beat_cued');
      expect(light).not.toBeNull();
      expect(
        (await vibrations(page)).filter((p) => String(p) === String(light)).length,
      ).toBeGreaterThan(1);
    }
    expect(problems).toEqual([]);
  });
});

test.describe('the ring (looked at at 667 × 375)', () => {
  test.use({ viewport: { width: 667, height: 375 } });

  test('closes on Papa before a beat, solid for a beat and dashed with a ✕ for the decoy', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const startedAt = await start(page);
    const approachMs = feedback.beatRing.approachMs;
    await tapBeats(page, startedAt, DECOY_AFTER + 1);
    await advanceTo(page, startedAt + (BEATS[2]?.offsetMs ?? 0) - approachMs * 0.4);
    await waitFrames(page, 2);
    await expect(page.locator(RING)).toBeVisible();
    await expect(page.locator(RING)).not.toHaveClass(/pp-beat-ring--decoy/);
    expect(await page.locator(DISC).evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe(
      'solid',
    );
    expect(await page.locator(DISC).evaluate((e) => getComputedStyle(e).transform)).not.toBe(
      'none',
    );
    await shot(page, testInfo, 'ring-beat.png');

    await advanceTo(page, startedAt + (DECOY?.offsetMs ?? 0) - approachMs * 0.4);
    await waitFrames(page, 2);
    await expect(page.locator(RING)).toHaveClass(/pp-beat-ring--decoy/);
    expect(await page.locator(DISC).evaluate((e) => getComputedStyle(e).borderTopStyle)).toBe(
      'dashed',
    );
    // The ✕ comes from CSS, with the dashed outline: shape and colour, never colour alone.
    expect(
      await page.locator(DISC).evaluate((e) => getComputedStyle(e, '::after').content),
    ).toContain('✕');
    await shot(page, testInfo, 'ring-decoy.png');
    await expect(page.locator(RING)).toHaveAttribute('aria-hidden', 'true');
    expect(problems).toEqual([]);
  });

  test('under reduced motion the ring pops in opacity and keeps its size', async ({
    page,
  }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = collectProblems(page);
    await openFrozen(page);
    const startedAt = await start(page);
    const approachMs = feedback.beatRing.approachMs;
    await advanceTo(page, startedAt + (TIMELINE[0]?.offsetMs ?? 0) - approachMs * 0.4);
    await waitFrames(page, 2);
    await expect(page.locator(RING)).toHaveClass(/pp-beat-ring--reduced/);
    expect(await page.locator(DISC).evaluate((e) => getComputedStyle(e).transform)).toBe('none');
    await shot(page, testInfo, 'ring-reduced.png');
    expect(problems).toEqual([]);
  });
});

test.describe('autoplay', () => {
  test('the perfect bot walks it to the end: outcome succeeded', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page);
    await page.goto('/?autoplay=perfect&seed=42&speed=4');
    await waitForTestApi(page);
    // The app goes start → loading → level by itself; the level is up once the world is there.
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', { timeout: 20_000 });
    await expect.poll(async () => (await ppState(page)) !== null).toBe(true);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await ppSend(page, { type: 'StartSequence', sequenceId: 'lullaby_walk' });
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded', {
      timeout: 60_000,
    });
    expect((await typesOf(page, 'BeatMissed')).length).toBe(0);
    expect(problems).toEqual([]);
  });
});

test.describe('synchronisation with the game clock (AC 22)', () => {
  test('every note that sounded is within 10 ms of the game clock, through a slow-mo and a real pause', async ({
    page,
  }) => {
    test.skip(!hasVibrate(), 'real Web Audio, measured on Chromium');
    test.setTimeout(120_000);
    const problems = collectProblems(page);
    await startLevel(page);
    await ppLoadLevel(page, LEVEL, SEED);
    // A context that does not reach `running` fails the test; it does not skip it.
    await expect(html(page)).toHaveAttribute('data-pp-audio', 'running');
    await ppSend(page, { type: 'StartSequence', sequenceId: 'lullaby_walk' });
    await expect.poll(async () => (await ppWorld(page)).flow.state).toBe('sequence');
    const startedAt = (await ppWorld(page)).sequence.startedAt;
    // Perfect play, so the baby sleeps through and the notes go on.
    await tapBeats(page, startedAt, BEATS.length);

    const notesCount = async () =>
      (await page.evaluate(() => window.__PP__?.beatLog().notes.length)) ?? 0;
    await expect.poll(notesCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(5);
    // A slow-mo (×0.3) from the debug time scale, then back.
    const changes: number[] = [];
    const markChange = async () => changes.push((await ppWorld(page)).time.sim);
    await markChange();
    await ppSend(page, { type: 'SetTimeScale', scale: 0.3 });
    await expect.poll(notesCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(7);
    await markChange();
    await ppSend(page, { type: 'SetTimeScale', scale: 1 });
    await expect.poll(notesCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(10);
    // A real pause: the context is suspended, both clocks stand; the resume counts down.
    await markChange();
    await pauseHud(page).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await page.waitForTimeout(1500);
    await pauseButton(page, STRINGS['pause.resume'] as string).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await expect.poll(notesCount, { timeout: 30_000 }).toBeGreaterThanOrEqual(22);

    const log = await page.evaluate(() => window.__PP__?.beatLog());
    if (log === undefined) throw new Error('no beat log');
    const { notes, samples } = log;
    expect(notes.length).toBeGreaterThanOrEqual(22);
    // The audio time at which the sampled game clock reached `beatAt`, by interpolation between the
    // two frames around it.
    const gaps = notes.flatMap((note) => {
      const k = samples.findIndex(([, clockMs]) => clockMs >= note.beatAt);
      if (k <= 0) return [];
      const [a0, c0] = samples[k - 1] as [number, number];
      const [a1, c1] = samples[k] as [number, number];
      const truthS = c1 === c0 ? a1 : a0 + ((note.beatAt - c0) / (c1 - c0)) * (a1 - a0);
      return [
        {
          entryIndex: note.entryIndex,
          beatAt: note.beatAt,
          gapMs: Math.abs(note.plannedAtS - truthS) * 1000,
        },
      ];
    });
    // The one honest exception: a change of rate in the frame just before a note sounds cannot be
    // undone, the note is already out. It is at most one frame times |old − new| / new, 39 ms for a
    // ×0.3 slow-mo at 60 fps. Only a note within `NEAR_CHANGE_MS` of the game clock at a change
    // (the slow-mo's start and end, the pause and its resume) is excused, and only down to that bound.
    const NEAR_CHANGE_MS = 250;
    const EXCEPTION_BOUND_MS = 45;
    let verified = 0;
    for (const { entryIndex, beatAt, gapMs } of gaps) {
      const isNearChange = changes.some((at) => Math.abs(beatAt - at) <= NEAR_CHANGE_MS);
      if (isNearChange) {
        expect(gapMs, `note ${entryIndex} (near a change of rate)`).toBeLessThanOrEqual(
          EXCEPTION_BOUND_MS,
        );
        continue;
      }
      expect(gapMs, `note ${entryIndex}`).toBeLessThanOrEqual(10);
      verified += 1;
    }
    expect(verified).toBeGreaterThanOrEqual(12);
    expect(problems).toEqual([]);
  });
});
