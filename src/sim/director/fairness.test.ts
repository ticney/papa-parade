import { SILENCE_SIMULTANEOUS_WEIGHT, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestMicroSleep,
  FATIGUE_GAUGES,
  OUTLET,
  SILENCE,
  STAIRS,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { rearmThreat, telegraphThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';
import {
  fairnessSpacingMs,
  fairWindowOpenAt,
  silenceLimitProblem,
  simultaneousWeightOf,
} from './fairness.ts';

const content = createTestContent();
const OUTLET_I = 0;
const STAIRS_I = 1;
const COFFEE_I = 2;
const SILENCE_I = 3;
const MICRO_SLEEP_I = 4;

async function setup(marginMs?: number) {
  const level = createTestLevel({
    waves: [testWave([OUTLET, STAIRS, COFFEE_TABLE, SILENCE], { maxSimultaneous: 5 })],
    gauges: FATIGUE_GAUGES,
  });
  const sim = await createSim({ content, geometry: createTestGeometry(), level, seed: 1 });
  const world = sim.world as World;
  const feel =
    marginMs === undefined
      ? content.feel
      : { ...content.feel, director: { fairnessMarginMs: marginMs } };
  const events: SimEvent[] = [];
  const planned = [
    ...[OUTLET, STAIRS, COFFEE_TABLE, SILENCE].map((entry, index) => ({
      def: level.threats[entry.def],
      firstWaveIndex: 0,
      anchorId: entry.anchor,
      zone: index === SILENCE_I ? {} : null,
    })),
    { def: createTestMicroSleep(), firstWaveIndex: -1, anchorId: 'papa', zone: null },
  ];
  const ctx = {
    feel,
    events,
    strictInvariants: true,
    t: world.time.sim,
    level: { threats: planned, microSleepIndex: MICRO_SLEEP_I },
  } as unknown as StepContext;
  const threatAt = (index: number) => world.threats[index] as ThreatInstance;
  /** Telegraphs threat `index` with its window freezing to open at `openAt` (the instant is set directly). */
  const freeze = (index: number, openAt: number) => {
    const planned_ = planned[index];
    if (planned_?.def === undefined) throw new Error(`no def at ${index}`);
    telegraphThreat(world, ctx, threatAt(index), planned_.def, 0);
    threatAt(index).windowOpenAt = asSimMs(openAt);
  };
  return { world, ctx, freeze, threatAt };
}

const S = content.feel.movement.glideMaxMs + content.feel.director.fairnessMarginMs;

describe('fairWindowOpenAt (story 3.13, FR75)', () => {
  it('reads the spacing from the effective feel: the glide plus the margin', async () => {
    const { ctx } = await setup();
    expect(fairnessSpacingMs(ctx)).toBe(S);
    const wide = await setup(1000);
    expect(fairnessSpacingMs(wide.ctx)).toBe(content.feel.movement.glideMaxMs + 1000);
  });

  it('leaves the instant alone when no other window is frozen', async () => {
    const { world, ctx } = await setup();
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 1234)).toBe(1234);
  });

  it('postpones a window that would open less than S after another one, to exactly S after it', async () => {
    const { world, ctx, freeze } = await setup();
    freeze(STAIRS_I, 3000);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3300)).toBe(3000 + S);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000)).toBe(3000 + S);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 + S - STEP_MS)).toBe(3000 + S);
  });

  it('postpones a window that would open less than S before another one, after it (never before)', async () => {
    const { world, ctx, freeze } = await setup();
    freeze(STAIRS_I, 3000);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 - 300)).toBe(3000 + S);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 - S + STEP_MS)).toBe(3000 + S);
  });

  it('allows exactly S apart, before or after', async () => {
    const { world, ctx, freeze } = await setup();
    freeze(STAIRS_I, 3000);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 + S)).toBe(3000 + S);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 - S)).toBe(3000 - S);
  });

  it('chains: two windows S apart push a third to S after the later one', async () => {
    const { world, ctx, freeze } = await setup();
    freeze(STAIRS_I, 3000);
    freeze(COFFEE_I, 3000 + S);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3100)).toBe(3000 + 2 * S);
  });

  it('never counts the threat itself', async () => {
    const { world, ctx, freeze } = await setup();
    freeze(OUTLET_I, 3000);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000)).toBe(3000);
  });

  it('rounds a postponed instant up to the step grid when the margin is not a multiple of a step', async () => {
    const { world, ctx, freeze } = await setup(305);
    freeze(STAIRS_I, 3000);
    const result = fairWindowOpenAt(world, ctx, OUTLET_I, 3100);
    expect(result).toBe(3000 + content.feel.movement.glideMaxMs + 310);
    expect(result % STEP_MS).toBe(0);
  });

  it('counts a window that was answered (resolved) or a gag, until the threat is re-armed', async () => {
    const { world, ctx, freeze, threatAt } = await setup();
    freeze(STAIRS_I, 3000);
    freeze(COFFEE_I, 3000 + 3 * S);
    for (const state of ['windowOpen', 'resolved', 'gag'] as const) {
      threatAt(STAIRS_I).state = state;
      expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3100)).toBe(3000 + S);
    }
    threatAt(COFFEE_I).state = 'resolved';
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 + 3 * S + 100)).toBe(3000 + 4 * S);
    rearmThreat(world, ctx, threatAt(STAIRS_I));
    expect(threatAt(STAIRS_I).state).toBe('idle');
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3100)).toBe(3100);
  });

  it('counts nothing for a silence that timed out or is still hidden: it never had a window', async () => {
    const { world, ctx, threatAt } = await setup();
    threatAt(SILENCE_I).state = 'hidden';
    threatAt(SILENCE_I).windowOpenAt = asSimMs(3000);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3100)).toBe(3100);
  });

  it('keeps clear of a found silence until the end of its parry plus the spacing, and of S before its opening', async () => {
    const { world, ctx, freeze, threatAt } = await setup();
    freeze(SILENCE_I, 3000);
    const parry = threatAt(SILENCE_I).responseWindow;
    if (parry === null) throw new Error('the silence has a frozen window');
    const endAt = 3000 + parry.windowMs + parry.toleranceMs + S;
    expect(endAt).toBeGreaterThan(3000 + S);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 + S)).toBe(
      Math.ceil(endAt / STEP_MS) * STEP_MS,
    );
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 - 300)).toBe(
      Math.ceil(endAt / STEP_MS) * STEP_MS,
    );
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3000 - S)).toBe(3000 - S);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, endAt)).toBe(endAt);
  });

  it('spaces its own draw from the micro-sleep window too (D5), whoever spawned the other', async () => {
    const { world, ctx, freeze } = await setup();
    freeze(MICRO_SLEEP_I, 3000);
    expect(fairWindowOpenAt(world, ctx, OUTLET_I, 3100)).toBe(3000 + S);
  });
});

