import type { ChoreDef } from '@content/schemas/chore';
import type { SimEvent } from '@sim';

/**
 * The cue a house chore's event plays (story 9.4), named by the chore's def (`feedback.telegraph / success /
 * perfect / miss / completed`), or `null` when the event plays none: the `events` table never carries
 * these, a def does, so a second chore has its own sounds by JSON alone (the model of `threatCueOf`).
 * `defs` is index-aligned with `world.chores` (`Sim.chores`, `choreIndex` of the event). A refused tap
 * (`ChoreRefused`) is the table's: its cue is the same for every chore. A missed beat plays `miss`, and
 * its `fail` is the whole gag until stories 9.5 and 9.6 bring the chores' own. Allocates nothing.
 */
export function choreCueOf(
  event: SimEvent,
  defs: readonly Readonly<{ readonly def: ChoreDef }>[],
): string | null {
  switch (event.type) {
    case 'ChoreBeatTelegraphed':
      return defs[event.choreIndex]?.def.feedback.telegraph ?? null;
    case 'ChoreBeatJudged': {
      const feedback = defs[event.choreIndex]?.def.feedback;
      if (feedback === undefined) return null;
      if (event.quality === 'perfect') return feedback.perfect;
      return event.quality === 'success' ? feedback.success : feedback.miss;
    }
    case 'ChoreCompleted':
      return defs[event.choreIndex]?.def.feedback.completed ?? null;
    default:
      return null;
  }
}
