import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent, stepN } from '../../tests/support/testContent.ts';
import type { System } from './context.ts';
import { createSim, createSimWithSystems } from './createSim.ts';
import type { SimEvent } from './events.ts';
import { SYSTEMS } from './step.ts';

const content = createTestContent();
const scale = (t: number, value: number) =>
  ({ type: 'SetTimeScale', t: asSimMs(t), scale: value }) as const;

describe('snapshot / restore', () => {
  async function liveGame() {
    const a = await createSim({ content, seed: 5 });
    const events: SimEvent[] = [];
    const collect = () => {
      for (const event of a.drainEvents()) events.push(event);
    };
    a.enqueue(scale(100, 0.5));
    a.enqueue(scale(1205, 0.8)); // between two step ends, pending at the snapshot
    a.enqueue(scale(1500, 0.3));
    stepN(a, 100);
    a.enqueue(scale(950, 0.9)); // late, enqueued before the snapshot
    stepN(a, 20); // sim time 1200
    collect();
    const snapshot = a.snapshot();
    const eventsBeforeSnapshot = events.length;
    stepN(a, 10); // sim time 1300
    a.enqueue(scale(1100, 0.6)); // late AND enqueued after the snapshot: applyAt 1310
    stepN(a, 120); // sim time 2500
    collect();
    return { a, snapshot, events, eventsBeforeSnapshot };
  }

  it('restores a snapshot with the journal tail: same final state, events and journal', async () => {
    const { a, snapshot, events, eventsBeforeSnapshot } = await liveGame();
    const tail = a.journal().entries.filter((e) => e.applyAt > snapshot.world.time.sim);
    expect(tail.map((e) => e.command.t)).toEqual([1205, 1500, 1100]);
    expect(tail.map((e) => e.applyAt)).toEqual([1210, 1500, 1310]);

    const b = await createSim({ content, seed: 5 });
    b.restore(snapshot, tail);
    expect(b.world.time.sim).toBe(1200);
    stepN(b, 130);

    expect(b.world).toEqual(a.world);
    expect(hashJson(b.world)).toBe(hashJson(a.world));
    expect(b.drainEvents()).toEqual(events.slice(eventsBeforeSnapshot));
    expect(b.journal()).toEqual({ ...a.journal(), startSimMs: 1200, entries: tail });
  });

  it('re-enqueueing through enqueue() would apply the late command too early', async () => {
    const { a, snapshot, events, eventsBeforeSnapshot } = await liveGame();
    const tail = a.journal().entries.filter((e) => e.applyAt > snapshot.world.time.sim);
    const b = await createSim({ content, seed: 5 });
    b.restore(snapshot);
    for (const entry of tail) b.enqueue(entry.command);
    stepN(b, 130);
    expect(b.drainEvents()).not.toEqual(events.slice(eventsBeforeSnapshot));
  });

  it('marks the journal as starting at the snapshot time, and keeps its seed and feel', async () => {
    const sim = await createSim({ content, seed: 5 });
    stepN(sim, 7);
    const snapshot = sim.snapshot();
    expect(sim.journal().startSimMs).toBe(0);
    sim.restore(snapshot);
    expect(sim.journal()).toMatchObject({
      seed: 5,
      feelHash: hashJson(content.feel),
      startSimMs: 70,
      entries: [],
    });
  });

  it('refuses a snapshot of another seed or feel, a malformed world and an already applied tail', async () => {
    const other = await createSim({ content, seed: 6 });
    const sim = await createSim({ content, seed: 5 });
    expect(() => sim.restore(other.snapshot())).toThrow(/another seed/);
    expect(() => sim.restore({ ...sim.snapshot(), feelHash: 'x' })).toThrow(/another feel/);
    for (const world of [{}, { ...sim.world, time: { sim: 'a', scale: 1 } }, null]) {
      expect(() => sim.restore({ ...sim.snapshot(), world: world as never })).toThrow(
        /invalid snapshot world/,
      );
    }
    stepN(sim, 10);
    const late = { applyAt: asSimMs(100), command: scale(100, 0.5) };
    expect(() => sim.restore(sim.snapshot(), [late])).toThrow(/already applied/);
    expect(() =>
      sim.restore(sim.snapshot(), [{ applyAt: asSimMs(105), command: late.command }]),
    ).toThrow(/step grid/);
  });

  it('restoring a sim built from a journal drops its pre-loaded entries unless they are passed as the tail', async () => {
    const source = await createSim({ content, seed: 5 });
    source.enqueue(scale(500, 0.5));
    const journal = source.journal();
    const replay = await createSim({ content, seed: 5, journal });
    const snapshot = replay.snapshot();
    replay.restore(snapshot);
    stepN(replay, 60);
    expect(replay.timeScale).toBe(1);
    replay.restore(snapshot, journal.entries);
    stepN(replay, 60);
    expect(replay.timeScale).toBe(0.5);
  });

  it('is a deep copy in both directions', async () => {
    const sim = await createSim({ content, seed: 5 });
    stepN(sim, 10);
    const snapshot = sim.snapshot();
    stepN(sim, 10);
    expect(snapshot.world.time.sim).toBe(100);
    const other = await createSim({ content, seed: 5 });
    other.restore(snapshot);
    (snapshot.world as { nextId: number }).nextId = 999;
    expect(other.world.nextId).not.toBe(999);
    stepN(other, 1);
    expect(snapshot.world.time.sim).toBe(100);
  });

  it('clears pending commands, events, freeze and the journal entries', async () => {
    const requestFreeze: System = (_world, ctx) => ctx.requestFreezeRealMs(80);
    const emit: System = (world, ctx) => {
      ctx.events.push({ type: 'TimeScaleChanged', t: world.time.sim, from: 1, to: 1 });
    };
    const sim = await createSimWithSystems({ content, seed: 5 }, [...SYSTEMS, requestFreeze, emit]);
    const snapshot = sim.snapshot();
    sim.enqueue(scale(500, 0.5));
    stepN(sim, 3);
    expect(sim.freezeRealMs).toBe(80);

    sim.restore(snapshot);
    expect(sim.freezeRealMs).toBe(0);
    expect(sim.drainEvents()).toHaveLength(0);
    expect(sim.journal().entries).toEqual([]);
    expect(sim.journal().seed).toBe(5);
    stepN(sim, 60);
    expect(sim.timeScale).toBe(1); // the pending command did not survive
  });

  it('stamps events with the restored time (ctx.t follows the new world)', async () => {
    const lenient = await createSim({ content, seed: 5, strictInvariants: false });
    stepN(lenient, 10);
    const snapshot = lenient.snapshot();
    stepN(lenient, 40);
    lenient.restore(snapshot);
    lenient.enqueue(scale(0, 5));
    lenient.step();
    expect(lenient.drainEvents()).toContainEqual({
      type: 'InvariantViolated',
      t: 110,
      name: 'time.scale',
      value: 5,
    });
  });

  it('refuses an unknown snapshot version', async () => {
    const sim = await createSim({ content, seed: 5 });
    const snapshot = sim.snapshot();
    expect(() => sim.restore({ ...snapshot, version: 2 as 1 })).toThrow(/version/);
  });
});
