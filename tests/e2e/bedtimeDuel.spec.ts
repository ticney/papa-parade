import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { THREAT_ICON_PATHS } from '../../src/client/ui/world/threatMarkers.ts';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  advanceTo,
  chronoRingsInShownMarkers,
  cueIds,
  openFrozen,
  realTap,
  shot,
  shownMarkers,
  start,
  typesOf,
  untilTelegraphed,
} from './support/duel.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  OVERRUN_MARGIN_MS,
  pauseButton,
  recordVibrations,
  vibrations,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import { ppAdvance, ppSend, ppState, ppWorld, waitForTestApi } from './support/testApi.ts';

// « Duel du coucher » (story 4.6) on the live level, driven by the test API on a frozen level (steps
// by hand) with real taps, and in real time for the autoplay. Every bound is read from the live
// content or from the world (`windowOpenAt` is the signal the sim drew); nothing waits on a fixed
// delay. Chromium and WebKit both run it; the vibrations are checked on Chromium only (WebKit has no
// `navigator.vibrate`).

const duel = JSON.parse(readFileSync('content/sequences/bedtime_duel.json', 'utf8')) as {
  steps: { kind: string; restMs: number }[];
  failure: { kind: string; maxRetreats: number };
};
if (duel.failure.kind !== 'retreats' || duel.steps.length < 2) {
  throw new Error(
    'content/sequences/bedtime_duel.json needs a retreats failure and at least two steps: bedtimeDuel.spec.ts retreats from step 1',
  );
}
const MAX_RETREATS = duel.failure.maxRetreats;
const isChromium = (): boolean => test.info().project.name === 'chromium';

const BAR = '.pp-hud-sequence-bar';
const TIMER = '[data-pp-zone="timer"] .pp-hud-timer';
const OVERLAY = '[data-debug-overlay]';
const pauseHud = (page: Page) => pauseButton(page, STRINGS['hud.pause_button'] as string);

type World = Awaited<ReturnType<typeof ppWorld>>;
const eyesOf = (world: World) => world.threats.find((threat) => threat.defId === 'bedtime_eyes');

test.describe('starting from the overlay', () => {
  test('the « Start » row starts the duel: no bar, the level stems off, the hush on, the babble off', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await page.keyboard.press('F1');
    await expect(page.locator(OVERLAY)).toHaveAttribute('data-debug-overlay', 'open');
    await page.locator('[data-debug="sequenceSelect"]').selectOption('bedtime_duel');
    await page.locator('[data-debug="startSequence"]').click();
    await page.keyboard.press('F1');
    await ppAdvance(page, 2);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'sequence');
    await expect(html(page)).toHaveAttribute('data-pp-sequence', 'bedtime_duel');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-step', '0');
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carried');
    // The HUD and the babble follow the world a frame or two later: look only once they have.
    await waitFrames(page, 3);
    // No bar and no compact timer: the timer keeps its full size.
    await expect(page.locator(BAR)).toHaveCount(0);
    expect((await page.locator(TIMER).boundingBox())?.height).toBe(40);
    await expect(html(page)).toHaveAttribute('data-pp-music', 'off');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-music', 'on');
    // The baby is in the arms and babbles in the sim, but the babble must not cover the signal.
    await expect(html(page)).toHaveAttribute('data-pp-babble', 'off');
    expect(problems).toEqual([]);
  });
});

test.describe('a real tap', () => {
  test('before the signal the eyes reopen: the gag cue, one retreat, still at step 0', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const { windowOpenAt } = await untilTelegraphed(page);
    expect((await ppWorld(page)).time.sim).toBeLessThan(windowOpenAt);
    await waitFrames(page, 3);
    await realTap(page);
    await ppAdvance(page, 2);
    expect(await cueIds(page)).toContain('gag_baby_eyes_reopened');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-retreats', '1');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-step', '0');
    expect(await typesOf(page, 'WaitSignalGiven')).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('after the signal, far from the marker, it wins the round; a tap before the next signal steps back', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const first = await untilTelegraphed(page);
    await advanceTo(page, first.windowOpenAt + first.windowMs / 2);
    await realTap(page);
    await ppAdvance(page, 3);
    expect(await cueIds(page)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^resp_wait(_perfect)?$/)]),
    );
    await expect(html(page)).toHaveAttribute('data-pp-sequence-step', '1');
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([]);

    // From step 1, a tap before the next signal steps back to step 0.
    await untilTelegraphed(page);
    await waitFrames(page, 3);
    await realTap(page);
    await ppAdvance(page, 2);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-step', '0');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-retreats', '1');
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({ fromStepIndex: 1, stepIndex: 0, retreats: 1, reason: 'early' }),
    ]);
    expect(problems).toEqual([]);
  });

  test('Space is the press too', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const { windowOpenAt, windowMs } = await untilTelegraphed(page);
    await advanceTo(page, windowOpenAt + windowMs / 2);
    await page.keyboard.press('Space');
    await ppAdvance(page, 3);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-step', '1');
    expect(await typesOf(page, 'ResponseResolved')).toEqual([
      expect.objectContaining({
        response: 'wait',
        quality: expect.stringMatching(/success|perfect/),
      }),
    ]);
    expect(problems).toEqual([]);
  });

  test('a tap during a rest changes nothing', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    await waitFrames(page, 3);
    await realTap(page);
    await ppAdvance(page, 2);
    const journal = await page.evaluate(() => window.__PP__?.journal());
    expect(journal?.entries.filter((entry) => entry.command.type === 'PressThreat')).toEqual([]);
    expect(await typesOf(page, 'GagTriggered')).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe('the signal', () => {
  test('plays its cue, and vibrates on Chromium', async ({ page }) => {
    await recordVibrations(page);
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const { windowOpenAt } = await untilTelegraphed(page);
    expect(await cueIds(page)).not.toContain('bedtime_eyes_closed');
    await advanceTo(page, windowOpenAt + STEP_MS);
    expect(await cueIds(page)).toContain('bedtime_eyes_closed');
    expect(await typesOf(page, 'WaitSignalGiven')).toHaveLength(1);
    if (isChromium()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue('bedtime_eyes_closed'));
    }
    expect(problems).toEqual([]);
  });

  test('a tap on the pause button pauses and costs nothing; the wait resumes on the same signal', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const { windowOpenAt } = await untilTelegraphed(page);
    await pauseHud(page).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    const journal = await page.evaluate(() => window.__PP__?.journal());
    expect(journal?.entries.filter((entry) => entry.command.type === 'PressThreat')).toEqual([]);
    expect(await typesOf(page, 'GagTriggered')).toEqual([]);
    await pauseButton(page, STRINGS['pause.resume'] as string).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    const eyes = eyesOf(await ppWorld(page));
    expect(eyes?.state).toBe('telegraph');
    expect(eyes?.windowOpenAt).toBe(windowOpenAt);
    expect(problems).toEqual([]);
  });
});

