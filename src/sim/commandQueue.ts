import { STEP_MS } from '@shared/constants';
import { asSimMs, type SimMs } from '@shared/time';
import type { SimCommand } from './commands.ts';
import type { StepContext } from './context.ts';
import type { JournalEntry } from './journal.ts';
import type { World } from './world.ts';

/**
 * The step end time that applies a command enqueued while the sim is at `simNow`: the first step
 * grid point at or after `t`, and never earlier than the next step (a late command waits for it).
 */
export function computeApplyAt(t: number, simNow: number): SimMs {
  return asSimMs(Math.max(Math.ceil(t / STEP_MS) * STEP_MS, simNow + STEP_MS));
}

/** Pending entries, ordered by `applyAt` then by enqueue order. Lives outside `World`. */
export interface CommandQueue {
  /** Inserts after every entry with an `applyAt` at or before the new one (stable). */
  push(entry: JournalEntry): void;
  /** Moves the entries with `applyAt <= untilAt` into `out`, in order. */
  drainDue(untilAt: number, out: SimCommand[]): void;
  clear(): void;
  readonly size: number;
}

export function createCommandQueue(): CommandQueue {
  const pending: JournalEntry[] = [];
  return {
    push(entry) {
      let index = pending.length;
      while (index > 0 && (pending[index - 1] as JournalEntry).applyAt > entry.applyAt) index--;
      pending.splice(index, 0, entry);
    },
    drainDue(untilAt, out) {
      let count = 0;
      while (count < pending.length && (pending[count] as JournalEntry).applyAt <= untilAt) {
        out.push((pending[count] as JournalEntry).command);
        count++;
      }
      if (count === 0) return;
      // Compact in place: `splice` would allocate its result array on every step with a command.
      for (let i = count; i < pending.length; i++) pending[i - count] = pending[i] as JournalEntry;
      pending.length -= count;
    },
    clear() {
      pending.length = 0;
    },
    get size() {
      return pending.length;
    },
  };
}

/** System: moves the commands due at this step (the one ending at `sim + STEP_MS`) into `ctx.commands`. */
export function applyCommands(world: World, ctx: StepContext): void {
  ctx.commands.length = 0;
  ctx.queue.drainDue(world.time.sim + STEP_MS, ctx.commands);
}
