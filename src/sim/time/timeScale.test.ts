import { MIN_TIME_SCALE, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  stepN,
} from '../../../tests/support/testContent.ts';
import type { System } from '../context.ts';
import { createSim, createSimWithSystems } from '../createSim.ts';
import { SYSTEMS } from '../step.ts';
import { startSlowMo } from './slowMo.ts';

describe('timeScale', () => {
  it('exposes the scale while a step stays 10 ms of sim time', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0.3 });
    sim.step();
    expect(sim.timeScale).toBe(0.3);
    expect(sim.world.time.sim).toBe(10);
    stepN(sim, 99);
    expect(sim.world.time.sim).toBe(1000);
  });

  it('emits TimeScaleChanged only when the value changes', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0.5 });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(20), scale: 0.5 });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(30), scale: 1 });
    stepN(sim, 5);
    expect(sim.drainEvents()).toEqual([
      { type: 'TimeScaleChanged', t: 10, from: 1, to: 0.5 },
      { type: 'TimeScaleChanged', t: 30, from: 0.5, to: 1 },
    ]);
  });

  it('throws on an out-of-range scale in strict mode', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
      strictInvariants: true,
    });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0 });
    expect(() => sim.step()).toThrow(/time\.scale/);
  });

  it('clamps and reports an out-of-range scale outside strict mode (prod branch)', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
      strictInvariants: false,
    });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0 });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(20), scale: 2 });
    sim.step();
    expect(sim.timeScale).toBe(MIN_TIME_SCALE);
    sim.step();
    expect(sim.timeScale).toBe(1);
    const events = sim.drainEvents();
    expect(events.filter((e) => e.type === 'InvariantViolated')).toHaveLength(2);
    expect(events[0]).toMatchObject({
      type: 'InvariantViolated',
      name: 'time.scale',
      value: 0,
      t: 10,
    });
  });

  it('keeps SetTimeScale as the base scale under a slow-mo', async () => {
    const { slowMoPerfect } = createTestContent().feel.timing;
    const startAtStep2: System = (world, ctx) => {
      if (world.time.sim === 20) startSlowMo(world, ctx, 'perfect', slowMoPerfect);
    };
    const sim = await createSimWithSystems(
      {
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel(),
        seed: 1,
      },
      [...SYSTEMS, startAtStep2],
    );
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0.5 });
    stepN(sim, 2);
    expect(sim.timeScale).toBe(slowMoPerfect.timeScale);
    stepN(sim, (slowMoPerfect.durationMs + slowMoPerfect.returnMs) / STEP_MS);
    expect(sim.timeScale).toBe(0.5);
    const changes = sim
      .drainEvents()
      .filter((event) => event.type === 'TimeScaleChanged')
      .map((event) => [event.from, event.to]);
    expect(changes[0]).toEqual([1, 0.5]);
    expect(changes[1]).toEqual([0.5, slowMoPerfect.timeScale]);
    expect(changes.at(-1)?.[1]).toBe(0.5);
  });
});
