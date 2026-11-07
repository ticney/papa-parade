import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { THREAT_ICON_PATHS } from '../../src/client/ui/world/threatMarkers.ts';
import { RESUME_COUNTDOWN_MS, STEP_MS } from '../../src/shared/constants.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  advanceTo,
  cueIds,
  openFrozen,
  shot,
  shownMarkers,
  start,
  threatOf,
  typesOf,
  untilTelegraphed,
} from './support/duel.ts';
import {
  appUrl,
  collectProblems,
  hapticPatternOfCue,
  html,
  liveFeel,
  OVERRUN_MARGIN_MS,
  recordVibrations,
  setVisibility,
  vibrations,
  waitFrames,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import { ppAdvance, ppFx, ppSend, ppState, ppWorld, waitForTestApi } from './support/testApi.ts';

// « Dépose-bombe » (story 4.8) on the live level, driven by the test API on a frozen level (steps by
// hand) with real input, and in real time for the autoplay. The drop is one `duel` step on a Firmness
// judged on its release: the finger goes down early in the descent and comes up at the pose. Every
// bound is read from the world (`enteredAt`, `windowOpenAt`, the frozen window) or the live content;
// nothing waits on a fixed delay. The baby's height is `__PP__.fx().babyLayDownPct`, the lowering as
// drawn, never a pixel. Chromium and WebKit both run it; the vibrations are checked on Chromium only.

const isChromium = (): boolean => test.info().project.name === 'chromium';
const LAY = 'bomb_drop_lay';
const SEQUENCE = 'bomb_drop';
const SIGNAL_CUE = 'bomb_drop_touchdown';
const GAG_CUE = 'gag_baby_woke_on_drop';
const { holdMinMs } = liveFeel.input;

const sequenceDef = JSON.parse(readFileSync('content/sequences/bomb_drop.json', 'utf8')) as {
  steps: { slowMo: { timeScale: number } }[];
};
const SLOW_MO_SCALE = sequenceDef.steps[0]?.slowMo.timeScale ?? Number.NaN;
const geometry = JSON.parse(readFileSync('content/levels/salon_crawler.geometry.json', 'utf8')) as {
  zones: { kind: string; centerM: number[]; halfExtentsM: number[] }[];
};
const playpen = geometry.zones.find((zone) => zone.kind === 'safe');

const ring = (page: Page) => page.locator('.pp-threat-hold');

/** The finger goes down in the bottom-left of the canvas: far from the marker, clear of the HUD. */
async function fingerDown(page: Page): Promise<void> {
  const box = await page.locator('#pp-canvas').boundingBox();
  if (box === null) throw new Error('the canvas has no box');
  await page.mouse.move(box.x + box.width * 0.1, box.y + box.height * 0.9);
  await page.mouse.down();
}

/** The drop started and its descent telegraphed: the finger is still up. */
async function reachDrop(page: Page) {
  await openFrozen(page);
  await start(page, SEQUENCE);
  const round = await untilTelegraphed(page, LAY);
  const lay = threatOf(await ppWorld(page), LAY);
  if (lay === undefined) throw new Error('the level plans no bomb drop');
  return { ...round, enteredAt: lay.enteredAt, lay };
}

const layDownPct = async (page: Page): Promise<number> => (await ppFx(page)).babyLayDownPct;

test.describe('the start', () => {
  test('puts Papa over the playpen with the baby in his arms, and starts the music', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    const before = await ppWorld(page);
    if (playpen === undefined) throw new Error('the live room has no safe zone');
    // He starts outside the playpen: the start places him, it does not refuse.
    expect(
      Math.abs(before.papa.xM - (playpen.centerM[0] as number)) >
        (playpen.halfExtentsM[0] as number),
    ).toBe(true);
    await start(page, SEQUENCE);
    const world = await ppWorld(page);
    expect(world.papa.xM).toBeCloseTo(playpen.centerM[0] as number, 5);
    expect(world.papa.zM).toBeCloseTo(playpen.centerM[2] as number, 5);
    await expect(html(page)).toHaveAttribute('data-pp-sequence', SEQUENCE);
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carried');
    await expect(html(page)).toHaveAttribute('data-pp-sequence-music', 'on');
    expect(problems).toEqual([]);
  });
});

