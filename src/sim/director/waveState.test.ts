import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  STAIRS,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimLevel, StepContext } from '../context.ts';
import { createSimWithSystems } from '../createSim.ts';
import type { World } from '../world.ts';
import { isLastOfWave, isThreatActive, isWaveClosed } from './waveState.ts';

/** A world with three planned threats (waves 0 and 1) and a context that only has the level plan. */
async function setup() {
  let plan: SimLevel | undefined;
  const sim = await createSimWithSystems(
    {
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({
        durationMs: 100_000,
        waves: [
          testWave([OUTLET, STAIRS], { lullMs: 5000 }),
          testWave([COFFEE_TABLE], { fromMs: 50_000, lullMs: 5000 }),
        ],
      }),
      seed: 1,
    },
    [
      (_world, ctx) => {
        plan = ctx.level;
      },
    ],
  );
  sim.step();
  if (plan === undefined) throw new Error('no plan');
  const world = sim.world as World;
  const ctx = { level: plan } as unknown as StepContext;
  const at = (ms: number) => {
    world.time.sim = asSimMs(ms);
  };
  const [a, b, c] = world.threats;
  if (a === undefined || b === undefined || c === undefined) throw new Error('no threats');
  return { world, ctx, at, a, b, c };
}

describe('isWaveClosed', () => {
  it('is closed once the wave’s closesAtMs has come (endMs − lullMs)', async () => {
    const { world, ctx, at } = await setup();
    world.director.waveIndex = 0;
    world.director.nextAt = asSimMs(0);
    at(44_999);
    expect(isWaveClosed(world, ctx, 0)).toBe(false);
    at(45_000);
    expect(isWaveClosed(world, ctx, 0)).toBe(true);
  });

  it('is closed once the director has moved on to a later wave', async () => {
    const { world, ctx, at } = await setup();
    at(1000);
    world.director.waveIndex = 0;
    world.director.nextAt = asSimMs(1500);
    expect(isWaveClosed(world, ctx, 0)).toBe(false);
    world.director.waveIndex = 1;
    expect(isWaveClosed(world, ctx, 0)).toBe(true);
  });

  it('is closed when the next telegraph is already due past the close (the last one was made)', async () => {
    const { world, ctx, at } = await setup();
    at(1000);
    world.director.waveIndex = 0;
    world.director.nextAt = asSimMs(44_999);
    expect(isWaveClosed(world, ctx, 0)).toBe(false);
    world.director.nextAt = asSimMs(45_000);
    expect(isWaveClosed(world, ctx, 0)).toBe(true);
  });

  it('knows no wave that does not exist', async () => {
    const { world, ctx } = await setup();
    expect(isWaveClosed(world, ctx, 7)).toBe(false);
  });
});

describe('isLastOfWave', () => {
  it('is true for a threat of a closed wave with no other active threat of that wave', async () => {
    const { world, ctx, at, a } = await setup();
    world.director.waveIndex = 1;
    at(1000);
    a.waveIndex = 0;
    a.state = 'resolved';
    expect(isLastOfWave(world, ctx, a)).toBe(true);
  });

  it('is false while the wave is still open', async () => {
    const { world, ctx, at, a } = await setup();
    world.director.waveIndex = 0;
    world.director.nextAt = asSimMs(2000);
    at(1000);
    a.waveIndex = 0;
    a.state = 'resolved';
    expect(isLastOfWave(world, ctx, a)).toBe(false);
  });

  it('is false while another threat of the same wave is announced or open', async () => {
    const { world, ctx, at, a, b } = await setup();
    world.director.waveIndex = 1;
    at(1000);
    a.waveIndex = 0;
    a.state = 'resolved';
    b.waveIndex = 0;
    for (const state of ['telegraph', 'windowOpen'] as const) {
      b.state = state;
      expect(isLastOfWave(world, ctx, a)).toBe(false);
    }
    b.state = 'gag';
    expect(isLastOfWave(world, ctx, a)).toBe(true);
  });

  it('ignores an active threat of another wave', async () => {
    const { world, ctx, at, a, c } = await setup();
    world.director.waveIndex = 1;
    at(1000);
    a.waveIndex = 0;
    a.state = 'resolved';
    c.waveIndex = 1;
    c.state = 'windowOpen';
    expect(isLastOfWave(world, ctx, a)).toBe(true);
  });

  it('is never true for a threat no wave planned (waveIndex −1)', async () => {
    const { world, ctx, at, a } = await setup();
    world.director.waveIndex = 1;
    at(99_000);
    a.waveIndex = -1;
    a.state = 'resolved';
    expect(isLastOfWave(world, ctx, a)).toBe(false);
  });

  it('allocates and writes nothing', async () => {
    const { world, ctx, at, a } = await setup();
    world.director.waveIndex = 1;
    at(1000);
    a.waveIndex = 0;
    const before = JSON.stringify(world);
    isLastOfWave(world, ctx, a);
    expect(JSON.stringify(world)).toBe(before);
  });
});

describe('isThreatActive', () => {
  it('is true in telegraph and windowOpen only', async () => {
    const { a } = await setup();
    const states = ['idle', 'telegraph', 'windowOpen', 'resolved', 'gag'] as const;
    expect(states.map((state) => isThreatActive({ ...a, state }))).toEqual([
      false,
      true,
      true,
      false,
      false,
    ]);
  });
});
