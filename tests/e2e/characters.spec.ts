import { expect, type Page, test } from '@playwright/test';
import { DRAW_CALLS_MAX, STEP_MS } from '../../src/shared/constants.ts';
import {
  advanceAndRead,
  advanceUntil,
  busyProps,
  CAMERA_YAW_RAD,
  freezeSalon,
  headingYawRad,
  startCall,
  startDrinking,
  TURN_SETTLE_MS,
  wrapRad,
  YAW_TOLERANCE_RAD,
} from './support/busyPapa.ts';
import { appUrl, html, sceneShot, startLevel, waitFrames } from './support/game.ts';
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
  await page.goto(appUrl('/?autoplay=perfect&seed=42&speed=4'));
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
    await page.goto(appUrl(`/?autoplay=human&seed=1&speed=4${query}`));
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

// Papa busy (story 2.13): the coffee and the call say it with his body, not only the bubble. The facing,
// the steam and the bla-bla come from the sim's state and the live feedback table; how they look is Geo's call.
test.describe('Papa busy', () => {
  test('drinking: he turns to face the camera, the steam sways, and the coffee ends on a kick', async ({
    page,
  }) => {
    await freezeSalon(page);
    await startDrinking(page);
    const world = await ppWorld(page);
    // The walk to the machine left his heading elsewhere: the camera facing is the view's doing.
    expect(Math.abs(wrapRad(headingYawRad(world) - CAMERA_YAW_RAD))).toBeGreaterThan(
      YAW_TOLERANCE_RAD,
    );

    const first = await advanceAndRead(page, Math.ceil(TURN_SETTLE_MS / STEP_MS));
    expect(first.papaClip).toBe('drink');
    expect(Math.abs(wrapRad(first.papaBodyYawRad - CAMERA_YAW_RAD))).toBeLessThan(
      YAW_TOLERANCE_RAD,
    );
    // The sim's heading did not follow: only the drawn body turned.
    expect(Math.abs(wrapRad(headingYawRad(await ppWorld(page)) - CAMERA_YAW_RAD))).toBeGreaterThan(
      YAW_TOLERANCE_RAD,
    );

    // The steam sways on the sim clock: two clocks an eighth of a period apart show two angles.
    const eighthSteps = Math.max(1, Math.round(busyProps.steamPeriodMs / 8 / STEP_MS));
    const second = await advanceAndRead(page, eighthSteps);
    expect(second.papaSteamSwayDeg).not.toBeCloseTo(first.papaSteamSwayDeg, 3);
    expect(Math.abs(second.papaSteamSwayDeg)).toBeLessThanOrEqual(busyProps.steamSwayDeg + 1e-6);
    // A frozen sim holds it.
    await waitFrames(page, 5);
    expect((await ppFx(page)).papaSteamSwayDeg).toBe(second.papaSteamSwayDeg);

    const drawCalls = Number(await html(page).getAttribute('data-pp-draw-calls'));
    expect(drawCalls).toBeGreaterThan(0);
    expect(drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);

    // The coffee drunk: the kick, still facing the camera while he is already idle, then back to his loop.
    await advanceUntil(page, 'the coffee drunk', 60_000, (w) => w.papa.state !== 'drink');
    expect((await ppWorld(page)).papa.state).toBe('idle');
    const kick = await advanceAndRead(page, 2);
    expect(kick.papaClip).toBe('coffee_kick');
    expect(Math.abs(wrapRad(kick.papaBodyYawRad - CAMERA_YAW_RAD))).toBeLessThan(YAW_TOLERANCE_RAD);
    const after = await advanceAndRead(page, Math.ceil(2000 / STEP_MS));
    expect(after.papaClip).toBe('idle');
  });

  test('on the phone: he turns his back to the baby, and the bla-bla wobbles', async ({ page }) => {
    await freezeSalon(page);
    await startCall(page);
    const world = await ppWorld(page);
    // The turn is only for a baby he can turn from: asserted, not assumed.
    expect(['carried', 'mischiefSilent']).not.toContain(world.baby.state);
    const awayRad = Math.atan2(world.papa.xM - world.baby.xM, world.papa.zM - world.baby.zM);
    expect(Math.abs(wrapRad(headingYawRad(world) - awayRad))).toBeGreaterThan(YAW_TOLERANCE_RAD);

    // Long enough for his body's spring to settle (story 7.8), and on the wobble's phase the spec read
    // before it (300 ms into the call): two reads an eighth apart around a crest would read the same.
    const periodMs = busyProps.blablaPeriodMs;
    const phaseFixMs = (((300 - TURN_SETTLE_MS) % periodMs) + periodMs) % periodMs;
    const first = await advanceAndRead(page, Math.round((TURN_SETTLE_MS + phaseFixMs) / STEP_MS));
    const now = await ppWorld(page);
    expect(now.papa.state).toBe('onPhone');
    expect(first.papaClip).toBe('on_phone');
    // Papa and the baby stand where the view read them: the angle is the sim's, from the baby to Papa.
    const away = Math.atan2(now.papa.xM - now.baby.xM, now.papa.zM - now.baby.zM);
    expect(Math.abs(wrapRad(first.papaBodyYawRad - away))).toBeLessThan(YAW_TOLERANCE_RAD);

    const eighthSteps = Math.max(1, Math.round(busyProps.blablaPeriodMs / 8 / STEP_MS));
    const second = await advanceAndRead(page, eighthSteps);
    expect(second.papaBlablaTiltDeg).not.toBeCloseTo(first.papaBlablaTiltDeg, 3);
    expect(Math.abs(second.papaBlablaTiltDeg)).toBeLessThanOrEqual(busyProps.blablaTiltDeg + 1e-6);

    const drawCalls = Number(await html(page).getAttribute('data-pp-draw-calls'));
    expect(drawCalls).toBeGreaterThan(0);
    expect(drawCalls).toBeLessThanOrEqual(DRAW_CALLS_MAX);
  });

  test('the bubble and the steam are still when he is not busy', async ({ page }) => {
    await freezeSalon(page);
    await ppAdvance(page, 10);
    await waitFrames(page, 3);
    const idle = await ppFx(page);
    expect(idle.papaSteamSwayDeg).toBe(0);
    expect(idle.papaBlablaTiltDeg).toBe(0);
  });
});
