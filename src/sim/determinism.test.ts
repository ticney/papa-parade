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

/**
 * Props moving under periodic pushes: the physics is part of the determinism promise. The pushes
 * alternate between the two props and four directions, so that the mug and the vase collide and
 * the vase breaks (and later pushes of it are ignored) along the way.
 */
async function playProps(seed: number): Promise<{ sim: Sim; events: SimEvent[] }> {
  const sim = await createSimWithSystems(
    {
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed,
    },
    SYSTEMS,
  );
  const events: SimEvent[] = [];
  const directions = [
    [0.72, 0],
    [0, 0.5],
    [-0.4, 0],
    [0, -0.5],
  ] as const;
  for (let i = 1; i <= 10000; i++) {
    if (i % 350 === 1) {
      const turn = Math.floor(i / 350);
      const [x, z] = directions[turn % directions.length] as readonly [number, number];
      sim.enqueue({
        type: 'PushProp',
        t: asSimMs(sim.world.time.sim),
        propId: turn % 3 === 2 ? 'vase_01' : 'mug_01',
        impulseXNs: x,
        impulseYNs: turn % 5 === 0 ? 0.2 : 0,
        impulseZNs: z,
      });
    }
    sim.step();
    if (i % 100 === 0) for (const event of sim.drainEvents()) events.push(event);
  }
  return { sim, events };
}

describe('determinism with props in motion', () => {
  it('gives identical World, poses and events twice over 10 000 steps of periodic pushes', async () => {
    const a = await playProps(7);
    const b = await playProps(7);
    expect(a.events.filter((event) => event.type === 'PropImpact').length).toBeGreaterThan(5);
    expect(a.sim.world.props).toEqual(b.sim.world.props);
    expect(a.sim.world).toEqual(b.sim.world);
    expect(a.events).toEqual(b.events);
    expect(hashJson(a.sim.world)).toBe(hashJson(b.sim.world));
    a.sim.dispose();
    b.sim.dispose();
  });
});
