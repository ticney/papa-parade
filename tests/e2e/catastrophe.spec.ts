import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { mamaReactionsOf } from '../../src/sim/scoring/mamaReactions.ts';
import {
  appUrl,
  collectProblems,
  cueCount,
  emulateReducedMotion,
  hapticPatternOf,
  html,
  LEVEL_DURATION_MS,
  liveFeedback,
  liveFeel,
  mamaCueOf,
  mamaHapticsOf,
  passReplayToActions,
  recordVibrations,
  startLevel,
  THREATS_OFF,
  vibrations,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppCueLog,
  ppEvents,
  ppFreeze,
  ppFx,
  ppLoadLevel,
  ppSend,
  ppSetFeel,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The catastrophe gauge and Mama's early return (story 3.16) on the live level, driven by the test API on
// a frozen level: `SetCatastrophe` takes the gauge where the case needs it, one step applies it, nothing
// waits on a fixed delay. No threat is planned (`?threats=off`), so no gag moves the gauge by itself. WebKit
// has no `navigator.vibrate`, so it checks the DOM and the cues only.

const LEVEL = 'salon_crawler';
const SEED = 42;
const FACE = '.pp-hud-catastrophe';
const PANEL = '.pp-result-panel';
const HEADER = `${PANEL} .pp-result-reason`;
const REPLAY = `${PANEL} .pp-result-actions .pp-button-primary`;
const SEQUENCE_TIMEOUT_MS = 15_000;
const GRACE_MARGIN_MS = 60;
/** The words the player never reads after an early end (NFR9, EXPERIENCE). */
const FORBIDDEN = ['perdu', 'échec', 'game over', 'mort'];
const { alertPct, faceStepsPct } = liveFeel.catastrophe;
/** Values inside each state, read from the live feel and never pinned. */
const FROWNING_PCT = (faceStepsPct[0] as number) + 1;
const WORRIED_PCT = (faceStepsPct[1] as number) + 1;
const ALARMED_PCT = alertPct + 5;

const hasVibrate = (): boolean => test.info().project.name === 'chromium';

const setCatastrophe = async (page: Page, pct: number): Promise<void> => {
  await ppSend(page, { type: 'SetCatastrophe', pct });
  await ppAdvance(page, 1);
};

/** Opens the frozen level, music running, no threat planned. */
async function openFrozen(page: Page): Promise<void> {
  await recordVibrations(page);
  await startLevel(page, THREATS_OFF);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
  await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
}

const waitForInputGrace = (page: Page): Promise<void> =>
  page.waitForTimeout(liveFeedback.resultScreen.inputGraceMs + GRACE_MARGIN_MS);

async function waitForActions(page: Page): Promise<void> {
  await passReplayToActions(page, SEQUENCE_TIMEOUT_MS);
  await waitForInputGrace(page);
}

test.describe('Mama’s face', () => {
  test('is serene at the start, in every level, with a spoken name and no number', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(page.locator(FACE)).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe', '0');
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe-face', 'serene');
    await expect(page.locator(FACE)).toHaveAttribute('role', 'img');
    await expect(page.locator(FACE)).toHaveAttribute(
      'aria-label',
      STRINGS['hud.catastrophe_serene'] as string,
    );
    // Beside the timer's icon, inside the timer pill: not a fourth gauge.
    await expect(page.locator(`.pp-hud-timer ${FACE}`)).toHaveCount(1);
    await expect(page.locator(`.pp-hud-gauges ${FACE}`)).toHaveCount(0);
    expect(await page.locator(FACE).innerText()).toBe('');
    await ppLoadLevel(page, 'chambre_night', SEED);
    await expect(page.locator(FACE)).toBeVisible();
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe-face', 'serene');
    expect(problems).toEqual([]);
  });

  test('shows the four states as the gauge rises, and the alert ring only above the threshold', async ({
    page,
  }) => {
    await openFrozen(page);
    const cues = await cueCount(page);
    for (const [pct, face, key] of [
      [FROWNING_PCT, 'frowning', 'hud.catastrophe_frowning'],
      [WORRIED_PCT, 'worried', 'hud.catastrophe_worried'],
    ] as const) {
      await setCatastrophe(page, pct);
      await expect(html(page)).toHaveAttribute('data-pp-catastrophe', String(pct));
      await expect(html(page)).toHaveAttribute('data-pp-catastrophe-face', face);
      await expect(page.locator(FACE)).toHaveAttribute('aria-label', STRINGS[key] as string);
      await expect(page.locator(FACE)).not.toHaveClass(/pp-hud-catastrophe--alarmed/);
    }
    // Under the threshold: no alert cue, whatever the face.
    expect(await cueCount(page)).toBe(cues);
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'off');
  });

  test('turns alarmed strictly above 70 %: one alert cue, one vibration, the ring, the tense music; again on the next crossing', async ({
    page,
  }) => {
    await openFrozen(page);
    const cues = await cueCount(page);
    const buzzes = hasVibrate() ? (await vibrations(page)).length : 0;
    // Exactly the threshold is not above it.
    await setCatastrophe(page, alertPct);
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe-face', 'worried');
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'off');
    expect(await cueCount(page)).toBe(cues);
    await setCatastrophe(page, ALARMED_PCT);
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe-face', 'alarmed');
    await expect(page.locator(FACE)).toHaveClass(/pp-hud-catastrophe--alarmed/);
    await expect(page.locator(FACE)).toHaveAttribute(
      'aria-label',
      STRINGS['hud.catastrophe_alarmed'] as string,
    );
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'on');
    expect(await cueCount(page)).toBe(cues + 1);
    if (hasVibrate()) {
      expect((await vibrations(page)).slice(buzzes)).toEqual([
        hapticPatternOf('CatastropheAlertReached'),
      ]);
    }
    // Still above: no second alert.
    await setCatastrophe(page, ALARMED_PCT + 5);
    expect(await cueCount(page)).toBe(cues + 1);
    // Back under, the music and the ring go; the next crossing alerts again.
    await setCatastrophe(page, WORRIED_PCT);
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe-face', 'worried');
    await expect(page.locator(FACE)).not.toHaveClass(/pp-hud-catastrophe--alarmed/);
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'off');
    await setCatastrophe(page, ALARMED_PCT);
    expect(await cueCount(page)).toBe(cues + 2);
    await expect(html(page)).toHaveAttribute('data-pp-music-tense', 'on');
  });

  test('pulses slower than 3 Hz, and slower still (1 Hz) under reduced motion, the alarmed face staying', async ({
    page,
  }) => {
    await openFrozen(page);
    await setCatastrophe(page, ALARMED_PCT);
    const read = () =>
      page.locator(FACE).evaluate((node) => ({
        name: getComputedStyle(node).animationName,
        durationS: Number.parseFloat(getComputedStyle(node).animationDuration),
        ring: getComputedStyle(node).boxShadow,
      }));
    const normal = await read();
    expect(normal.name).toBe('pp-catastrophe-pulse');
    // 3 Hz is a period of a third of a second: the pulse is slower.
    expect(normal.durationS).toBeGreaterThan(1 / 3);
    expect(normal.ring).not.toBe('none');
    await emulateReducedMotion(page);
    const reduced = await read();
    expect(reduced.name).toBe('pp-catastrophe-pulse');
    expect(reduced.durationS).toBeGreaterThanOrEqual(1);
    expect(reduced.durationS).toBeGreaterThan(normal.durationS);
    await expect(page.locator(FACE)).toHaveClass(/pp-hud-catastrophe--alarmed/);
  });

  test('stays on screen with the HUD zones intact on a short landscape phone', async ({ page }) => {
    await page.setViewportSize({ width: 667, height: 375 });
    await openFrozen(page);
    await setCatastrophe(page, ALARMED_PCT);
    const box = await page.locator(FACE).boundingBox();
    expect(box).not.toBeNull();
    expect(box?.y ?? -1).toBeGreaterThanOrEqual(0);
    // The HUD band stays within 12 % of the room's height, the bottom third free.
    expect((box?.y ?? 0) + (box?.height ?? 0)).toBeLessThanOrEqual(375 * 0.2);
  });
});