test.describe('the descent', () => {
  test('a held press: the ring closes, « TIENS… », the sweat, never « POSE-LE D’ABORD ! », the baby goes down', async ({
    page,
  }, testInfo) => {
    const problems = collectProblems(page);
    const { enteredAt, windowOpenAt } = await reachDrop(page);
    expect(await layDownPct(page)).toBeLessThan(10);
    await fingerDown(page);
    await advanceTo(page, enteredAt + holdMinMs + 2 * STEP_MS);
    await expect(ring(page)).toHaveClass(/pp-threat-hold--closed/);
    await expect.poll(async () => (await shownMarkers(page)).length).toBe(1);
    const [marker] = await shownMarkers(page);
    expect(marker).toEqual(
      expect.objectContaining({
        verb: STRINGS['verb.hold_on'] as string,
        glyph: THREAT_ICON_PATHS.sweat,
      }),
    );
    expect(marker?.verb).not.toBe(STRINGS['verb.put_down_first'] as string);
    expect(marker?.classes).not.toContain('pp-threat--signal');
    // Half way down the descent, about half way down the baby; further on, further down.
    await advanceTo(page, enteredAt + (windowOpenAt - enteredAt) / 2);
    const half = await layDownPct(page);
    expect(half).toBeGreaterThan(35);
    expect(half).toBeLessThan(65);
    await advanceTo(page, enteredAt + ((windowOpenAt - enteredAt) * 3) / 4);
    expect(await layDownPct(page)).toBeGreaterThan(half);
    await shot(page, testInfo, 'bomb-drop-descent.png');
    expect(await cueIds(page)).not.toContain(SIGNAL_CUE);
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test('the world runs at the step’s time scale during the descent, and back at 1 after the end', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    const { enteredAt, windowOpenAt, windowMs } = await reachDrop(page);
    expect((await ppWorld(page)).time.scale).toBe(SLOW_MO_SCALE);
    await fingerDown(page);
    await advanceTo(page, enteredAt + 500);
    expect((await ppWorld(page)).time.scale).toBe(SLOW_MO_SCALE);
    await advanceTo(page, windowOpenAt + windowMs / 2);
    await page.mouse.up();
    await ppAdvance(page, 3);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded');
    // The perfect's and the cash-in's own slow motions run out too, well within five seconds.
    await ppAdvance(page, 500);
    expect((await ppWorld(page)).time.scale).toBe(1);
    expect(problems).toEqual([]);
  });
});

test.describe('the pose', () => {
  test('« LÂCHE ! » and the open hand, the touchdown cue, the vibration, the baby all the way down', async ({
    page,
  }, testInfo) => {
    await recordVibrations(page);
    const problems = collectProblems(page);
    const { windowOpenAt } = await reachDrop(page);
    await fingerDown(page);
    await advanceTo(page, windowOpenAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.open_hand);
    const [marker] = await shownMarkers(page);
    expect(marker).toEqual(
      expect.objectContaining({
        verb: STRINGS['verb.let_go'] as string,
        glyph: THREAT_ICON_PATHS.open_hand,
      }),
    );
    expect(marker?.classes).toContain('pp-threat--signal');
    expect(await cueIds(page)).toContain(SIGNAL_CUE);
    expect(await layDownPct(page)).toBe(100);
    if (isChromium()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue(SIGNAL_CUE));
    }
    await shot(page, testInfo, 'bomb-drop-pose.png');
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test('a release in the window lays the baby and cashes the combo in', async ({ page }) => {
    const problems = collectProblems(page);
    const { windowOpenAt, windowMs } = await reachDrop(page);
    await fingerDown(page);
    await advanceTo(page, windowOpenAt + windowMs / 2);
    await page.mouse.up();
    await ppAdvance(page, 3);
    expect(await cueIds(page)).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^resp_firm(_perfect)?$/),
        'baby_put_down',
        'combo_cashed_in',
      ]),
    );
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded');
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'babble');
    await expect(html(page)).toHaveAttribute('data-pp-put-down', 'safe');
    await expect(html(page)).toHaveAttribute('data-pp-combo-cashed', /\d/);
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([]);
    expect(problems).toEqual([]);
  });

  test('Space is the press and the release too', async ({ page }) => {
    const problems = collectProblems(page);
    const { windowOpenAt, windowMs } = await reachDrop(page);
    await page.keyboard.down('Space');
    await advanceTo(page, windowOpenAt + windowMs / 2);
    await page.keyboard.up('Space');
    await ppAdvance(page, 3);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded');
    expect(await typesOf(page, 'ResponseResolved')).toEqual([
      expect.objectContaining({
        response: 'firm',
        quality: expect.stringMatching(/success|perfect/),
      }),
    ]);
    expect(problems).toEqual([]);
  });
});

