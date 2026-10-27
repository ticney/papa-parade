import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  stepN,
} from '../../tests/support/testContent.ts';
import { computeApplyAt, createCommandQueue } from './commandQueue.ts';
import type { SimCommand } from './commands.ts';
import type { System } from './context.ts';
import { createSim, createSimWithSystems } from './createSim.ts';
import type { JournalEntry } from './journal.ts';
import { SYSTEMS } from './step.ts';

const scale = (t: number, value = 0.5): SimCommand => ({
  type: 'SetTimeScale',
  t: asSimMs(t),
  scale: value,
});
const entry = (applyAt: number, value: number): JournalEntry => ({
  applyAt: asSimMs(applyAt),
  command: scale(0, value),
});

describe('computeApplyAt (rule table)', () => {
  it.each([
    // [t, simNow, applyAt]
    [250, 0, 250],
    [251, 0, 260],
    [250.4, 0, 260],
    [0, 0, 10],
    [-30, 0, 10],
    [1005, 1000, 1010],
    [980, 1000, 1010],
    [1012, 1000, 1020],
    [-0, 0, 10],
    [1e15 + 0.1, 0, 1e15 + 10],
    [2 ** 53, 0, 9007199254741000],
  ])('t=%d at sim %d applies at %d', (t, simNow, applyAt) => {
    expect(computeApplyAt(t, simNow)).toBe(applyAt);
  });
});

describe('createCommandQueue', () => {
  it('orders by applyAt, then by enqueue order', () => {
    const queue = createCommandQueue();
    queue.push(entry(30, 0.3));
    queue.push(entry(10, 0.1));
    queue.push(entry(30, 0.31));
    queue.push(entry(20, 0.2));
    const out: SimCommand[] = [];
    queue.drainDue(30, out);
    expect(out.map((c) => (c as { scale: number }).scale)).toEqual([0.1, 0.2, 0.3, 0.31]);
    expect(queue.size).toBe(0);
  });

  it('only drains what is due and keeps the rest', () => {
    const queue = createCommandQueue();
    queue.push(entry(10, 0.1));
    queue.push(entry(20, 0.2));
    const out: SimCommand[] = [];
    queue.drainDue(10, out);
    expect(out).toHaveLength(1);
    expect(queue.size).toBe(1);
    queue.clear();
    expect(queue.size).toBe(0);
  });
});

describe('commands through the sim', () => {
  async function appliedAtStep(t: number, enqueueAfterSteps = 0): Promise<number> {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    stepN(sim, enqueueAfterSteps);
    sim.enqueue(scale(t));
    for (let i = 1; i < 1000; i++) {
      sim.step();
      if (sim.timeScale !== 1) return enqueueAfterSteps + i;
    }
    throw new Error('the command was never applied');
  }

  it('applies t=250 at step 25 and t=251 at step 26', async () => {
    expect(await appliedAtStep(250)).toBe(25);
    expect(await appliedAtStep(251)).toBe(26);
    expect(await appliedAtStep(250.4)).toBe(26);
  });

  it('applies t=0 and a negative t at the first step', async () => {
    expect(await appliedAtStep(0)).toBe(1);
    expect(await appliedAtStep(-30)).toBe(1);
  });

  it('applies a late command at the next step, and a near-future one at the second', async () => {
    expect(await appliedAtStep(980, 100)).toBe(101);
    expect(await appliedAtStep(1005, 100)).toBe(101);
    expect(await appliedAtStep(1012, 100)).toBe(102);
  });

  it('after N steps, every command with t <= 10 N has been applied', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    sim.enqueue(scale(40, 0.4));
    sim.enqueue(scale(41, 0.41));
    stepN(sim, 4);
    expect(sim.timeScale).toBe(0.4);
    sim.step();
    expect(sim.timeScale).toBe(0.41);
  });

  it('applies two commands of the same step in enqueue order (the last one wins)', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    sim.enqueue(scale(10, 0.6));
    sim.enqueue(scale(10, 0.7));
    sim.step();
    expect(sim.timeScale).toBe(0.7);
  });

  it('records every command in the journal with its applyAt', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 9,
    });
    stepN(sim, 100);
    sim.enqueue(scale(980, 0.5));
    expect(sim.journal().entries).toEqual([{ applyAt: 1010, command: scale(980, 0.5) }]);
  });

  it('refuses a command whose t is missing, not finite or not a number', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    for (const t of [undefined, Number.NaN, Number.POSITIVE_INFINITY, '50']) {
      const bad = { type: 'SetTimeScale', t, scale: 0.5 } as unknown as SimCommand;
      expect(() => sim.enqueue(bad)).toThrow(/invalid command/);
    }
    expect(() => sim.enqueue({ type: 'Nope', t: 1 } as unknown as SimCommand)).toThrow(/unknown/);
    expect(() =>
      sim.enqueue({ type: 'SetTimeScale', t: 1, scale: '0.5' } as unknown as SimCommand),
    ).toThrow(/scale must be a number/);
    expect(sim.journal().entries).toEqual([]);
  });

  it('keeps the journal intact when a system mutates the commands it is handed', async () => {
    const mutate: System = (_world, ctx) => {
      for (const command of ctx.commands) (command as { scale: number }).scale = 0.99;
    };
    const sim = await createSimWithSystems(
      {
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel(),
        seed: 1,
      },
      [...SYSTEMS, mutate],
    );
    sim.enqueue(scale(10, 0.5));
    sim.step();
    expect(sim.journal().entries[0]?.command).toMatchObject({ scale: 0.5 });
  });

  it('orders a pre-loaded entry before a new one at the same applyAt', async () => {
    const source = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    source.enqueue(scale(10, 0.6));
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
      journal: source.journal(),
    });
    sim.enqueue(scale(10, 0.7));
    sim.step();
    expect(sim.timeScale).toBe(0.7);
  });

  it('copies the command: mutating it after enqueue changes nothing', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    const command = scale(10, 0.5) as { t: number; scale: number };
    sim.enqueue(command as SimCommand);
    command.scale = 0.9;
    sim.step();
    expect(sim.timeScale).toBe(0.5);
    expect(sim.journal().entries[0]?.command).toMatchObject({ scale: 0.5 });
  });
});