test.describe('Mama comes home early', () => {
  /** Above the alert first, so that the end itself plays no alert cue: the counts are then the result sequence's. */
  async function openAlarmed(page: Page): Promise<{ cues: number; buzzes: number }> {
    await openFrozen(page);
    await setCatastrophe(page, ALARMED_PCT);
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'playing');
    return {
      cues: await cueCount(page),
      buzzes: hasVibrate() ? (await vibrations(page)).length : 0,
    };
  }

  test('ends the level at 100 %: LevelEnded{mamaHome} at once, no MamaWoke, no rush, the photo, the door open', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openAlarmed(page);
    await setCatastrophe(page, 100);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'mamaHome');
    await expect(html(page)).toHaveAttribute('data-pp-photo', 'taken');
    const events = await ppEvents(page);
    const types = events.map((event) => event.type);
    expect(events.filter((event) => event.type === 'LevelEnded')).toMatchObject([
      { reason: 'mamaHome' },
    ]);
    expect(types).not.toContain('MamaWoke');
    expect(types).not.toContain('FinalRushStarted');
    expect(types.indexOf('LevelScored')).toBe(types.indexOf('LevelEnded') + 1);
    const world = await ppWorld(page);
    expect(world.flow).toMatchObject({ state: 'ended', endReason: 'mamaHome', finalRushAt: null });
    expect(world.time.sim).toBeLessThan(LEVEL_DURATION_MS);
    // The door bursts open: fully, in the photo's very frame.
    expect((await ppFx(page)).doorOpenDeg).toBe(liveFeedback.door.openAngleDeg);
    expect(problems).toEqual([]);
  });

  test('shows « Maman est rentrée plus tôt ! », the door slam, 0 earned and 0 lost stars, dashed empty slots, no forbidden word', async ({
    page,
  }) => {
    const before = await openAlarmed(page);
    await setCatastrophe(page, 100);
    // The header comes with the rows, after the photo and Mama's reactions (story 3.7).
    await expect(page.locator(HEADER)).toBeVisible({ timeout: SEQUENCE_TIMEOUT_MS });
    await expect(page.locator(HEADER)).toHaveText(STRINGS['result.mama_home'] as string);
    await expect(page.locator(`${PANEL}.pp-result-panel-home`)).toHaveCount(1);
    await waitForActions(page);
    await expect(html(page)).toHaveAttribute('data-pp-stars', '0');
    await expect(html(page)).toHaveAttribute('data-pp-lost-stars', '0');
    await expect(page.locator(`${PANEL} .pp-star-earned`)).toHaveCount(0);
    await expect(page.locator(`${PANEL} .pp-star-lost`)).toHaveCount(0);
    await expect(page.locator(`${PANEL} .pp-star-lost-chip`)).toHaveCount(0);
    await expect(page.locator(`${PANEL} .pp-star-empty`)).toHaveCount(5);
    const dashed = await page
      .locator(`${PANEL} .pp-star-empty .pp-star-shape`)
      .evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).strokeDasharray));
    expect(dashed).toHaveLength(5);
    expect(dashed.every((dash) => dash !== 'none')).toBe(true);
    // The underline is not Mama's scream red.
    const shadow = await page.locator(HEADER).evaluate((node) => getComputedStyle(node).boxShadow);
    const scream = await page.evaluate(() => {
      const probe = document.createElement('div');
      probe.style.color = 'var(--pp-color-mama-scream)';
      document.body.append(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    });
    expect(shadow).not.toContain(scream);
    // The shutter, Mama's reactions (she always screams on this end, story 3.7), then the door slam (a heavy
    // buzz), and nothing else: no star was stamped.
    const note = (await ppWorld(page)).score.final;
    if (note === null) throw new Error('no note after Mama came home');
    const reactions = mamaReactionsOf(note, 'mamaHome');
    expect(reactions.map(({ reaction }) => reaction)).toContain('scream');
    expect(await cueCount(page)).toBe(before.cues + 1 + reactions.length + 1);
    const cues = (await ppCueLog(page)).map((record) => record.cueId);
    expect(cues.indexOf(mamaCueOf('scream'))).toBeLessThan(cues.indexOf('mama_home'));
    if (hasVibrate()) {
      expect((await vibrations(page)).slice(before.buzzes)).toEqual([
        hapticPatternOf('PhotoTaken'),
        ...mamaHapticsOf(reactions),
        hapticPatternOf('ResultMamaHomeShown'),
      ]);
    }
    const text = (await page.locator(PANEL).innerText()).toLowerCase();
    for (const word of FORBIDDEN) expect(text).not.toContain(word);
    await expect(page.locator(REPLAY)).toBeFocused();
    await expect(page.locator(REPLAY)).toHaveClass(/pp-button-primary/);
  });

  test('« Rejouer » starts a fresh level: the reason and the worry are forgotten', async ({
    page,
  }) => {
    await openAlarmed(page);
    await setCatastrophe(page, 100);
    await waitForActions(page);
    await page.locator(REPLAY).click();
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level');
    await expect(html(page)).not.toHaveAttribute('data-pp-end-reason', /.*/);
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe', '0');
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe-face', 'serene');
  });
});

