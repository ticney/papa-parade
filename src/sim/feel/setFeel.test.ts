import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  stepN,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { System } from '../context.ts';
import { createSim, createSimWithSystems } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { replayJournal } from '../replay.ts';
import { SYSTEMS } from '../step.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const level = createTestLevel();
const planned = createTestLevel({ waves: [testWave([OUTLET])] });
const windowMs = content.feel.timing.windowMs;

const setWindow = (t: number, value: number) =>
  ({ type: 'SetFeel', t: asSimMs(t), patch: { timing: { windowMs: value } } }) as const;

describe('SetFeel in the sim', () => {
  it('is applied at its step, before any system of that step runs', async () => {
    const seen: number[] = [];
    const probe: System = (_world, ctx) => {
      seen.push(ctx.feel.timing.windowMs);
    };
    // Right behind applyCommands and ahead of every other system: were the feel swapped in later
    // in the step, this probe would still read the old one.
    const [applyCommands, ...others] = SYSTEMS;
    expect(applyCommands).toBeDefined();
    const sim = await createSimWithSystems({ content, geometry, level, seed: 1 }, [
      applyCommands as System,
      probe,
      ...others,
    ]);
    sim.enqueue(setWindow(0, windowMs + 77)); // applyAt 10: the first step ends at 10
    stepN(sim, 2);
    expect(seen).toEqual([windowMs + 77, windowMs + 77]);
    expect(sim.world.feel.timing.windowMs).toBe(windowMs + 77);
    sim.dispose();
  });

  it('applies at the next step for a late command, never in the past', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    stepN(sim, 30);
    sim.enqueue(setWindow(0, 123)); // late: applyAt = now + STEP_MS
    expect(sim.journal().entries.map((entry) => entry.applyAt)).toEqual([310]);
    expect(sim.world.feel.timing.windowMs).toBe(windowMs);
    stepN(sim, 1);
    expect(sim.world.feel.timing.windowMs).toBe(123);
    sim.dispose();
  });

  it('changes what a threat telegraphed in that step is judged against', async () => {
    const sim = await createSim({ content, geometry, level: planned, seed: 1 });
    sim.enqueue(setWindow(0, windowMs + 200));
    stepN(sim, 1);
    const threat = sim.world.threats[0];
    expect(threat?.state).toBe('telegraph');
    expect(threat?.responseWindow?.windowMs).toBe(windowMs + 200);
    sim.dispose();
  });

  it('keeps the initial feel hash in the journal and does not touch the content', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    const before = structuredClone(content.feel);
    sim.enqueue(setWindow(0, 999));
    stepN(sim, 3);
    expect(sim.journal().feelHash).toBe(hashJson(before));
    expect(sim.snapshot().feelHash).toBe(hashJson(before));
    expect(content.feel).toEqual(before);
    expect(sim.journal().entries[0]?.command.type).toBe('SetFeel');
    sim.dispose();
  });

  it('reads the new feel through ctx.feel without keeping the old object', async () => {
    const kept: object[] = [];
    const probe: System = (_world, ctx) => {
      kept.push(ctx.feel);
    };
    const sim = await createSimWithSystems({ content, geometry, level, seed: 1 }, [
      ...SYSTEMS,
      probe,
    ]);
    stepN(sim, 1);
    sim.enqueue(setWindow(0, 150));
    stepN(sim, 2);
    expect(kept[0]).not.toBe(kept[2]);
    expect(kept[2]).toBe(sim.world.feel);
    sim.dispose();
  });

  it('merges several patches in order, later ones over earlier ones', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    sim.enqueue(setWindow(0, 111));
    sim.enqueue({
      type: 'SetFeel',
      t: asSimMs(0),
      patch: { timing: { windowMs: 222 }, input: { earlyPress: 'guard' } },
    });
    stepN(sim, 1);
    expect(sim.world.feel.timing.windowMs).toBe(222);
    expect(sim.world.feel.input.earlyPress).toBe('guard');
    sim.dispose();
  });

  it.each([
    ['an unknown key', { timing: { nothingMs: 1 } }],
    ['a new key in a record', { physics: { kinds: { new_kind: { massKg: 1 } } } }],
    ['a leaf of another type', { timing: { windowMs: 'x' } }],
    ['an array of another length', { mama: { starThresholdPoints: [1] } }],
  ])(
    'refuses at enqueue a patch with %s, and leaves the journal and the other commands alone',
    async (_name, patch) => {
      const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: true });
      sim.enqueue(setWindow(0, 111));
      expect(() => sim.enqueue({ type: 'SetFeel', t: asSimMs(0), patch: patch as never })).toThrow(
        /invalid command: SetFeel: the patch does not fit the shape of the feel/,
      );
      expect(sim.journal().entries).toHaveLength(1);
      stepN(sim, 2); // the step does not throw and the valid patch is applied
      expect(sim.world.feel.timing.windowMs).toBe(111);
      sim.dispose();
    },
  );

  describe('a journal with a SetFeel that does not fit (apply-time guard)', () => {
    // `enqueue` refuses such a patch, so it can only come from a journal file.
    async function withBadEntry(strictInvariants: boolean) {
      const live = await createSim({ content, geometry, level, seed: 1 });
      const journal = live.journal();
      live.dispose();
      journal.entries.push({
        applyAt: asSimMs(10),
        command: { type: 'SetFeel', t: asSimMs(10), patch: { timing: { nothingMs: 1 } } as never },
      });
      journal.entries.push({ applyAt: asSimMs(10), command: setWindow(10, 222) });
      return createSim({ content, geometry, level, seed: 1, journal, strictInvariants });
    }

    it('ignores the patch and reports it (non strict), the next command still applies', async () => {
      const sim = await withBadEntry(false);
      stepN(sim, 1);
      expect(sim.world.feel.timing.windowMs).toBe(222);
      expect(sim.drainEvents()).toContainEqual({
        type: 'InvariantViolated',
        t: expect.any(Number),
        name: 'SetFeel.patch',
        value: 'shape',
      });
      sim.dispose();
    });

    it('throws in strict mode', async () => {
      const sim = await withBadEntry(true);
      expect(() => stepN(sim, 1)).toThrow(/SetFeel patch does not fit/);
      sim.dispose();
    });
  });

  it('refuses a malformed patch at enqueue', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    expect(() => sim.enqueue(setWindow(0, Number.NaN))).toThrow(/invalid command/);
    // A prototype key is stopped by commandProblem, before the merge ever sees it.
    const polluted = JSON.parse('{"__proto__":{"isAdmin":true}}');
    expect(() => sim.enqueue({ type: 'SetFeel', t: asSimMs(0), patch: polluted })).toThrow(
      /forbidden key __proto__/,
    );
    sim.dispose();
  });

  it('is drained and ignored once the level has ended', async () => {
    const short = createTestLevel({ durationMs: 100 });
    const sim = await createSim({ content, geometry, level: short, seed: 1 });
    stepN(sim, 12);
    expect(sim.world.flow.state).toBe('ended');
    sim.enqueue(setWindow(0, 555));
    stepN(sim, 3);
    expect(sim.world.feel.timing.windowMs).toBe(windowMs);
    sim.dispose();
  });

  it('is replayed to the same world and events, with the change at the same step', async () => {
    const live = await createSim({ content, geometry, level: planned, seed: 3 });
    const events: SimEvent[] = [];
    live.enqueue(setWindow(500, windowMs + 40));
    for (let i = 0; i < 400; i++) {
      live.step();
      events.push(...live.drainEvents());
    }
    const replay = await replayJournal({
      content,
      geometry,
      level: planned,
      journal: live.journal(),
      untilSimMs: live.world.time.sim,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(live.world));
    expect(replay.value.events).toEqual(events);
    expect(replay.value.sim.world.feel.timing.windowMs).toBe(windowMs + 40);
    replay.value.sim.dispose();
    live.dispose();
  });

  it('survives snapshot and restore: the restored sim reads the changed feel and continues the same', async () => {
    const live = await createSim({ content, geometry, level: planned, seed: 3 });
    live.enqueue(setWindow(0, windowMs + 25));
    stepN(live, 50);
    const snapshot = live.snapshot();
    expect(snapshot.world.feel.timing.windowMs).toBe(windowMs + 25);
    stepN(live, 100);

    const other = await createSim({ content, geometry, level: planned, seed: 3 });
    expect(other.world.feel.timing.windowMs).toBe(windowMs);
    other.restore(snapshot);
    expect(other.world.feel.timing.windowMs).toBe(windowMs + 25);
    stepN(other, 100);
    expect(hashJson(other.world)).toBe(hashJson(live.world));
    live.dispose();
    other.dispose();
  });

  it('refuses a snapshot whose feel is missing or does not have the shape of the sim’s feel', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    const good = sim.snapshot();
    const withFeel = (edit: (feel: Record<string, unknown>) => void) => {
      const copy = structuredClone(good);
      edit(copy.world.feel as unknown as Record<string, unknown>);
      return copy;
    };
    const timing = (feel: Record<string, unknown>) => feel.timing as Record<string, unknown>;
    const missing = structuredClone(good) as unknown as { world: Record<string, unknown> };
    delete missing.world.feel;
    expect(() => sim.restore(missing as never)).toThrow(/world\.feel is missing/);
    expect(() => sim.restore(withFeel((feel) => (timing(feel).windowMs = 'x')))).toThrow(
      /world\.feel\.timing\.windowMs/,
    );
    expect(() => sim.restore(withFeel((feel) => (timing(feel).extra = 1)))).toThrow(
      /world\.feel\.timing/,
    );
    expect(() => sim.restore(withFeel((feel) => delete timing(feel).windowMs))).toThrow(
      /world\.feel\.timing/,
    );
    expect(() =>
      sim.restore(
        withFeel(
          (feel) => ((feel.mama as { starThresholdPoints: number[] }).starThresholdPoints = [1]),
        ),
      ),
    ).toThrow(/starThresholdPoints/);
    expect(() => sim.restore(withFeel((feel) => (timing(feel).windowMs = Number.NaN)))).toThrow(
      /world\.feel\.timing\.windowMs/,
    );
    expect(() => sim.restore(good)).not.toThrow();
    sim.dispose();
  });
  it('restores a snapshot with a tail that holds a SetFeel, and applies it at its step', async () => {
    const live = await createSim({ content, geometry, level: planned, seed: 3 });
    stepN(live, 50);
    const snapshot = live.snapshot();
    const tail = [
      {
        applyAt: asSimMs(600),
        command: setWindow(600, windowMs + 60),
      },
    ];
    live.restore(snapshot, tail);
    expect(live.journal().startSimMs).toBe(500);
    stepN(live, 9);
    expect(live.world.feel.timing.windowMs).toBe(windowMs); // 590: not yet
    stepN(live, 1);
    expect(live.world.feel.timing.windowMs).toBe(windowMs + 60);

    // Another sim restored the same way ends in the same world.
    const other = await createSim({ content, geometry, level: planned, seed: 3 });
    other.restore(snapshot, tail);
    stepN(other, 10);
    stepN(live, 40);
    stepN(other, 40);
    expect(hashJson(other.world)).toBe(hashJson(live.world));
    expect(other.journal().entries).toEqual(tail);
    live.dispose();
    other.dispose();
  });

  it('replays two SetFeel that share an applyAt in their journal order, the later one winning', async () => {
    const live = await createSim({ content, geometry, level: planned, seed: 3 });
    live.enqueue({
      type: 'SetFeel',
      t: asSimMs(200),
      patch: { timing: { windowMs: windowMs + 10 }, input: { earlyPress: 'guard' } },
    });
    live.enqueue(setWindow(200, windowMs + 90));
    expect(live.journal().entries.map((entry) => entry.applyAt)).toEqual([200, 200]);
    stepN(live, 40);
    expect(live.world.feel.timing.windowMs).toBe(windowMs + 90);
    expect(live.world.feel.input.earlyPress).toBe('guard');

    const replay = await replayJournal({
      content,
      geometry,
      level: planned,
      journal: live.journal(),
      untilSimMs: live.world.time.sim,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.sim.world.feel.timing.windowMs).toBe(windowMs + 90);
    expect(replay.value.sim.world.feel.input.earlyPress).toBe('guard');
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(live.world));
    replay.value.sim.dispose();
    live.dispose();
  });

  it('applies a SetFeel before the press and release due on the same tick, live and in the replay', async () => {
    const live = await createSim({ content, geometry, level: planned, seed: 3 });
    stepN(live, 1);
    const threat = live.world.threats[0];
    if (threat === undefined || threat.responseWindow === null) throw new Error('no threat');
    const tick = Math.ceil((threat.windowOpenAt + 100) / 10) * 10;
    // One tick: a 4 ms press is a Parry with the feel's holdMinMs, a Firmness (so a wrongResponse
    // gag on this Parry threat) with the SetFeel's 2 ms. The SetFeel is enqueued between the two.
    live.enqueue({ type: 'PressThreat', t: asSimMs(tick - 5), threatId: threat.id });
    live.enqueue({ type: 'SetFeel', t: asSimMs(tick - 3), patch: { input: { holdMinMs: 2 } } });
    live.enqueue({ type: 'Release', t: asSimMs(tick - 1) });
    const applyAts = live.journal().entries.map((entry) => entry.applyAt);
    expect(new Set(applyAts)).toEqual(new Set([tick]));
    const events: SimEvent[] = [];
    while (live.world.time.sim < tick + 50) {
      live.step();
      events.push(...live.drainEvents());
    }
    expect(live.world.feel.input.holdMinMs).toBe(2);
    expect(events.filter((event) => event.type === 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'wrongResponse' }),
    ]);

    const replay = await replayJournal({
      content,
      geometry,
      level: planned,
      journal: live.journal(),
      untilSimMs: live.world.time.sim,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(replay.value.events.filter((event) => event.type === 'ResponseResolved')).toEqual(
      events.filter((event) => event.type === 'ResponseResolved'),
    );
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(live.world));
    replay.value.sim.dispose();
    live.dispose();
  });
});
