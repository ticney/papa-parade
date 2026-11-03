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
  winRound,
} from './support/duel.ts';
import {
  collectProblems,
  hapticPatternOfCue,
  html,
  OVERRUN_MARGIN_MS,
  recordVibrations,
  vibrations,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import { ppAdvance, ppSend, ppState, ppWorld, waitForTestApi } from './support/testApi.ts';

// « Faux sommeil » (story 4.7), the third round of the bedtime duel on the live level, driven by the
// test API on a frozen level (steps by hand) with real taps, and in real time for the autoplay. The
// first two rounds (the eyes) are won by real taps with the helper `bedtimeDuel.spec.ts` shares. Every
// bound is read from the world (`feintAt` and `windowOpenAt` are what the sim drew) or the live
// content; nothing waits on a fixed delay. Chromium and WebKit both run it; the vibrations are checked
// on Chromium only (WebKit has no `navigator.vibrate`).

const isChromium = (): boolean => test.info().project.name === 'chromium';
const FAKE = 'fake_sleep';
const FEINT_CUE = 'fake_sleep_eye_peeks';
const SIGNAL_CUE = 'bedtime_eyes_closed';

/** The duel started, its two rounds of the eyes won by real taps: the fake sleep is the next round. */
async function reachFakeSleep(page: Page): Promise<{
  windowOpenAt: number;
  windowMs: number;
  feintAt: number;
}> {
  await openFrozen(page);
  await start(page);
  await winRound(page, 'bedtime_eyes', 0);
  await winRound(page, 'bedtime_eyes', 1);
  const round = await untilTelegraphed(page, FAKE);
  if (round.feintAt === null) throw new Error('the live fake sleep drew no feint');
  return { ...round, feintAt: round.feintAt };
}

test.describe('before the feint', () => {
  test('the eyes glyph, « ATTENDS… », no feint class and no feint cue', async ({ page }) => {
    const problems = collectProblems(page);
    const { feintAt } = await reachFakeSleep(page);
    expect((await ppWorld(page)).time.sim).toBeLessThan(feintAt);
    await waitFrames(page, 3);
    await expect.poll(async () => (await shownMarkers(page)).length).toBe(1);
    expect(await shownMarkers(page)).toEqual([
      expect.objectContaining({
        verb: STRINGS['verb.wait'] as string,
        glyph: THREAT_ICON_PATHS.eyes,
      }),
    ]);
    expect((await shownMarkers(page))[0]?.classes).not.toContain('pp-threat--feint');
    expect(await cueIds(page)).not.toContain(FEINT_CUE);
    expect(await typesOf(page, 'WaitFeintGiven')).toEqual([]);
    expect(problems).toEqual([]);
  });
});

test.describe('the feint', () => {
  test('swaps the glyph to the half-open eye, keeps the verb, plays its cue, and vibrates on Chromium', async ({
    page,
  }) => {
    await recordVibrations(page);
    const problems = collectProblems(page);
    const { feintAt } = await reachFakeSleep(page);
    await advanceTo(page, feintAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.peek);
    const [marker] = await shownMarkers(page);
    expect(marker).toEqual(
      expect.objectContaining({
        verb: STRINGS['verb.wait'] as string,
        glyph: THREAT_ICON_PATHS.peek,
      }),
    );
    expect(marker?.classes).toContain('pp-threat--feint');
    expect(marker?.classes).not.toContain('pp-threat--signal');
    expect(await cueIds(page)).toContain(FEINT_CUE);
    expect(await cueIds(page)).not.toContain('gag_baby_sat_up');
    expect(await typesOf(page, 'WaitFeintGiven')).toHaveLength(1);
    if (isChromium()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue(FEINT_CUE));
      // The feint is told from the signal by its vibration: not the same pattern.
      expect(hapticPatternOfCue(FEINT_CUE)).not.toEqual(hapticPatternOfCue(SIGNAL_CUE));
    }
    expect(problems).toEqual([]);
  });

  test('a real tap on it: the gag cue, one retreat back to step 1, and more noise after the cry’s first tick', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const { feintAt } = await reachFakeSleep(page);
    await advanceTo(page, feintAt + STEP_MS);
    const noiseBefore = (await ppWorld(page)).gauges.noisePct;
    await realTap(page);
    await ppAdvance(page, 2);
    expect(await cueIds(page)).toContain('gag_baby_sat_up');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-retreats', '1');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-step', '1');
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({ fromStepIndex: 2, stepIndex: 1, retreats: 1, reason: 'early' }),
    ]);
    // The cry of the def: its first tick comes within a second of the gag.
    await ppAdvance(page, 110);
    expect((await ppWorld(page)).gauges.noisePct).toBeGreaterThan(noiseBefore);
    expect(problems).toEqual([]);
  });
});

