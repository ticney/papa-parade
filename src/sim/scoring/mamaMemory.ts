import type { MamaLine } from '@content/schemas/mamaLines';
import type { MamaMemory } from '@content/schemas/save';
import { MAMA_LINES_SEED_SALT } from '@shared/constants';
import { invariant } from '@shared/invariant';
import { createRng, nextInt } from '@shared/rng';
import type { LevelEndReason, SimEvent } from '../events.ts';
import type { GagId } from '../threats/gags.ts';
import type { MamaReaction } from './mamaReactions.ts';

/** One of Mama's reactions with the line she says (story 3.8). `lineId` is the id in `content/mama-lines.json`. */
export type MamaReactionLine = MamaReaction & { lineId: string; text: string };

/**
 * The tag of an event, for Mama's memory (story 3.8, D2): the gag of a `GagTriggered`, a `NearMiss` or a
 * `NearMissFrozen` (a near miss frozen on the photo has no `GagTriggered`), `null` for any other event.
 * A tag is a gag id: the list is closed, checked, and nothing hashed changes.
 */
export function mamaTagOf(event: SimEvent): GagId | null {
  return event.type === 'GagTriggered' ||
    event.type === 'NearMiss' ||
    event.type === 'NearMissFrozen'
    ? event.gag
    : null;
}

/**
 * Mama's memory after one more game (story 3.8, D3): `+1` per distinct tag of the run. It counts the games in which
 * a tag happened, not its occurrences, so five stair slides in one game add 1. A new object; the input is not
 * changed, and a tag the content no longer knows is kept as it is.
 */
export function addRunToMamaMemory(
  memory: Readonly<MamaMemory>,
  runTags: ReadonlySet<string>,
): MamaMemory {
  const counts: Record<string, number> = { ...memory.counts };
  for (const tag of runTags) counts[tag] = (counts[tag] ?? 0) + 1;
  return { counts };
}

/** Everything `chooseMamaLines` reads. No `world`: the choice happens after `LevelScored`, in the client. */
export interface ChooseMamaLinesInput {
  /** The reactions she has, in the order they play (`mamaReactionsOf`). */
  reactions: readonly MamaReaction[];
  endReason: LevelEndReason;
  /** The tags of the game she is shown. */
  runTags: ReadonlySet<string>;
  /** What she remembers of the games **before** this one. */
  memory: Readonly<MamaMemory>;
  lines: readonly MamaLine[];
  /** The level's seed: it breaks a tie, off `world.rng`. */
  seed: number;
}

function conditionCountOf(line: MamaLine): number {
  return (line.when?.tag === undefined ? 0 : 1) + (line.when?.endReason === undefined ? 0 : 1);
}

/** Positive when `a` is more specific than `b`: more conditions first, then the larger `minPrevious`. */
function compareSpecificity(a: MamaLine, b: MamaLine): number {
  return (
    conditionCountOf(a) - conditionCountOf(b) ||
    (a.when?.minPrevious ?? 0) - (b.when?.minPrevious ?? 0)
  );
}

function holds(line: MamaLine, input: ChooseMamaLinesInput): boolean {
  const when = line.when;
  if (when === undefined) return true;
  if (when.endReason !== undefined && when.endReason !== input.endReason) return false;
  if (when.tag === undefined) return true;
  return (
    input.runTags.has(when.tag) && (input.memory.counts[when.tag] ?? 0) >= (when.minPrevious ?? 0)
  );
}

/**
 * The line Mama says for each reaction (story 3.8, FR36, D6). A line is a candidate when its reaction matches
 * and its `when` holds (no `when`: always); `tag` must have happened in this game and in at least `minPrevious`
 * of the previous ones. The most specific candidates win: the number of conditions (`tag`, `endReason`) first,
 * then the larger `minPrevious`. Among equals in file order, one is drawn from a local stream seeded with the
 * level's seed (one stream per call, in the order of the reactions, only when two or more tie). With no
 * specific candidate the reaction's generic lines (no `when`) are the candidates: `content:check` guarantees
 * at least one per reaction. Pure: the same inputs give the same lines, and it touches neither the world nor its rng.
 */
export function chooseMamaLines(input: ChooseMamaLinesInput): readonly MamaReactionLine[] {
  const rng = createRng((input.seed ^ MAMA_LINES_SEED_SALT) >>> 0);
  return input.reactions.map((entry) => {
    const candidates = input.lines.filter(
      (line) => line.reaction === entry.reaction && holds(line, input),
    );
    invariant(candidates.length > 0, `Mama has no line for her ${entry.reaction}`);
    let best: MamaLine[] = [];
    for (const line of candidates) {
      const first = best[0];
      const order = first === undefined ? 1 : compareSpecificity(line, first);
      if (order < 0) continue;
      if (order > 0) best = [];
      best.push(line);
    }
    const chosen = best.length === 1 ? best[0] : best[nextInt(rng, 0, best.length)];
    invariant(chosen !== undefined, `Mama has no line for her ${entry.reaction}`);
    return { ...entry, lineId: chosen.id, text: chosen.text };
  });
}
