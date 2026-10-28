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
    const sim = await createSimWithSystems({ content, geometry, level, seed: 1 }, [
      ...SYSTEMS,
      probe,
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

  it('ignores a patch that does not fit the shape of the feel, and reports it (non strict)', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: false });
    const before = structuredClone(sim.world.feel);
    sim.enqueue({ type: 'SetFeel', t: asSimMs(0), patch: { timing: { nothingMs: 1 } } as never });
    stepN(sim, 1);
    expect(sim.world.feel).toEqual(before);
    const events: SimEvent[] = [...sim.drainEvents()];
    expect(events).toContainEqual({
      type: 'InvariantViolated',
      t: expect.any(Number),
      name: 'SetFeel.patch',
      value: 'shape',
    });
    sim.dispose();
  });

  it('throws on a patch that does not fit the shape in strict mode', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1, strictInvariants: true });
    sim.enqueue({ type: 'SetFeel', t: asSimMs(0), patch: { timing: { windowMs: 'x' } } as never });
    expect(() => stepN(sim, 1)).toThrow(/SetFeel patch does not fit/);
    sim.dispose();
  });

  it('refuses a malformed patch at enqueue', async () => {
    const sim = await createSim({ content, geometry, level, seed: 1 });
    expect(() => sim.enqueue(setWindow(0, Number.NaN))).toThrow(/invalid command/);
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
});
