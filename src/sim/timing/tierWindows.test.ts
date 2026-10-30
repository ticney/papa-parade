import { DIFFICULTY_TIER_IDS, type DifficultyTierId } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestMicroSleep,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim } from '../createSim.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import type { World } from '../world.ts';

// Story 2.8: the tier is the first factor of `base × tier × fatigue × instinct`. Literals on
// purpose: the expectations must not be computed with the production formula.
const content = createTestContent();
const def = createTestLevel({ waves: [testWave([OUTLET])] }).threats.outlet;
if (def === undefined) throw new Error('no outlet');

describe('the frozen feel these tests read (story 2.8)', () => {
  it('holds the numbers the literals below are written against', () => {
    expect(content.feel.timing).toMatchObject({
      windowMs: 300,
      perfectMs: 100,
      toleranceMs: 60,
      bufferMs: 100,
    });
    expect(content.feel.difficulty).toMatchObject({
      assistance: { windowMultiplier: 1.5, hasInstinct: true },
      normal: { windowMultiplier: 1, hasInstinct: true },
      experienced: { windowMultiplier: 0.75, hasInstinct: false },
    });
    expect(content.feel.fatigue.windowPenaltyPct).toBe(20);
  });
});

async function setup(tier: DifficultyTierId, fatigued = false) {
  const sim = await createSim({
    content,
    geometry: createTestGeometry(),
    level: createTestLevel({ waves: [testWave([OUTLET])] }),
    seed: 1,
  });
  const world = sim.world as World;
  world.time.sim = asSimMs(500);
  world.difficultyTier = tier;
  if (fatigued) world.gauges.fatigue = content.feel.fatigue.thresholdPoints + 1;
  const ctx = {
    feel: content.feel,
    events: [],
    strictInvariants: true,
    t: world.time.sim,
    level: { microSleepIndex: fatigued ? 0 : -1, durationMs: 100_000 },
    requestFreezeRealMs: () => undefined,
  } as unknown as StepContext;
  const threat = world.threats[0] as World['threats'][number];
  return { world, ctx, threat };
}

describe('the tier in the window (story 2.8)', () => {
  it.each([
    ['assistance', 450],
    ['normal', 300],
    ['experienced', 225],
  ] as const)('a base of 300 gives %s a window of %i', async (tier, windowMs) => {
    const { world, ctx, threat } = await setup(tier);
    telegraphThreat(world, ctx, threat, def, 0);
    expect(threat.responseWindow?.windowMs).toBeCloseTo(windowMs, 9);
  });

  it.each([
    ['assistance', 360],
    ['normal', 240],
    ['experienced', 180],
  ] as const)('with a fatigue penalty of 20 %%, %s gets %i', async (tier, windowMs) => {
    const { world, ctx, threat } = await setup(tier, true);
    telegraphThreat(world, ctx, threat, def, 0);
    expect(threat.responseWindow?.windowMs).toBeCloseTo(windowMs, 9);
  });

  it.each(DIFFICULTY_TIER_IDS)(
    'leaves the tolerance and the buffer unscaled at %s',
    async (tier) => {
      const { world, ctx, threat } = await setup(tier);
      telegraphThreat(world, ctx, threat, def, 0);
      expect(threat.responseWindow).toMatchObject({ toleranceMs: 60, bufferMs: 100 });
    },
  );

  it('caps the perfect zone by the window', async () => {
    const { world, ctx, threat } = await setup('experienced');
    const tight = { ...ctx, feel: structuredClone(content.feel) } as StepContext;
    tight.feel.timing.perfectMs = 400;
    telegraphThreat(world, tight, threat, def, 0);
    expect(threat.responseWindow).toMatchObject({ windowMs: 225, perfectMs: 225 });
  });

  it('keeps the length of a window telegraphed before a tier change', async () => {
    const { world, ctx, threat } = await setup('normal');
    telegraphThreat(world, ctx, threat, def, 0);
    world.difficultyTier = 'experienced';
    expect(threat.responseWindow?.windowMs).toBe(300);
  });

  it('judges a micro-sleep against the window of the active tier', async () => {
    const microSleep = createTestMicroSleep();
    const { world, ctx } = await setup('normal');
    const { toleranceMs } = content.feel.timing;
    const delayMs = microSleep.telegraphDelayMs ?? content.feel.timing.telegraphDelayDefaultMs;
    const baseMs = microSleep.windowMs ?? content.feel.timing.windowMs;
    const now = 1000;
    // The level ends just after the normal-tier threat would be judged.
    (ctx.level as { durationMs: number }).durationMs = now + delayMs + baseMs + toleranceMs;
    const judgeable = (tier: DifficultyTierId) => {
      world.difficultyTier = tier;
      return isJudgeableBeforeEnd(world, ctx, microSleep, now);
    };
    expect(judgeable('experienced')).toBe(true);
    expect(judgeable('normal')).toBe(true);
    expect(judgeable('assistance')).toBe(false);
  });
});
