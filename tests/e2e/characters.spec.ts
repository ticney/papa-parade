import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { html, sceneShot, startLevel, waitFrames } from './support/game.ts';
import {
  ppAdvance,
  ppEvents,
  ppFreeze,
  ppFx,
  ppSend,
  ppWorld,
  waitForTestApi,
} from './support/testApi.ts';

// The rigged characters (story 7.2) in the real game: clips chosen from the sim, mixers on the sim
// clock, the look. How they look is Geo's call: nothing here judges the art.

const SAMPLED_FRAMES_MAX = 4000;
/** Real ms a game of the perfect bot takes to reach its first perfect at speed 4, with room to spare. */
const FIRST_PERFECT_TIMEOUT_MS = 40_000;
/** What may separate the mixer's clock from the sim's: `alpha` of a step on either side. */
const CLOCK_TOLERANCE_MS = 2 * STEP_MS;

const clipsOf = async (page: Page): Promise<[string | null, string | null]> => {
  await waitFrames(page, 2);
  const fx = await ppFx(page);
  return [fx.papaClip, fx.babyClip];
};

test('the clips follow the sim: Papa walks, the baby crawls, and carrying changes both', async ({
  page,
}) => {
  await startLevel(page);
  await ppFreeze(page, true);
  await ppAdvance(page, 10);
  expect(await clipsOf(page)).toEqual(['idle', 'babble']);

  const { papa } = await ppWorld(page);
  await ppSend(page, { type: 'TapFloor', xM: papa.xM - 1, zM: papa.zM });
  await ppAdvance(page, 10);
  expect((await clipsOf(page))[0]).toBe('walk');
  for (let i = 0; i < 100 && (await ppWorld(page)).papa.state !== 'idle'; i++) {
    await ppAdvance(page, 10);
  }
  await waitFrames(page, 2);

  for (let i = 0; i < 400 && (await ppWorld(page)).baby.state !== 'wander'; i++) {
    await ppAdvance(page, 10);
  }
  expect((await clipsOf(page))[1]).toBe('crawl');

  await ppSend(page, { type: 'TapBaby' });
  for (let i = 0; i < 400 && (await ppWorld(page)).baby.state !== 'carried'; i++) {
    await ppAdvance(page, 10);
  }
  expect((await clipsOf(page))[0]).toBe('carry_idle');
  // The clip that is seen stays a one-shot for a moment: the state's loop comes after it.
  await ppAdvance(page, 100);
  expect(await clipsOf(page)).toEqual(['carry_idle', 'carried']);
});

test('the mixers run on the sim clock: a hitstop holds them, and a pause too', async ({ page }) => {
  await page.goto('/?autoplay=perfect&seed=42&speed=4');
  await waitForTestApi(page);
  await page.evaluate((max) => {
    const samples: [number, number][] = [];
    (window as unknown as { ppClockSamples: unknown }).ppClockSamples = samples;
    const sample = (): void => {
      const api = window.__PP__;
      const world = api?.state();
      if (api !== undefined && world !== null && world !== undefined && samples.length < max) {
        samples.push([world.time.sim, api.fx().papaMixerMs]);
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }, SAMPLED_FRAMES_MAX);
  await expect
    .poll(
      async () =>
        (await ppEvents(page)).some(
          (event) => event.type === 'ResponseResolved' && event.quality === 'perfect',
        ),
      { timeout: FIRST_PERFECT_TIMEOUT_MS },
    )
    .toBe(true);
  await waitFrames(page, 5);

  const samples = await page.evaluate(
    () => (window as unknown as { ppClockSamples: [number, number][] }).ppClockSamples,
  );
  expect(samples.length).toBeGreaterThan(10);
  // Always the same distance from the sim's clock, whatever the speed or the slow-mo: no real time gets in.
  const [firstSim, firstMixer] = samples[0] as [number, number];
  for (const [sim, mixer] of samples) {
    expect(Math.abs(mixer - firstMixer - (sim - firstSim))).toBeLessThanOrEqual(CLOCK_TOLERANCE_MS);
  }
  // At speed 4 only a perfect's hitstop runs several frames with no step: the mixer stands still there.
  let heldFrames = 0;
  for (let i = 1; i < samples.length; i++) {
    const [sim, mixer] = samples[i] as [number, number];
    const [previousSim, previousMixer] = samples[i - 1] as [number, number];
    if (sim === previousSim && mixer === previousMixer) heldFrames += 1;
  }
  expect(heldFrames).toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(html(page)).toHaveAttribute('data-pp-state', 'paused');
  await waitFrames(page, 3);
  const pausedAt = (await ppFx(page)).papaMixerMs;
  await waitFrames(page, 20);
  expect((await ppFx(page)).papaMixerMs).toBe(pausedAt);
});

test('the look shows each part on its own, through the test API', async ({ page }) => {
  await startLevel(page);
  await ppFreeze(page, true);
  await waitFrames(page, 3);
  const shotWith = async (
    hasMashOnCheek: boolean,
    hasHairOnEnd: boolean,
    isShirtInsideOut: boolean,
  ): Promise<string> => {
    await page.evaluate((parts) => window.__PP__?.setPapaLook(parts), {
      hasMashOnCheek,
      hasHairOnEnd,
      isShirtInsideOut,
    });
    await waitFrames(page, 3);
    return (await sceneShot(page)).toString('base64');
  };
  const rest = await shotWith(false, false, false);
  const pictures = [
    await shotWith(true, false, false),
    await shotWith(false, true, false),
    await shotWith(false, false, true),
  ];
  expect(new Set([rest, ...pictures]).size).toBe(4);
  expect(await shotWith(false, false, false)).toBe(rest);
});

for (const query of ['', '&level=chambre_night']) {
  test(`plays with no warning on the assets or render channel${query}`, async ({ page }) => {
    const warnings: string[] = [];
    page.on('console', (message) => {
      if (
        (message.type() === 'warning' || message.type() === 'error') &&
        /\[(assets|render)\]|assets|render/.test(message.text())
      ) {
        warnings.push(message.text());
      }
    });
    await page.goto(`/?autoplay=human&seed=1&speed=4${query}`);
    await waitForTestApi(page);
    const papaClips = new Set<string>();
    const babyClips = new Set<string>();
    await expect
      .poll(
        async () => {
          const fx = await ppFx(page);
          if (fx.papaClip !== null) papaClips.add(fx.papaClip);
          if (fx.babyClip !== null) babyClips.add(fx.babyClip);
          return papaClips.size > 1 && babyClips.size > 1;
        },
        { timeout: 60_000, intervals: [50] },
      )
      .toBe(true);
    expect(warnings).toEqual([]);
  });
}
