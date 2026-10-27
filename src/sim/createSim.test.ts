import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent, stepN } from '../../tests/support/testContent.ts';
import type { System } from './context.ts';
import { createSim, createSimWithSystems } from './createSim.ts';
import { SYSTEMS } from './step.ts';

const content = createTestContent();

describe('createSim', () => {
  it('advances exactly 1000 ms in 100 steps', async () => {
    const sim = await createSim({ content, seed: 42 });
    expect(sim.world.time.sim).toBe(0);
    stepN(sim, 100);
    expect(sim.world.time.sim).toBe(1000);
  });

  it('keeps World as plain serializable data, at creation and after 100 steps', async () => {
    const sim = await createSim({ content, seed: 42 });
    expect(JSON.parse(JSON.stringify(sim.world))).toEqual(sim.world);
    stepN(sim, 100);
    expect(JSON.parse(JSON.stringify(sim.world))).toEqual(sim.world);
    expect(() => hashJson(sim.world)).not.toThrow();
  });

  it('rejects a bad seed', async () => {
    for (const seed of [-1, 1.5, Number.NaN]) {
      await expect(createSim({ content, seed })).rejects.toThrow();
    }
  });

  it('exposes timeScale 1 at start', async () => {
    expect((await createSim({ content, seed: 1 })).timeScale).toBe(1);
  });
});

describe('drainEvents', () => {
  const emit: System = (world, ctx) => {
    ctx.events.push({ type: 'TimeScaleChanged', t: world.time.sim, from: 1, to: 1 });
  };

  it('returns the events once, then an empty array, reusing the same array', async () => {
    const sim = await createSimWithSystems({ content, seed: 1 }, [...SYSTEMS, emit]);
    stepN(sim, 3);
    const first = sim.drainEvents();
    expect(first.map((e) => e.t)).toEqual([10, 20, 30]);
    const second = sim.drainEvents();
    expect(second).toBe(first);
    expect(second).toHaveLength(0);
  });

  it('accumulates when nobody drains', async () => {
    const sim = await createSimWithSystems({ content, seed: 1 }, [...SYSTEMS, emit]);
    stepN(sim, 5);
    stepN(sim, 5);
    expect(sim.drainEvents()).toHaveLength(10);
  });
});

describe('freeze', () => {
  const requestAtFirstStep: System = (world, ctx) => {
    if (world.time.sim === 10) ctx.requestFreezeRealMs(80);
  };

  it('exposes the remaining freeze, consumed by the client, and never blocks step()', async () => {
    const sim = await createSimWithSystems({ content, seed: 1 }, [...SYSTEMS, requestAtFirstStep]);
    expect(sim.freezeRealMs).toBe(0);
    sim.step();
    expect(sim.freezeRealMs).toBe(80);
    sim.step();
    expect(sim.world.time.sim).toBe(20);
    expect(sim.freezeRealMs).toBe(80);
    sim.consumeFreeze(30);
    expect(sim.freezeRealMs).toBe(50);
    sim.consumeFreeze(1000);
    expect(sim.freezeRealMs).toBe(0);
  });

  it('is not part of World: a never-consumed freeze does not change the hash', async () => {
    const withFreeze = await createSimWithSystems({ content, seed: 1 }, [
      ...SYSTEMS,
      requestAtFirstStep,
    ]);
    const without = await createSim({ content, seed: 1 });
    stepN(withFreeze, 10);
    stepN(without, 10);
    expect(hashJson(withFreeze.world)).toBe(hashJson(without.world));
  });
});

describe('journal option', () => {
  it('refuses a journal recorded with another seed, feel or version', async () => {
    const source = await createSim({ content, seed: 7 });
    source.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0.5 });
    const journal = source.journal();
    await expect(createSim({ content, seed: 8, journal })).rejects.toThrow(/seed/);
    await expect(
      createSim({ content, seed: 7, journal: { ...journal, feelHash: 'x' } }),
    ).rejects.toThrow(/feel/);
    await expect(
      createSim({ content, seed: 7, journal: { ...journal, version: 2 as 1 } }),
    ).rejects.toThrow(/version/);
  });

  it('pre-loads the entries with their recorded applyAt', async () => {
    const source = await createSim({ content, seed: 7 });
    stepN(source, 100);
    source.enqueue({ type: 'SetTimeScale', t: asSimMs(980), scale: 0.5 });
    const journal = source.journal();
    const replay = await createSim({ content, seed: 7, journal });
    stepN(replay, 100);
    expect(replay.timeScale).toBe(1);
    replay.step();
    expect(replay.timeScale).toBe(0.5);
    expect(replay.journal()).toEqual(journal);
  });
});

describe('journal()', () => {
  it('returns a deep copy: editing it does not rewrite history', async () => {
    const sim = await createSim({ content, seed: 7 });
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(10), scale: 0.5 });
    const copy = sim.journal();
    copy.entries.length = 0;
    expect(sim.journal().entries).toHaveLength(1);
    expect(sim.journal()).toMatchObject({ version: 1, seed: 7, feelHash: hashJson(content.feel) });
  });
});
