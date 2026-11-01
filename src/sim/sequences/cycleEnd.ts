import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

// The end of an entry of the bedtime cycle (story 4.10), apart from `bedtimeCycle.ts`: `sequenceEnd.ts`
// calls it, and `bedtimeCycle.ts` imports the start of a sequence, which imports `sequenceEnd.ts`.

/**
 * The sequence `sequenceId` ended, won or lost (`succeedSequence` and `failSequence` call this last;
 * a level end does not). A no-op in a level with no cycle and for a sequence that is not the current
 * entry's, so a debug `StartSequence` of another one moves nothing; of the current entry's id it counts
 * as that entry (the slice does not say who started it). Won: the next entry is due after its
 * `interludeMs`; after the last one the cycle is done (`CycleCompleted`, and `runFlow` ends the level
 * in this very step). Lost: the same entry again, after `retryInterludeMs` (D4).
 */
export function advanceCycle(
  world: World,
  ctx: StepContext,
  sequenceId: string | null,
  isWon: boolean,
): void {
  const planned = ctx.level.cycle;
  if (planned === null) return;
  const { cycle } = world;
  if (planned.entries[cycle.index]?.sequenceId !== sequenceId) return;
  const now = world.time.sim;
  if (!isWon) {
    cycle.nextAt = asSimMs(now + planned.retryInterludeMs);
    return;
  }
  cycle.index += 1;
  const next = planned.entries[cycle.index];
  if (next !== undefined) {
    cycle.nextAt = asSimMs(now + next.interludeMs);
    return;
  }
  cycle.nextAt = null;
  cycle.completedAt = now;
  ctx.events.push({ type: 'CycleCompleted', t: now });
}
