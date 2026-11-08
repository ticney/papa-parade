import { SNAPSHOT_EVERY_MS, STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { asSimMs } from '@shared/time';
import { createSim, type JournalEntry, type Sim, type SimSnapshot } from '@sim';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createTestContent,
  createTestFeedback,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import type { Highlight } from './highlights.ts';
import { createMomentSim, momentWindowOf, type ReplaySource } from './momentSim.ts';
import { createSnapshotLog } from './snapshotLog.ts';

const RULES = createTestFeedback().replay;
const warnSpy = vi.spyOn(log, 'warn');

beforeAll(() => {
  log.setLevel('error');
});

const highlightAt = (t: number): Highlight => ({
  t: asSimMs(t),
  threatId: 7,
  points: 3,
  kinds: ['perfect'],
  anchorId: null,
});

describe('momentWindowOf', () => {
  it('plays preRollMs before and postRollMs after the moment', () => {
    expect(momentWindowOf(highlightAt(20_000), RULES, null)).toEqual({
      fromMs: 20_000 - RULES.preRollMs,
      untilMs: 20_000 + RULES.postRollMs,
    });
  });

  it('starts at 0 for a moment earlier than preRollMs', () => {
    expect(momentWindowOf(highlightAt(500), RULES, null).fromMs).toBe(0);
  });

  it('stops at the end of the level when the post-roll goes past it', () => {
    expect(momentWindowOf(highlightAt(20_000), RULES, 20_400).untilMs).toBe(20_400);
  });

  it('keeps the post-roll when the level ends after it', () => {
    expect(momentWindowOf(highlightAt(20_000), RULES, 99_000).untilMs).toBe(
      20_000 + RULES.postRollMs,
    );
  });

  it('puts both ends on the step grid', () => {
    const window = momentWindowOf(
      highlightAt(20_000),
      { preRollMs: 2_005, postRollMs: 1_503 },
      null,
    );
    expect(window.fromMs % STEP_MS).toBe(0);
    expect(window.untilMs % STEP_MS).toBe(0);
    expect(window).toEqual({ fromMs: 17_990, untilMs: 21_510 });
  });
});

/** A sim double that records what it is told. */
function fakeSimMaker(options: { restoreThrows?: boolean } = {}) {
  const calls = {
    created: 0,
    restored: [] as { snapshot: SimSnapshot; tail: readonly JournalEntry[] | undefined }[],
    stepped: 0,
    drained: 0,
    disposed: 0,
  };
  const state = { simMs: 0 };
  const sim = {
    world: {
      get time() {
        return { sim: state.simMs };
      },
    },
    restore(snapshot: SimSnapshot, tail?: readonly JournalEntry[]) {
      if (options.restoreThrows) throw new Error('refused: feelHash');
      calls.restored.push({ snapshot, tail });
      state.simMs = snapshot.world.time.sim;
    },
    step() {
      calls.stepped++;
      state.simMs += STEP_MS;
    },
    drainEvents() {
      calls.drained++;
      return [];
    },
    dispose() {
      calls.disposed++;
    },
  } as unknown as Sim;
  return {
    calls,
    createSim: async () => {
      calls.created++;
      return sim;
    },
  };
}

const snapshotAt = (atMs: number): SimSnapshot =>
  ({ world: { time: { sim: atMs } } }) as unknown as SimSnapshot;

/** A source whose log holds fake snapshots at 0, 5 s and 10 s, and a journal of commands around them. */
function fakeSource(): { source: ReplaySource; asked: number[] } {
  const asked: number[] = [];
  const bySim = [0, 5000, 10_000].map((atMs) => snapshotAt(atMs));
  const source: ReplaySource = {
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel(),
    seed: 3,
    journal: () =>
      ({
        entries: [4990, 5000, 5010, 12_000].map((applyAt) => ({
          applyAt: asSimMs(applyAt),
          command: { type: 'Noop', t: asSimMs(applyAt) },
        })),
      }) as unknown as ReturnType<ReplaySource['journal']>,
    snapshots: {
      take: () => false,
      clear: () => {},
      latestAtOrBefore(simMs) {
        asked.push(simMs);
        return [...bySim].reverse().find((s) => s.world.time.sim <= simMs) ?? null;
      },
    },
    endedAt: null,
  };
  return { source, asked };
}

describe('createMomentSim (fake sim)', () => {
  it('restores the latest snapshot at or before the start with the entries after it', async () => {
    const { source, asked } = fakeSource();
    const maker = fakeSimMaker();
    const result = await createMomentSim(source, highlightAt(12_000), RULES, {
      createSim: maker.createSim,
    });
    expect(result.ok).toBe(true);
    // fromMs = 12000 − 2000 = 10000: the snapshot at 10000 itself.
    expect(asked).toEqual([10_000]);
    expect(maker.calls.restored).toHaveLength(1);
    expect(maker.calls.restored[0]?.snapshot.world.time.sim).toBe(10_000);
    // Only `applyAt > 10000`: not the entries applied before the snapshot.
    expect(maker.calls.restored[0]?.tail?.map((entry) => entry.applyAt)).toEqual([12_000]);
  });

  it('keeps an entry applied one step after the snapshot and drops the one at the snapshot', async () => {
    const { source } = fakeSource();
    const maker = fakeSimMaker();
    await createMomentSim(source, highlightAt(7000), RULES, { createSim: maker.createSim });
    // fromMs = 5000: snapshot at 5000; entries 5010 and 12000 are still to apply, 4990 and 5000 are not.
    expect(maker.calls.restored[0]?.tail?.map((entry) => entry.applyAt)).toEqual([5010, 12_000]);
  });

  it('steps silently from the snapshot up to the start, dropping the events', async () => {
    const { source } = fakeSource();
    const maker = fakeSimMaker();
    // fromMs = 8000 − 2000 = 6000: restore at 5000, then 100 silent steps.
    const result = await createMomentSim(source, highlightAt(8000), RULES, {
      createSim: maker.createSim,
    });
    expect(maker.calls.stepped).toBe(1000 / STEP_MS);
    expect(maker.calls.drained).toBe(1000 / STEP_MS);
    if (!result.ok) throw new Error('expected ok');
    expect(result.value.sim.world.time.sim).toBe(6000);
    expect(result.value).toMatchObject({ fromMs: 6000, untilMs: 8000 + RULES.postRollMs });
    expect(maker.calls.disposed).toBe(0);
  });

  it('is an err with a warn and a disposed sim when the restore is refused', async () => {
    const { source } = fakeSource();
    const maker = fakeSimMaker({ restoreThrows: true });
    warnSpy.mockClear();
    const result = await createMomentSim(source, highlightAt(12_000), RULES, {
      createSim: maker.createSim,
    });
    expect(result.ok).toBe(false);
    expect(maker.calls.disposed).toBe(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[2]).toMatchObject({ t: 12_000, threatId: 7 });
  });

  it('is an err with a warn, and creates no sim, with no snapshot', async () => {
    const { source } = fakeSource();
    const maker = fakeSimMaker();
    warnSpy.mockClear();
    const result = await createMomentSim(
      { ...source, snapshots: { ...source.snapshots, latestAtOrBefore: () => null } },
      highlightAt(12_000),
      RULES,
      { createSim: maker.createSim },
    );
    expect(result.ok).toBe(false);
    expect(maker.calls.created).toBe(0);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });

  it('is an err and disposes nothing twice when the sim cannot be created', async () => {
    const { source } = fakeSource();
    warnSpy.mockClear();
    const result = await createMomentSim(source, highlightAt(12_000), RULES, {
      createSim: async () => {
        throw new Error('no wasm');
      },
    });
    expect(result.ok).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe('createMomentSim (real sim)', () => {
  it('reaches the very world the live sim had at the start of the moment', async () => {
    const args = {
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 11,
    };
    const live = await createSim(args);
    const log5 = createSnapshotLog();
    let hashAtFrom = '';
    let hashAtUntil = '';
    const highlight = highlightAt(8000);
    const window = momentWindowOf(highlight, RULES, null);
    // A command at 6.5 s, after the snapshot at 5 s: it is in the tail.
    live.enqueue({ type: 'SetInputLag', lagMs: 40, t: asSimMs(6500) });
    for (let nowMs = 0; nowMs < 12_000; nowMs += STEP_MS) {
      log5.take(live);
      if (live.world.time.sim === window.fromMs) hashAtFrom = hashJson(live.world);
      if (live.world.time.sim === window.untilMs) hashAtUntil = hashJson(live.world);
      live.step();
      live.drainEvents();
    }
    expect(hashAtFrom).not.toBe('');
    expect(window.fromMs % SNAPSHOT_EVERY_MS).not.toBe(0);

    const source: ReplaySource = {
      ...args,
      journal: () => live.journal(),
      snapshots: log5,
      endedAt: null,
    };
    const result = await createMomentSim(source, highlight, RULES);
    if (!result.ok) throw new Error(`expected ok: ${result.error.message}`);
    const { sim } = result.value;
    expect(hashJson(sim.world)).toBe(hashAtFrom);
    while (sim.world.time.sim < window.untilMs) {
      sim.step();
      sim.drainEvents();
    }
    expect(hashJson(sim.world)).toBe(hashAtUntil);
    sim.dispose();
    live.dispose();
  });
});
