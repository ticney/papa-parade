import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import {
  advanceToEnd,
  collectProblems,
  hapticPatternOfCue,
  html,
  LEVEL_DURATION_MS,
  liveFeedback,
  liveFeel,
  liveThreat,
  pauseButton,
  recordVibrations,
  setVisibility,
  startLevel,
  vibrations,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppCueLog,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// Fatherly Instinct (story 2.9) on the live level, through the mirrors, `window.__PP__` and DOM
// attributes: the instinct comes from the debug command `ForceInstinct` (on the live level the real
// trigger is rare, see the story), the level is frozen and stepped by hand, so nothing waits on a
// fixed delay. Chromium and WebKit both run it; WebKit has no `navigator.vibrate`, so the pattern
// is checked on Chromium only. What is read of the feel is read from the live file, never typed.

const LEVEL = 'salon_crawler';
const SEED = 42;
const VIGNETTE = '.pp-instinct-vignette';
const hasVibrate = (): boolean => test.info().project.name === 'chromium';
const { instinct } = liveFeel;
const RETURN_STEPS = Math.ceil(instinct.returnMs / STEP_MS);
/** The dodge colour (DESIGN.md, `--pp-color-dodge`): the vignette is never red. */
const DODGE_RED = 'rgb(240, 53, 61)';
/** The vignette token (`--pp-color-vignette`), as the browser serializes it. */
const VIGNETTE_COLOUR = 'rgba(42, 33, 64, 0.35)';

async function openFrozen(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

async function startInstinct(page: Page): Promise<void> {
  await ppSend(page, { type: 'ForceInstinct' });
  await ppAdvance(page, 2);
  await expect(html(page)).toHaveAttribute('data-pp-instinct', 'on');
}

const opacityOf = (page: Page): Promise<number> =>
  page.locator(VIGNETTE).evaluate((element) => Number(getComputedStyle(element).opacity));

test.describe('Fatherly Instinct', () => {
  test('darkens the edge of the room, never red, and slows the sim to the feel’s scale', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(html(page)).not.toHaveAttribute('data-pp-instinct', /.*/);
    await expect(page.locator(VIGNETTE)).not.toHaveClass(/pp-instinct-vignette-on/);
    await startInstinct(page);

    await expect(page.locator(VIGNETTE)).toHaveClass(/pp-instinct-vignette-on/);
    // A fade of about 200 ms: the opacity climbs from 0, it is above 0 soon after.
    await expect.poll(() => opacityOf(page)).toBeGreaterThan(0);
    const background = await page
      .locator(VIGNETTE)
      .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(background).toContain(VIGNETTE_COLOUR);
    expect(background).not.toContain(DODGE_RED);
    await expect(page.locator(VIGNETTE)).toHaveAttribute('aria-hidden', 'true');
    expect(await page.locator(VIGNETTE).evaluate((el) => getComputedStyle(el).pointerEvents)).toBe(
      'none',
    );

    const world = await ppWorld(page);
    expect(world.time.scale).toBe(instinct.timeScale);
    expect(world.instinct.state).toBe('active');
    expect(problems).toEqual([]);
  });

  test('sits under the markers and the HUD: right before #pp-world, z-index 4 against 5 and 10', async ({
    page,
  }) => {
    await openFrozen(page);
    await startInstinct(page);
    const layers = await page.evaluate(() => {
      const vignette = document.querySelector('.pp-instinct-vignette');
      const world = document.getElementById('pp-world');
      const hud = document.getElementById('pp-hud');
      const z = (element: Element | null): number =>
        Number(element === null ? Number.NaN : getComputedStyle(element).zIndex);
      return {
        isBeforeWorld: vignette !== null && vignette.nextElementSibling === world,
        vignette: z(vignette),
        world: z(world),
        hud: z(hud),
      };
    });
    expect(layers.isBeforeWorld).toBe(true);
    expect(layers.vignette).toBeLessThan(layers.world);
    expect(layers.world).toBeLessThan(layers.hud);
  });

  test('plays the heartbeat cue with its uiElement twin and the lub-dub vibration', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    const vibrationsBefore = hasVibrate() ? (await vibrations(page)).length : 0;
    await startInstinct(page);

    const played = (await ppCueLog(page)).filter((record) => record.cueId === 'instinct_triggered');
    expect(played).toHaveLength(1);
    expect(played[0]?.visuals).toContain('uiElement');
    expect(played[0]?.haptic).toBe('heartbeat');
    expect(liveFeedback.cues.instinct_triggered?.audio?.clip).toBe('papa_heartbeat');
    if (hasVibrate()) {
      const pattern = hapticPatternOfCue('instinct_triggered');
      expect(pattern).not.toBeNull();
      expect((await vibrations(page)).slice(vibrationsBefore).map(String)).toContain(
        String(pattern),
      );
    }
    // Once per instinct: nothing more while it lasts.
    await ppAdvance(page, 10);
    expect(
      (await ppCueLog(page)).filter((record) => record.cueId === 'instinct_triggered'),
    ).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  test('widens a window telegraphed during it, and ends by the timer: the vignette off, the scale back at 1', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await startInstinct(page);
    const untilAt = (await ppWorld(page)).instinct.untilAt;

    // Telegraphed 100 ms before the end, so that it is still up (its window open) after the end and
    // the return: a threat forced at the start would be gagged long before.
    const lateAt = untilAt - 100;
    await ppAdvance(page, Math.floor((lateAt - (await ppWorld(page)).time.sim) / STEP_MS));
    const threat = (await ppWorld(page)).threats.find((candidate) => candidate.state === 'idle');
    expect(threat, 'the live level plans a threat that is idle').toBeDefined();
    await ppSend(page, { type: 'ForceThreat', threatId: threat?.id as number });
    await ppAdvance(page, 2);
    const telegraphed = (await ppWorld(page)).threats.find(
      (candidate) => candidate.id === threat?.id,
    );
    const baseMs = liveThreat(telegraphed?.defId as string).windowMs ?? liveFeel.timing.windowMs;
    const widenedMs = baseMs * (1 + instinct.windowBonusPct / 100);
    expect(telegraphed?.state).toBe('telegraph');
    expect(telegraphed?.responseWindow?.windowMs).toBeCloseTo(widenedMs, 6);

    // Up to the end of the instinct, and past its return.
    const now = (await ppWorld(page)).time.sim;
    await ppAdvance(page, Math.ceil((untilAt - now) / STEP_MS));
    await expect(html(page)).toHaveAttribute('data-pp-instinct', 'timer');
    expect((await ppWorld(page)).instinct.state).toBe('cooldown');
    await expect(page.locator(VIGNETTE)).not.toHaveClass(/pp-instinct-vignette-on/);
    await ppAdvance(page, RETURN_STEPS + 2);
    expect((await ppWorld(page)).time.scale).toBe(1);
    // The window telegraphed during it kept its length after the end (and is still there to read).
    const after = (await ppWorld(page)).threats.find((candidate) => candidate.id === threat?.id);
    expect(after?.responseWindow, 'the threat is still up after the end').toBeTruthy();
    expect(after?.responseWindow?.windowMs).toBeCloseTo(widenedMs, 6);
    expect(problems).toEqual([]);
  });

  test('follows the state, not the events: a pause turns the vignette off, the resume turns it back on', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await startInstinct(page);
    const untilAt = (await ppWorld(page)).instinct.untilAt;
    await expect(page.locator(VIGNETTE)).toHaveClass(/pp-instinct-vignette-on/);

    await setVisibility(page, 'hidden');
    await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
    await expect(page.locator(VIGNETTE)).not.toHaveClass(/pp-instinct-vignette-on/);
    await setVisibility(page, 'visible');
    await pauseButton(page, STRINGS['pause.resume'] as string).click();
    await expect(html(page)).toHaveAttribute('data-pp-state', 'running', { timeout: 10_000 });
    await expect(page.locator(VIGNETTE)).toHaveClass(/pp-instinct-vignette-on/);
    // The end has not moved in sim time.
    const world = await ppWorld(page);
    expect(world.instinct).toMatchObject({ state: 'active', untilAt });
    expect(problems).toEqual([]);
  });

  test('ends with the level: ppInstinct is levelEnded and the Result screen has no vignette', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    // Up to a second before the end, in chunks, then the instinct, then the end of the level.
    let remaining = Math.floor((LEVEL_DURATION_MS - 1000) / STEP_MS);
    while (remaining > 0) {
      const chunk = Math.min(3000, remaining);
      await ppAdvance(page, chunk);
      remaining -= chunk;
    }
    await startInstinct(page);
    await advanceToEnd(page);
    await expect(html(page)).toHaveAttribute('data-pp-instinct', 'levelEnded');
    await expect(html(page)).toHaveAttribute('data-pp-app', 'result');
    await expect(page.locator(VIGNETTE)).not.toHaveClass(/pp-instinct-vignette-on/);
    expect(problems).toEqual([]);
  });
});

test.describe('Fatherly Instinct at the experienced tier', () => {
  test('ForceInstinct does nothing: no event, no mirror, no vignette, the scale stays at 1', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await page.addInitScript(
      ([key, value]) => localStorage.setItem(key as string, value as string),
      [SAVE_STORAGE_KEY, calibratedSaveValue({}, { tier: 'experienced' })],
    );
    await startLevel(page);
    await ppFreeze(page, true);
    expect((await ppWorld(page)).difficultyTier).toBe('experienced');
    await ppSend(page, { type: 'ForceInstinct' });
    await ppAdvance(page, 5);
    await expect(html(page)).not.toHaveAttribute('data-pp-instinct', /.*/);
    await expect(page.locator(VIGNETTE)).not.toHaveClass(/pp-instinct-vignette-on/);
    const world = await ppWorld(page);
    expect(world.instinct.state).toBe('ready');
    expect(world.time.scale).toBe(1);
    expect(problems).toEqual([]);
  });
});