test.describe('the failures', () => {
  test('a tap at once: the gag, one retreat, the baby back up', async ({ page }) => {
    const problems = collectProblems(page);
    await reachDrop(page);
    await fingerDown(page);
    await ppAdvance(page, 3);
    await page.mouse.up();
    await ppAdvance(page, 3);
    expect(await cueIds(page)).toContain(GAG_CUE);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-retreats', '1');
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({ fromStepIndex: 0, stepIndex: 0, retreats: 1, reason: 'released' }),
    ]);
    // The baby goes back up at once, in his arms.
    expect(await layDownPct(page)).toBe(0);
    await expect(html(page)).toHaveAttribute('data-pp-baby-state', 'carried');
    expect(problems).toEqual([]);
  });

  test('held past the pose: the same gag, by late', async ({ page }) => {
    const problems = collectProblems(page);
    const { windowOpenAt, windowMs } = await reachDrop(page);
    await fingerDown(page);
    await advanceTo(page, windowOpenAt + windowMs + liveFeel.timing.toleranceMs + 5 * STEP_MS);
    expect(await cueIds(page)).toContain(GAG_CUE);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-retreats', '1');
    expect(await typesOf(page, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
    expect(await layDownPct(page)).toBe(0);
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test('a pause during the hold lets go of the finger: a released gag', async ({ page }) => {
    const problems = collectProblems(page);
    const { enteredAt } = await reachDrop(page);
    await fingerDown(page);
    await advanceTo(page, enteredAt + 500);
    await setVisibility(page, 'hidden');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await ppAdvance(page, 3);
    expect(await typesOf(page, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'released' }),
    ]);
    await expect(html(page)).toHaveAttribute('data-pp-sequence-retreats', '1');
    expect(problems).toEqual([]);
  });
});

test.describe('the options', () => {
  test('under reduced motion the lowering stays and the pop goes', async ({ page }, testInfo) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const problems = collectProblems(page);
    const { enteredAt, windowOpenAt } = await reachDrop(page);
    await fingerDown(page);
    await advanceTo(page, enteredAt + (windowOpenAt - enteredAt) / 2);
    // Motion-essential: it is what the release is aimed at.
    expect(await layDownPct(page)).toBeGreaterThan(35);
    await advanceTo(page, windowOpenAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.glyph)
      .toBe(THREAT_ICON_PATHS.open_hand);
    const animation = await page
      .locator('.pp-threat--signal .pp-threat-icon')
      .evaluate((element) => getComputedStyle(element).animationName);
    expect(animation).toBe('none');
    await shot(page, testInfo, 'bomb-drop-reduced.png');
    await page.mouse.up();
    expect(problems).toEqual([]);
  });

  test('with the sfx bus at 0 the verb, the glyph and the vibration still come', async ({
    page,
  }) => {
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
    await start(page, SEQUENCE);
    const { windowOpenAt } = await untilTelegraphed(page, LAY);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.verb)
      .toBe(STRINGS['verb.hold_on'] as string);
    // Nobody pressing within `pressWithinMs` is a gag long before the pose: the finger is down.
    await fingerDown(page);
    await advanceTo(page, windowOpenAt + STEP_MS);
    await expect
      .poll(async () => (await shownMarkers(page))[0]?.verb)
      .toBe(STRINGS['verb.let_go'] as string);
    expect(await cueIds(page)).toContain(SIGNAL_CUE);
    if (isChromium()) {
      expect(await vibrations(page)).toContainEqual(hapticPatternOfCue(SIGNAL_CUE));
    }
    await page.mouse.up();
    await waitFrames(page, 2);
    expect(problems).toEqual([]);
  });
});

test.describe('autoplay', () => {
  test('the perfect bot lays the baby: outcome succeeded, started by the test API', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const problems = collectProblems(page);
    await page.goto(appUrl('/?autoplay=perfect&seed=42&speed=4'));
    await waitForTestApi(page);
    await expect(html(page)).toHaveAttribute('data-pp-app', 'level', { timeout: 20_000 });
    await expect.poll(async () => (await ppState(page)) !== null).toBe(true);
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', {
      timeout: RESUME_COUNTDOWN_MS + OVERRUN_MARGIN_MS,
    });
    await ppSend(page, { type: 'StartSequence', sequenceId: SEQUENCE });
    await expect(
      html(page),
      'StartSequence was refused (Papa busy, a silence or a ringing phone at the start)',
    ).toHaveAttribute('data-pp-sequence', SEQUENCE, { timeout: 5_000 });
    await expect(html(page)).toHaveAttribute('data-pp-sequence-outcome', 'succeeded', {
      timeout: 60_000,
    });
    expect(await typesOf(page, 'SequenceStepRetreated')).toEqual([]);
    expect(await typesOf(page, 'BabyPutDown')).toEqual([expect.objectContaining({ safe: true })]);
    expect(problems).toEqual([]);
  });
});