test.describe('the gauge in the final rush', () => {
  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    'Chromium only, like the rush (story 3.5)',
  );

  test('is frozen: a command to 100 % moves nothing, and the level still ends on the photo', async ({
    page,
  }) => {
    const rushAtMs = 2000;
    await page.goto(appUrl(`/${THREATS_OFF}`));
    await waitForTestApi(page);
    await ppFreeze(page, true);
    await ppLoadLevel(page, LEVEL, SEED);
    await ppSetFeel(page, { endOfLevel: { finalRushMs: LEVEL_DURATION_MS - rushAtMs } });
    await setCatastrophe(page, 60);
    await ppAdvance(page, Math.ceil(rushAtMs / STEP_MS));
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'finalRush');
    const before = (await ppWorld(page)).gauges.catastrophePct;
    expect(before).toBeGreaterThan(0);
    const mark = (await ppEvents(page)).length;
    await setCatastrophe(page, 100);
    expect((await ppWorld(page)).gauges.catastrophePct).toBe(before);
    expect((await ppEvents(page, mark)).some((event) => event.type === 'CatastropheChanged')).toBe(
      false,
    );
    await expect(html(page)).toHaveAttribute('data-pp-flow', 'finalRush');
    await expect(html(page)).toHaveAttribute('data-pp-catastrophe-face', 'worried');
    // To the end of the level: the photo, on the timer.
    let remaining = Math.ceil((LEVEL_DURATION_MS - (await ppWorld(page)).time.sim) / STEP_MS);
    while (remaining > 0) {
      const chunk = Math.min(500, remaining);
      await ppAdvance(page, chunk);
      remaining -= chunk;
    }
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    await expect(html(page)).toHaveAttribute('data-pp-end-reason', 'timer');
    expect((await ppEvents(page)).filter((event) => event.type === 'LevelEnded')).toMatchObject([
      { reason: 'timer' },
    ]);
  });
});