test.describe('doing nothing', () => {
  test('wakes the baby after the last retreat: baby_woke, sequence_failed, the outcome, the baby still carried', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    for (let i = 0; i < 600; i++) {
      if ((await ppWorld(page)).flow.state !== 'sequence') break;
      await ppAdvance(page, 20);
    }
    expect((await ppWorld(page)).flow.state).toBe('playing');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'failed');
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carried');
    expect(await typesOf(page, 'SequenceStepRetreated')).toHaveLength(MAX_RETREATS - 1);
    const cues = await cueIds(page);
    expect(cues).toContain('baby_woke');
    expect(cues).toContain('sequence_failed');
    expect(problems).toEqual([]);
  });
});

test.describe('the marker (looked at at 667 × 375)', () => {
  test.use({ viewport: { width: 667, height: 375 } });

  test('shows the open eye and « ATTENDS… » before the signal, the closed eye and « FILE ! » after', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const { windowOpenAt } = await untilTelegraphed(page);
    await waitFrames(page, 3);
    await expect.poll(async () => (await shownMarkers(page)).length).toBe(1);
    expect(await shownMarkers(page)).toEqual([
      expect.objectContaining({
        verb: STRINGS['verb.wait'] as string,
        glyph: THREAT_ICON_PATHS.eyes,
      }),
    ]);
    expect((await shownMarkers(page))[0]?.classes).not.toContain('pp-threat--signal');
    // A wait has no chrono-ring at all: its timing would hand the player the signal (story 2.11).
    expect(await chronoRingsInShownMarkers(page)).toBe(0);
    await shot(page, testInfo, 'marker-before.png');

    await advanceTo(page, windowOpenAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.eyelids);
    expect(await shownMarkers(page)).toEqual([
      expect.objectContaining({
        verb: STRINGS['verb.go'] as string,
        glyph: THREAT_ICON_PATHS.eyelids,
      }),
    ]);
    expect((await shownMarkers(page))[0]?.classes).toContain('pp-threat--signal');
    await shot(page, testInfo, 'marker-after.png');
    expect(problems).toEqual([]);
  });

  test('under reduced motion the swap stays and the pop goes', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = collectProblems(page);
    await openFrozen(page);
    await start(page);
    const { windowOpenAt } = await untilTelegraphed(page);
    await advanceTo(page, windowOpenAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.eyelids);
    const animation = await page
      .locator('.pp-threat--signal .pp-threat-icon')
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(animation).toBe('none');
    await shot(page, testInfo, 'marker-reduced.png');
    expect(problems).toEqual([]);
  });

  test('with the sfx bus at 0 the marker swap and the vibration still come', async ({ page }) => {
    await recordVibrations(page);
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [
        SAVE_STORAGE_KEY,
        calibratedSaveValue({}, { volumes: { music: 100, sfx: 0, voice: 100, ui: 100 } }),
      ],
    );
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(html(page)).toHaveAttribute('data-pp-volumes', '100,0,100,100');
    await start(page);
    const { windowOpenAt } = await untilTelegraphed(page);
    await advanceTo(page, windowOpenAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.verb)
      .toBe(STRINGS['verb.go'] as string);
    expect(await cueIds(page)).toContain('bedtime_eyes_closed');
    if (isChromium()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue('bedtime_eyes_closed'));
    }
    expect(problems).toEqual([]);
  });
});

test.describe('autoplay', () => {
  test('the perfect bot wins the duel: outcome succeeded', async ({ page }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page);
    await page.goto('/?autoplay=perfect&seed=42&speed=4');
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', { timeout: 20_000 });
    await expect.poll(async () => (await ppState(page)) !== null).toBe(true);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await ppSend(page, { type: 'StartSequence', sequenceId: 'bedtime_duel' });
    // The sim refuses a start when Papa is busy, a silence is on or a phone rings: say so now, not
    // after a 60 s wait for an outcome that cannot come.
    await expect(
      html(page),
      'StartSequence was refused (Papa busy, a silence or a ringing phone at the start)',
    ).toHaveAttribute('data-pp-sequence', 'bedtime_duel', { timeout: 5_000 });
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded', {
      timeout: 60_000,
    });
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([]);
    expect(problems).toEqual([]);
  });
});
