import { BABY_CRYING_EVERY_MS, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CRYING_OUTLET,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  NOISE_GAUGES,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';
import { runBabyCry, startBabyCry } from './cry.ts';

const CRY_MS = 3500;

/** A world with a clock and a baby, and a context that only collects events: the cry reads nothing else. */
function setup(nowMs = 0) {
  const world = {
    time: { sim: asSimMs(nowMs) },
    baby: { cryStartedAt: null, cryEndsAt: null },
  } as unknown as World;
  const events: SimEvent[] = [];
  const ctx = { events } as unknown as StepContext;
  return { world, ctx, events };
}

/** Runs the steps up to and including `untilMs`, returning the `t` of every `BabyCrying`. */
function cryTimes(world: World, ctx: StepContext, events: SimEvent[], untilMs: number): number[] {
  while (world.time.sim < untilMs) {
    world.time.sim = asSimMs(world.time.sim + STEP_MS);
    runBabyCry(world, ctx);
  }
  return events.filter((event) => event.type === 'BabyCrying').map((event) => event.t);
}

describe('startBabyCry', () => {
  it('starts a cry that ends gagCryMs later', () => {
    const { world, ctx } = setup(2000);
    startBabyCry(world, ctx, CRY_MS);
    expect(world.baby.cryStartedAt).toBe(2000);
    expect(world.baby.cryEndsAt).toBe(2000 + CRY_MS);
  });

  it('extends a cry in progress to the later end and keeps its grid', () => {
    const { world, ctx } = setup(0);
    startBabyCry(world, ctx, CRY_MS);
    world.time.sim = asSimMs(2000);
    startBabyCry(world, ctx, CRY_MS);
    expect(world.baby.cryStartedAt).toBe(0);
    expect(world.baby.cryEndsAt).toBe(2000 + CRY_MS);
  });

  it('never shortens a cry', () => {
    const { world, ctx } = setup(0);
    startBabyCry(world, ctx, CRY_MS);
    world.time.sim = asSimMs(500);
    startBabyCry(world, ctx, 1000);
    expect(world.baby.cryEndsAt).toBe(CRY_MS);
  });
});

describe('runBabyCry', () => {
  it('does nothing while the baby is not crying', () => {
    const { world, ctx, events } = setup(0);
    expect(cryTimes(world, ctx, events, 5000)).toEqual([]);
  });

  it('gives floor(gagCryMs / period) BabyCrying, at +1000, +2000 and +3000 for 3500 ms, then ends the cry', () => {
    const { world, ctx, events } = setup(100);
    startBabyCry(world, ctx, CRY_MS);
    const times = cryTimes(world, ctx, events, 100 + CRY_MS + 2000);
    expect(times).toEqual([1100, 2100, 3100]);
    expect(times).toHaveLength(Math.floor(CRY_MS / BABY_CRYING_EVERY_MS));
    expect(world.baby.cryStartedAt).toBeNull();
    expect(world.baby.cryEndsAt).toBeNull();
  });

  it('emits the tick due at cryEndsAt itself (included) and then ends the cry in the same step', () => {
    const { world, ctx, events } = setup(0);
    startBabyCry(world, ctx, 3000);
    expect(cryTimes(world, ctx, events, 3000)).toEqual([1000, 2000, 3000]);
    expect(world.baby.cryStartedAt).toBeNull();
  });

  it('keeps the grid when a gag extends the cry, with no drift and no double tick', () => {
    const { world, ctx, events } = setup(0);
    startBabyCry(world, ctx, 1500);
    cryTimes(world, ctx, events, 1200);
    startBabyCry(world, ctx, CRY_MS); // ends at 1200 + 3500 = 4700
    const times = cryTimes(world, ctx, events, 6000);
    expect(times).toEqual([1000, 2000, 3000, 4000]);
    expect(world.baby.cryEndsAt).toBeNull();
  });

  it('starts a new grid for a cry after the previous one is over', () => {
    const { world, ctx, events } = setup(0);
    startBabyCry(world, ctx, 1000);
    cryTimes(world, ctx, events, 1500);
    startBabyCry(world, ctx, 2000);
    expect(world.baby.cryStartedAt).toBe(1500);
    expect(cryTimes(world, ctx, events, 4000)).toEqual([1000, 2500, 3500]);
  });
});

describe('a crying baby through a real sim', () => {
  async function newSim(hasNoise: boolean, durationMs?: number) {
    return createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({
        waves: [testWave([CRYING_OUTLET])],
        gauges: hasNoise ? NOISE_GAUGES : {},
        ...(durationMs === undefined ? {} : { durationMs }),
      }),
      seed: 1,
    });
  }

  function run(sim: Awaited<ReturnType<typeof newSim>>, steps: number): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < steps; i++) {
      sim.step();
      for (const event of sim.drainEvents()) events.push(event);
    }
    return events;
  }

  it('cries after the gag of a def with gagCryMs, in a level with noise or without', async () => {
    for (const hasNoise of [true, false]) {
      const sim = await newSim(hasNoise);
      // Up to 7000 ms: the outlet re-arms 6000 ms after its gag and would fail again.
      const events = run(sim, 700);
      const gagAt = events.find((event) => event.type === 'GagTriggered')?.t;
      expect(gagAt).toBeDefined();
      const cries = events.filter((event) => event.type === 'BabyCrying');
      expect(cries.map((event) => event.t)).toEqual(
        [1000, 2000, 3000].map((ms) => (gagAt as number) + ms),
      );
      expect(sim.world.baby.cryStartedAt).toBeNull();
    }
  });

  it('emits nothing once the level has ended, and leaves the cry as it was', async () => {
    const sim = await newSim(true, 2500);
    const events = run(sim, 600);
    expect(events.some((event) => event.type === 'LevelEnded')).toBe(true);
    const endedAt = events.find((event) => event.type === 'LevelEnded')?.t as number;
    const late = events.filter((event) => event.type === 'BabyCrying' && event.t > endedAt);
    expect(late).toEqual([]);
  });

  it('round-trips a snapshot taken mid-cry to the same end state', async () => {
    const sim = await newSim(true);
    const before: SimEvent[] = [];
    for (let i = 0; i < 400; i++) {
      sim.step();
      for (const event of sim.drainEvents()) before.push(event);
      if (sim.world.baby.cryStartedAt !== null) break;
    }
    expect(sim.world.baby.cryStartedAt).not.toBeNull();
    const snapshot = sim.snapshot();
    run(sim, 600);
    const direct = structuredClone(sim.world);
    const copy = await newSim(true);
    copy.restore(snapshot);
    run(copy, 600);
    expect(copy.world).toEqual(direct);
  });
});
