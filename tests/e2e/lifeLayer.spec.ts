import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { freezeSalon } from './support/busyPapa.ts';
import { calibratedSaveValue, SAVE_STORAGE_KEY } from './support/calibratedSave.ts';
import { html, liveSilence, WALK_BOUND_MS, waitFrames } from './support/game.ts';
import { ppAdvance, ppEvents, ppFx, ppSend, ppWorld } from './support/testApi.ts';

// The life layer (story 7.8) in the real game: it moves with the sim clock and holds with it, the
// stoop follows the fatigue and never the lids, the gaze follows what the screen shows, and reduced
// motion takes the breath and the lean away. How it looks is Geo's call: nothing here judges the feel.
// The numbers are read from the live `content/feel.json`, never typed: Geo retunes them.

const live = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  characters: {
    breath: { periodMs: number; papaAmplitudeDeg: number; babyAmplitudeDeg: number };
    stoop: { maxDeg: number };
    lean: { reachMs: number };
  };
  baby: { sneakSpeedMps: number; silenceAlertMs: number };
  movement: { walkSpeedMps: number };
};
const { breath, stoop } = live.characters;
const CHUNK_STEPS = 25;
/** The crawl to the hiding zone and the quiet that follows, with a margin (as `silence.spec.ts`). */
const SILENCE_START_BOUND_MS =
  WALK_BOUND_MS * Math.max(1, live.movement.walkSpeedMps / live.baby.sneakSpeedMps) +
  live.baby.silenceAlertMs;

/** Steps by `steps`, lets the frames draw, and reads what the view shows. */
async function advanceAndRead(page: Page, steps: number) {
  await ppAdvance(page, steps);
  await waitFrames(page, 3);
  return ppFx(page);
}

async function seedReducedMotion(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => localStorage.setItem(key as string, value as string),
    [SAVE_STORAGE_KEY, calibratedSaveValue({}, { reducedMotion: true })],
  );
}

test('Papa and the baby breathe on the sim clock, and a frozen clock holds the breath', async ({
  page,
}) => {
  await freezeSalon(page);
  const first = await advanceAndRead(page, 10);
  // A quarter of a breath later the torso has moved, within its amplitude.
  const quarter = await advanceAndRead(page, Math.round(breath.periodMs / 4 / STEP_MS));
  expect(quarter.papaBreathDeg).not.toBeCloseTo(first.papaBreathDeg, 2);
  expect(Math.abs(quarter.papaBreathDeg)).toBeLessThanOrEqual(breath.papaAmplitudeDeg + 1e-6);
  expect(quarter.babyBreathDeg).not.toBeCloseTo(first.babyBreathDeg, 2);
  expect(Math.abs(quarter.babyBreathDeg)).toBeLessThanOrEqual(breath.babyAmplitudeDeg + 1e-6);
  // The sim stands still (`__PP__.freeze`): frames go by, the breath does not.
  await waitFrames(page, 10);
  const held = await ppFx(page);
  expect(held.papaBreathDeg).toBe(quarter.papaBreathDeg);
  expect(held.babyBreathDeg).toBe(quarter.babyBreathDeg);
});

test('at fatigue 100 Papa stoops by the whole stoop, and his eyelids stay open', async ({
  page,
}) => {
  await freezeSalon(page);
  const rested = await advanceAndRead(page, 2);
  await ppSend(page, { type: 'SetFatigue', points: 100 });
  const tired = await advanceAndRead(page, 2);
  expect((await ppWorld(page)).gauges.fatigue).toBe(100);
  expect(tired.papaStoopDeg).toBeCloseTo(stoop.maxDeg, 6);
  expect(tired.papaStoopDeg).toBeGreaterThan(rested.papaStoopDeg);
  // Only the micro-sleep and sleep move his lids: none has started.
  const world = await ppWorld(page);
  expect(world.papa.state).not.toBe('asleep');
  expect(tired.papaEyelidsPct).toBe(0);
});

test('his head follows the baby on screen, and not the baby hidden in a silence', async ({
  page,
}) => {
  await freezeSalon(page);
  const seen = await advanceAndRead(page, Math.ceil((4 * live.characters.lean.reachMs) / STEP_MS));
  // A fixed room shows the baby, and Papa is not responding.
  expect(seen.papaGaze).toBe('baby');

  const world = await ppWorld(page);
  const silence = world.threats.find((threat) => threat.defId === liveSilence.id);
  if (silence === undefined) throw new Error('the level does not plan the silence');
  await ppSend(page, { type: 'ForceThreat', threatId: silence.id });
  for (let steps = 0; steps * STEP_MS <= SILENCE_START_BOUND_MS; steps += CHUNK_STEPS) {
    if ((await ppEvents(page)).some((event) => event.type === 'SilenceStarted')) break;
    await ppAdvance(page, CHUNK_STEPS);
  }
  expect((await ppWorld(page)).baby.state).toBe('mischiefSilent');
  const hidden = await advanceAndRead(page, 2);
  // The silence is the point: his head gives the hidden baby away to nobody. Nothing else rings.
  expect(hidden.papaGaze).toBe('ahead');
});

test.describe('under « Réduire les animations »', () => {
  test('no breath and no lean; the stoop stays, it carries the fatigue', async ({ page }) => {
    await seedReducedMotion(page);
    await freezeSalon(page);
    await expect(html(page)).toHaveAttribute('data-pp-motion', 'reduced');
    await ppSend(page, { type: 'SetFatigue', points: 100 });
    const { papa } = await ppWorld(page);
    // A walk: a start and a stop, which would lean him.
    await ppSend(page, { type: 'TapFloor', xM: papa.xM - 1, zM: papa.zM });
    for (let i = 0; i < 30; i++) {
      const fx = await advanceAndRead(page, 5);
      expect(fx.papaBreathDeg, `frame ${i}`).toBe(0);
      expect(fx.babyBreathDeg, `frame ${i}`).toBe(0);
      expect(fx.papaLeanDeg, `frame ${i}`).toBe(0);
    }
    expect((await ppFx(page)).papaStoopDeg).toBeCloseTo(stoop.maxDeg, 6);
  });

  test('positive control: with the setting off, the same walk leans him and he breathes', async ({
    page,
  }) => {
    await freezeSalon(page);
    const { papa } = await ppWorld(page);
    await ppSend(page, { type: 'TapFloor', xM: papa.xM - 1, zM: papa.zM });
    let mostLeanDeg = 0;
    let mostBreathDeg = 0;
    for (let i = 0; i < 30; i++) {
      const fx = await advanceAndRead(page, 5);
      mostLeanDeg = Math.max(mostLeanDeg, Math.abs(fx.papaLeanDeg));
      mostBreathDeg = Math.max(mostBreathDeg, Math.abs(fx.papaBreathDeg));
    }
    expect(mostLeanDeg).toBeGreaterThan(0.5);
    expect(mostBreathDeg).toBeGreaterThan(0.1);
  });
});
