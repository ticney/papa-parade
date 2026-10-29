import { expect, type Page, test } from '@playwright/test';
import { HUD_MAX_DOM_NODES, STEP_MS } from '../../src/shared/constants.ts';
import {
  collectProblems,
  hapticPatternOf,
  html,
  recordVibrations,
  vibrations,
} from './support/game.ts';
import { STRINGS } from './support/strings.ts';
import {
  ppAdvance,
  ppFreeze,
  ppLoadLevel,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The noise gauge (story 3.1) on the live level, driven by the test API on a frozen level: steps by
// hand and `SetNoise`, so nothing waits on a fixed delay. Chromium and WebKit both run it; WebKit has
// no `navigator.vibrate`, so it checks the class only.

const LEVEL = 'salon_crawler';
const SEED = 42;
const PILL = '[data-pp-zone="gauges"] > .pp-hud-gauges';
const GAUGES = `${PILL} > .pp-hud-gauge`;
const NOISE = `${PILL} > .pp-hud-gauge[aria-label^="${STRINGS['gauge.noise']} "]`;
const ALERT_PATTERN = hapticPatternOf('NoiseAlertReached');
const hasVibrate = (): boolean => test.info().project.name === 'chromium';

async function openFrozen(page: Page): Promise<void> {
  await page.goto('/');
  await waitForTestApi(page);
  await ppFreeze(page, true);
  await ppLoadLevel(page, LEVEL, SEED);
}

/** The noise gauge's fill scale, read from its computed `transform` matrix. */
async function fillScale(page: Page): Promise<number> {
  const matrix = await page
    .locator(`${NOISE} .pp-hud-gauge-fill`)
    .evaluate((element) => getComputedStyle(element).transform);
  return Number(/^matrix\(([-\d.e]+),/.exec(matrix)?.[1]);
}

test.describe('the noise gauge', () => {
  test('is the first gauge of the pill, before Fatigue, both at 0 %', async ({ page }) => {
    const problems = collectProblems(page);
    await openFrozen(page);
    await expect(page.locator(GAUGES)).toHaveCount(2);
    await expect(page.locator(GAUGES).nth(0)).toHaveAttribute(
      'aria-label',
      `${STRINGS['gauge.noise']} 0 %`,
    );
    await expect(page.locator(GAUGES).nth(1)).toHaveAttribute(
      'aria-label',
      `${STRINGS['gauge.fatigue']} 0 %`,
    );
    await expect(page.locator(NOISE)).toHaveClass(/pp-hud-gauge-idle/);
    expect(problems).toEqual([]);
  });

  test('keeps the HUD within its node budget with both gauges', async ({ page }) => {
    await openFrozen(page);
    await expect(page.locator(GAUGES)).toHaveCount(2);
    const nodes = await page.evaluate(() => document.querySelectorAll('#pp-hud *').length);
    expect(nodes).toBeLessThanOrEqual(HUD_MAX_DOM_NODES);
  });

  test('goes warm from 70 %: SetNoise 75 shows the warn class and a fill of scaleX(0.75)', async ({
    page,
  }) => {
    await openFrozen(page);
    await ppSend(page, { type: 'SetNoise', pct: 75 });
    await ppAdvance(page, 3);
    await expect(page.locator(NOISE)).toHaveClass(/pp-hud-gauge-warn/);
    await expect(page.locator(NOISE)).toHaveCSS('opacity', '1');
    await expect(page.locator(NOISE)).toHaveAttribute('aria-label', /^Bruit 7[45] %$/);
    // 75 less three steps of decay, rounded to the whole percent the gauge shows.
    expect(await fillScale(page)).toBeCloseTo(0.75, 2);
    // The decay is silent: the mirror holds the rounded value of the last event, never per frame.
    await expect(html(page)).toHaveAttribute('data-pp-noise', '75');
  });

  test('falls by decayPerSec: 10 s of sim time take 50 down to 40 (±0.5)', async ({ page }) => {
    await openFrozen(page);
    await ppSend(page, { type: 'SetNoise', pct: 50 });
    await ppAdvance(page, 1);
    const from = (await ppWorld(page)).gauges.noisePct;
    await ppAdvance(page, Math.round(10_000 / STEP_MS));
    const world = await ppWorld(page);
    expect(from).toBeGreaterThan(49.9);
    expect(world.gauges.noisePct).toBeGreaterThan(39.5);
    expect(world.gauges.noisePct).toBeLessThan(40.5);
  });

  test('alerts above 80 %: the class, and the medium vibration where the device has one', async ({
    page,
  }) => {
    const problems = collectProblems(page);
    await recordVibrations(page);
    await openFrozen(page);
    const before = (await vibrations(page)).length;
    await ppSend(page, { type: 'SetNoise', pct: 90 });
    await ppAdvance(page, 2);
    await expect(page.locator(NOISE)).toHaveClass(/pp-hud-gauge-alert/);
    const patterns = (await vibrations(page)).slice(before);
    if (!hasVibrate() || ALERT_PATTERN === null) expect(patterns).toEqual([]);
    else expect(patterns).toEqual([ALERT_PATTERN]);

    // Once only while it stays above: more noise above the threshold does not alert again.
    await ppSend(page, { type: 'SetNoise', pct: 95 });
    await ppAdvance(page, 2);
    expect((await vibrations(page)).slice(before).length).toBe(patterns.length);
    expect(problems).toEqual([]);
  });

  test('the alert class goes away by itself, and comes back on the next upward crossing', async ({
    page,
  }) => {
    await recordVibrations(page);
    await openFrozen(page);
    await ppSend(page, { type: 'SetNoise', pct: 90 });
    await ppAdvance(page, 2);
    await expect(page.locator(NOISE)).toHaveClass(/pp-hud-gauge-alert/);
    // The one-shot is taken off after its run, in real time (the frame loop does it).
    await expect(page.locator(NOISE)).not.toHaveClass(/pp-hud-gauge-alert/);
    const vibrationsBefore = (await vibrations(page)).length;
    // A fall below the threshold re-arms it.
    await ppSend(page, { type: 'SetNoise', pct: 40 });
    await ppAdvance(page, 2);
    await ppSend(page, { type: 'SetNoise', pct: 90 });
    await ppAdvance(page, 2);
    await expect(page.locator(NOISE)).toHaveClass(/pp-hud-gauge-alert/);
    if (hasVibrate() && ALERT_PATTERN !== null) {
      expect((await vibrations(page)).length).toBe(vibrationsBefore + 1);
    }
  });
});