test.describe('the signal', () => {
  test('a real tap after it wins the duel: resp_wait, outcome succeeded', async ({ page }) => {
    const problems = collectProblems(page);
    const { windowOpenAt, windowMs } = await reachFakeSleep(page);
    await advanceTo(page, windowOpenAt + windowMs / 2);
    expect(await typesOf(page, 'WaitFeintGiven')).toHaveLength(1);
    await realTap(page);
    await ppAdvance(page, 3);
    expect(await cueIds(page)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^resp_wait(_perfect)?$/)]),
    );
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded');
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('Space is the press too', async ({ page }) => {
    const problems = collectProblems(page);
    const { windowOpenAt, windowMs } = await reachFakeSleep(page);
    await advanceTo(page, windowOpenAt + windowMs / 2);
    await page.keyboard.press('Space');
    await ppAdvance(page, 3);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded');
    expect(problems).toEqual([]);
  });
});

test.describe('autoplay', () => {
  test('the perfect bot wins the duel, feint included: outcome succeeded', async ({ page }) => {
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
    // Waited on first: a refused start (Papa busy, a silence, a ringing phone) must fail here, not after 60 s.
    await expect(
      html(page),
      'StartSequence was refused (Papa busy, a silence or a ringing phone at the start)',
    ).toHaveAttribute('data-pp-sequence', 'bedtime_duel', { timeout: 5_000 });
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded', {
      timeout: 60_000,
    });
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([]);
    // The bot read the drawn signal: it let the feint go by.
    expect(await typesOf(page, 'WaitFeintGiven')).toHaveLength(1);
    expect(problems).toEqual([]);
  });
});

test.describe('the marker (looked at at 667 × 375)', () => {
  test.use({ viewport: { width: 667, height: 375 } });

  test('shows the open eye before the feint, the half-open eye from it, the closed eye and « FILE ! » at the signal', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page);
    const { windowOpenAt, feintAt } = await reachFakeSleep(page);
    await waitFrames(page, 3);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.eyes);
    await shot(page, testInfo, 'fake-sleep-before.png');

    await advanceTo(page, feintAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.peek);
    expect((await shownMarkers(page))[0]?.verb).toBe(STRINGS['verb.wait'] as string);
    // Neither the wait nor its feint has a chrono-ring (story 2.11).
    expect(await chronoRingsInShownMarkers(page)).toBe(0);
    await shot(page, testInfo, 'fake-sleep-feint.png');

    await advanceTo(page, windowOpenAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.eyelids);
    expect(await shownMarkers(page)).toEqual([
      expect.objectContaining({ verb: STRINGS['verb.go'] as string }),
    ]);
    expect((await shownMarkers(page))[0]?.classes).not.toContain('pp-threat--feint');
    await shot(page, testInfo, 'fake-sleep-signal.png');
    expect(problems).toEqual([]);
  });

  test('under reduced motion the swap stays and the tilt goes', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = collectProblems(page);
    const { feintAt } = await reachFakeSleep(page);
    await advanceTo(page, feintAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.peek);
    const animation = await page
      .locator('.pp-threat--feint .pp-threat-icon')
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(animation).toBe('none');
    await shot(page, testInfo, 'fake-sleep-feint-reduced.png');
    expect(problems).toEqual([]);
  });

  test('with the sfx bus at 0 the feint’s swap and its vibration still come', async ({ page }) => {
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
    await winRound(page, 'bedtime_eyes', 0);
    await winRound(page, 'bedtime_eyes', 1);
    const round = await untilTelegraphed(page, FAKE);
    await advanceTo(page, (round.feintAt ?? 0) + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.peek);
    expect(await cueIds(page)).toContain(FEINT_CUE);
    if (isChromium()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue(FEINT_CUE));
    }
    expect(problems).toEqual([]);
  });
});