describe('simultaneousWeightOf (story 3.13)', () => {
  it('counts a silence for two, a wave threat for one and a threat no wave plans for none', async () => {
    const { ctx } = await setup();
    expect(simultaneousWeightOf(ctx, OUTLET_I)).toBe(1);
    expect(simultaneousWeightOf(ctx, SILENCE_I)).toBe(SILENCE_SIMULTANEOUS_WEIGHT);
    expect(SILENCE_SIMULTANEOUS_WEIGHT).toBe(2);
    expect(simultaneousWeightOf(ctx, MICRO_SLEEP_I)).toBe(0);
    expect(simultaneousWeightOf(ctx, 99)).toBe(0);
  });
});

describe('silenceLimitProblem (story 3.13 AC 8)', () => {
  it('refuses a wave that allows one at a time, naming the wave, the threat and the limit', () => {
    expect(silenceLimitProblem(1, 'silence_mischief', 1)).toBe(
      'wave 1 plans the silence "silence_mischief" (target "hiddenZone"), which counts for 2 against maxSimultaneous, but allows 1: it could never be drawn there',
    );
  });

  it('accepts two or more', () => {
    expect(silenceLimitProblem(0, 'silence_mischief', 2)).toBeNull();
    expect(silenceLimitProblem(0, 'silence_mischief', 3)).toBeNull();
  });
});
