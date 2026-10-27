import { hashJson } from '@shared/hash';
import { nextFloat, nextInt } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../tests/support/testContent.ts';
import type { System } from './context.ts';
import { createSimWithSystems, type Sim } from './createSim.ts';
import type { SimEvent } from './events.ts';
import { SYSTEMS } from './step.ts';
import { allocateId } from './world.ts';

/**
 * No gameplay system exists yet, so this probe consumes everything a real system may use (rng,
 * ids, events, freeze) and the test proves the whole is deterministic. Its events borrow the
 * `TimeScaleChanged` shape to carry what it drew.
 */
const probe: System = (world, ctx) => {
  const draw = nextFloat(world.rng);
  if (world.time.sim % 70 === 0) {
    ctx.events.push({
      type: 'TimeScaleChanged',
      t: world.time.sim,
      from: nextInt(world.rng, 0, 1000),
      to: allocateId(world) + draw,
    });
    ctx.requestFreezeRealMs(80);
  }
};

async function play(seed: number): Promise<{ sim: Sim; events: SimEvent[] }> {
  const sim = await createSimWithSystems(
    {
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed,
    },
    [...SYSTEMS, probe],
  );
  const events: SimEvent[] = [];
  sim.enqueue({ type: 'SetTimeScale', t: asSimMs(500), scale: 0.4 });
  sim.enqueue({ type: 'SetTimeScale', t: asSimMs(20000), scale: 1 });
  for (let i = 1; i <= 10000; i++) {
    sim.step();
    if (i % 100 === 0) for (const event of sim.drainEvents()) events.push(event);
  }
  return { sim, events };
}

describe('determinism', () => {
  it('gives identical World and events for the same seed and commands over 10 000 steps', async () => {
    const a = await play(2024);
    const b = await play(2024);
    expect(a.events.length).toBeGreaterThan(100);
    expect(a.sim.world).toEqual(b.sim.world);
    expect(a.events).toEqual(b.events);
    expect(hashJson(a.sim.world)).toBe(hashJson(b.sim.world));
    expect(a.sim.world.nextId).toBeGreaterThan(100);
  });

  it('diverges for another seed', async () => {
    const a = await play(1);
    const b = await play(2);
    expect(hashJson(a.sim.world)).not.toBe(hashJson(b.sim.world));
    expect(a.events).not.toEqual(b.events);
  });
});
