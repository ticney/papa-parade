import { SNAPSHOT_EVERY_MS } from '@shared/constants';
import type { Sim, SimSnapshot } from '@sim';

/**
 * The snapshots of the live sim, one every `SNAPSHOT_EVERY_MS` of sim time (story 3.9, D2): what the
 * highlight replay restores from. Pure over the sim it is given: `Sim.snapshot()` is a read.
 */
export interface SnapshotLog {
  /**
   * Takes a snapshot if the sim is on the grid (`world.time.sim` a multiple of the interval, 0
   * included) and none was taken at this time yet. Call it before the step, before any command of
   * the step is enqueued. Returns whether it took one.
   */
  take(sim: Sim): boolean;
  /** The latest snapshot taken at or before `simMs`, or `null` when there is none. */
  latestAtOrBefore(simMs: number): SimSnapshot | null;
  /** Forgets every snapshot (a new level starts, or the sim is released). */
  clear(): void;
}

export function createSnapshotLog(everyMs: number = SNAPSHOT_EVERY_MS): SnapshotLog {
  // In taking order, so by increasing sim time.
  let snapshots: { readonly atMs: number; readonly snapshot: SimSnapshot }[] = [];
  return {
    take(sim) {
      const nowMs = sim.world.time.sim;
      if (nowMs % everyMs !== 0) return false;
      const last = snapshots.at(-1);
      if (last !== undefined && last.atMs >= nowMs) return false;
      snapshots.push({ atMs: nowMs, snapshot: sim.snapshot() });
      return true;
    },
    latestAtOrBefore(simMs) {
      for (let index = snapshots.length - 1; index >= 0; index--) {
        const entry = snapshots[index];
        if (entry !== undefined && entry.atMs <= simMs) return entry.snapshot;
      }
      return null;
    },
    clear() {
      snapshots = [];
    },
  };
}
