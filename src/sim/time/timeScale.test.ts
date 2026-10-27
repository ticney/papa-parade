import { MIN_TIME_SCALE } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  stepN,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';

describe('timeScale', () => {
  it('exposes the scale while a step stays 10 ms of sim time', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
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
});
