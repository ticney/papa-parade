import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { STEP_MS } from '../../src/shared/constants.ts';
import { freezeSalon } from './support/busyPapa.ts';
import { liveSilence, WALK_BOUND_MS, waitFrames } from './support/game.ts';
import { ppAdvance, ppEvents, ppFx, ppSend, ppWorld } from './support/testApi.ts';

// The life layer (story 7.8) in the real game, only what a browser alone shows: a frozen clock holds
// the breath (the real frame loop against `__PP__.freeze`), and the gaze follows what the screen shows
// (boot's sight wiring). The rules themselves (the stoop and the lids, reduced motion, the breath's
// amplitude, the lean) are pinned in Vitest (`papaView`, `babyView`, `lifeLayer`, `levelScene` tests).
// How it looks is Geo's call: nothing here judges the feel. The numbers are read from the live
// `content/feel.json`, never typed: Geo retunes them.

const live = JSON.parse(readFileSync('content/feel.json', 'utf8')) as {
  characters: {
    breath: { periodMs: number };
    gaze: { reachMs: number };
  };
  baby: { sneakSpeedMps: number; silenceAlertMs: number };
  movement: { walkSpeedMps: number };
};
const { breath, gaze } = live.characters;
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

test('Papa and the baby breathe on the sim clock, and a frozen clock holds the breath', async ({
  page,
}) => {
  await freezeSalon(page);
  const first = await advanceAndRead(page, 10);
  // A quarter of a breath later the torso has moved (its amplitude is pinned in Vitest).
  const quarter = await advanceAndRead(page, Math.round(breath.periodMs / 4 / STEP_MS));
  expect(quarter.papaBreathDeg).not.toBeCloseTo(first.papaBreathDeg, 2);
  expect(quarter.babyBreathDeg).not.toBeCloseTo(first.babyBreathDeg, 2);
  // The sim stands still (`__PP__.freeze`): frames go by, the breath does not.
  await waitFrames(page, 10);
  const held = await ppFx(page);
  expect(held.papaBreathDeg).toBe(quarter.papaBreathDeg);
  expect(held.babyBreathDeg).toBe(quarter.babyBreathDeg);
});

test('his head follows the baby on screen, and not the baby hidden in a silence', async ({
  page,
}) => {
  await freezeSalon(page);
  const seen = await advanceAndRead(page, Math.ceil((4 * gaze.reachMs) / STEP_MS));
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
