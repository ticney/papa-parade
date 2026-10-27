import type { ContentBundle, LevelContent } from '@content/contentBundle';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { hashJson } from '@shared/hash';
import { type AppError, err, ok, type Result } from '@shared/result';
import { createSim, type Sim } from './createSim.ts';
import type { SimEvent } from './events.ts';
import { type Journal, journalProblem } from './journal.ts';

export interface ReplayOptions {
  content: ContentBundle;
  /** The level geometry the journal was recorded on. */
  geometry: LevelGeometry;
  /** The level the journal was recorded on. */
  level: LevelContent;
  journal: Journal;
  /** Steps until `world.time.sim` reaches this sim time. */
  untilSimMs: number;
  strictInvariants?: boolean;
}

export interface ReplayResult {
  /** The replayed sim, at its end state. The caller owns it: call `sim.dispose()` when done reading it (it holds a physics world). */
  sim: Sim;
  /** Every event emitted during the replay, in order. */
  events: SimEvent[];
}

/**
 * Replays a journal from its start. A journal this build cannot replay (malformed, other feel, geometry or level, not recorded from the start) is an `err`, not a throw. An invariant violation during the replay
 * follows `strictInvariants`, as in a live game (strict throws).
 */
export async function replayJournal(
  options: ReplayOptions,
): Promise<Result<ReplayResult, AppError>> {
  const { content, geometry, level, journal, untilSimMs } = options;
  const problem = journalProblem(journal);
  if (problem !== null) return err({ kind: 'journal', message: problem });
  if (journal.feelHash !== hashJson(content.feel)) {
    return err({
      kind: 'journal',
      message: 'the journal was recorded with a different feel than the given content',
    });
  }
  if (journal.geometryHash !== hashJson(geometry)) {
    return err({
      kind: 'journal',
      message: `the journal was recorded on another level geometry than the given one (${geometry.id})`,
    });
  }
  if (journal.levelHash !== hashJson(level)) {
    return err({
      kind: 'journal',
      message: `the journal was recorded on another level than the given one (${level.level.id})`,
    });
  }
  if (journal.startSimMs !== 0) {
    return err({
      kind: 'journal',
      message: `the journal starts at ${journal.startSimMs} ms (a restored sim): it cannot be replayed from the start`,
    });
  }
  if (typeof untilSimMs !== 'number' || !Number.isFinite(untilSimMs)) {
    return err({
      kind: 'journal',
      message: `untilSimMs must be finite, got ${String(untilSimMs)}`,
    });
  }
  let sim: Sim;
  try {
    sim = await createSim({
      content,
      geometry,
      level,
      seed: journal.seed,
      journal,
      strictInvariants: options.strictInvariants,
    });
  } catch (cause) {
    // A level or a journal the sim refuses (no spawn, no room for Papa) is an unreplayable journal.
    return err({
      kind: 'journal',
      message: `the sim refused the journal: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return ok({ sim, events });
}
