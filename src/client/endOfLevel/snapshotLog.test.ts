import { SNAPSHOT_EVERY_MS } from '@shared/constants';
import type { Sim, SimSnapshot } from '@sim';
import { describe, expect, it } from 'vitest';
import { createSnapshotLog } from './snapshotLog.ts';

/** A sim double: a clock and a snapshot that remembers the time it was taken at. */
function fakeSim(initialMs = 0) {
  const state = { simMs: initialMs, taken: 0 };
  const sim = {
    world: {
      get time() {
        return { sim: state.simMs };
      },
    },
    snapshot() {
      state.taken++;
      return { atMs: state.simMs } as unknown as SimSnapshot;
    },
  } as unknown as Sim;
  return { sim, state };
}

const atMsOf = (snapshot: SimSnapshot | null): number | null =>
  snapshot === null ? null : (snapshot as unknown as { atMs: number }).atMs;

describe('createSnapshotLog', () => {
  it('takes one at 0 and one at each multiple of the interval, and only those', () => {
    const log = createSnapshotLog();
    const { sim, state } = fakeSim();
    const takenAt: number[] = [];
    for (; state.simMs <= 3 * SNAPSHOT_EVERY_MS; state.simMs += 10) {
      if (log.take(sim)) takenAt.push(state.simMs);
    }
    expect(takenAt).toEqual([0, SNAPSHOT_EVERY_MS, 2 * SNAPSHOT_EVERY_MS, 3 * SNAPSHOT_EVERY_MS]);
    expect(state.taken).toBe(4);
  });

  it('never takes two at the same time (a frozen sim, an advance with no step)', () => {
    const log = createSnapshotLog();
    const { sim, state } = fakeSim();
    expect(log.take(sim)).toBe(true);
    expect(log.take(sim)).toBe(false);
    expect(log.take(sim)).toBe(false);
    expect(state.taken).toBe(1);
  });

  it('takes nothing off the grid', () => {
    const log = createSnapshotLog();
    const { sim, state } = fakeSim(10);
    expect(log.take(sim)).toBe(false);
    expect(state.taken).toBe(0);
  });

  describe('latestAtOrBefore', () => {
    const filled = () => {
      const log = createSnapshotLog();
      const { sim, state } = fakeSim();
      for (; state.simMs <= 2 * SNAPSHOT_EVERY_MS; state.simMs += 10) log.take(sim);
      return log;
    };

    it('is null when the log is empty', () => {
      expect(createSnapshotLog().latestAtOrBefore(0)).toBeNull();
    });

    it('is the first snapshot at 0', () => {
      expect(atMsOf(filled().latestAtOrBefore(0))).toBe(0);
    });

    it('is a snapshot taken exactly at the asked time', () => {
      expect(atMsOf(filled().latestAtOrBefore(SNAPSHOT_EVERY_MS))).toBe(SNAPSHOT_EVERY_MS);
    });

    it('is the one before, one step short of the next', () => {
      expect(atMsOf(filled().latestAtOrBefore(SNAPSHOT_EVERY_MS - 10))).toBe(0);
    });

    it('is the last one past the end', () => {
      expect(atMsOf(filled().latestAtOrBefore(10 * SNAPSHOT_EVERY_MS))).toBe(2 * SNAPSHOT_EVERY_MS);
    });

    it('is null before the first snapshot', () => {
      const log = createSnapshotLog();
      const { sim } = fakeSim(SNAPSHOT_EVERY_MS);
      log.take(sim);
      expect(log.latestAtOrBefore(SNAPSHOT_EVERY_MS - 10)).toBeNull();
    });
  });

  it('clear forgets everything and takes again at the same time', () => {
    const log = createSnapshotLog();
    const { sim, state } = fakeSim();
    log.take(sim);
    log.clear();
    expect(log.latestAtOrBefore(0)).toBeNull();
    expect(log.take(sim)).toBe(true);
    expect(state.taken).toBe(2);
  });
});
