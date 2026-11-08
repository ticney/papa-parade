import type { ContentBundle, LevelContent } from '@content/contentBundle';
import type { ReplaySettings } from '@content/schemas/feedback';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { log } from '@shared/log';
import { type AppError, err, ok, type Result } from '@shared/result';
import { type CreateSimOptions, createSim, type Journal, type Sim } from '@sim';
import type { Highlight } from './highlights.ts';
import type { SnapshotLog } from './snapshotLog.ts';

/**
 * What the highlight replay needs of the live game (story 3.9, AC 3). `content` is the **exact
 * bundle the live sim was created with** (feel.json plus the level's `feelOverrides`), not the
 * feel the player tuned: a restore refuses another `feelHash`, and the tweaks are in the journal.
 */
export interface ReplaySource {
  readonly content: ContentBundle;
  readonly geometry: LevelGeometry;
  readonly level: LevelContent;
  readonly seed: number;
  /** The live sim's journal, as of now. */
  journal(): Journal;
  readonly snapshots: SnapshotLog;
  /** The `t` of the `LevelEnded` the session saw, `null` before it. */
  readonly endedAt: number | null;
}

/** A sim restored a little before a moment, and when it should stop (sim ms, on the step grid). */
export interface MomentSim {
  /** The caller's to dispose (WASM memory). */
  readonly sim: Sim;
  readonly fromMs: number;
  readonly untilMs: number;
}

export interface MomentSimDeps {
  /** Default: `createSim`. */
  readonly createSim?: (options: CreateSimOptions) => Promise<Sim>;
}

const floorToStep = (ms: number): number => Math.floor(ms / STEP_MS) * STEP_MS;
const ceilToStep = (ms: number): number => Math.ceil(ms / STEP_MS) * STEP_MS;

/** The window of a moment, in sim ms on the step grid: `[t − preRollMs, t + postRollMs]`, clamped to the game. */
export function momentWindowOf(
  highlight: Highlight,
  rules: Pick<ReplaySettings, 'preRollMs' | 'postRollMs'>,
  endedAt: number | null,
): { readonly fromMs: number; readonly untilMs: number } {
  const fromMs = floorToStep(Math.max(0, highlight.t - rules.preRollMs));
  const untilMs = Math.max(
    fromMs,
    ceilToStep(Math.min(endedAt ?? Number.POSITIVE_INFINITY, highlight.t + rules.postRollMs)),
  );
  return { fromMs, untilMs };
}

/**
 * Builds a second sim, restored from the latest snapshot at or before the start of the moment and
 * stepped silently up to it (its events are drained and dropped). A refused restore, a missing
 * snapshot or a sim that throws is an `err` with a warn naming the moment; the sim made so far is
 * disposed. On success the caller owns the sim and disposes it: never more than one is alive.
 */
export async function createMomentSim(
  source: ReplaySource,
  highlight: Highlight,
  rules: Pick<ReplaySettings, 'preRollMs' | 'postRollMs'>,
  deps: MomentSimDeps = {},
): Promise<Result<MomentSim, AppError>> {
  const makeSim = deps.createSim ?? createSim;
  const { fromMs, untilMs } = momentWindowOf(highlight, rules, source.endedAt);
  const fail = (message: string, cause: unknown): Result<MomentSim, AppError> => {
    log.warn('render', `cannot replay the moment: ${message}`, {
      t: highlight.t,
      threatId: highlight.threatId,
      cause,
    });
    return err({ kind: 'replay', message, cause });
  };

  let sim: Sim | null = null;
  try {
    const snapshot = source.snapshots.latestAtOrBefore(fromMs);
    if (snapshot === null) return fail('no snapshot at or before its start', null);
    sim = await makeSim({
      content: source.content,
      geometry: source.geometry,
      level: source.level,
      seed: source.seed,
    });
    const snapshotMs = snapshot.world.time.sim;
    sim.restore(
      snapshot,
      source.journal().entries.filter((entry) => entry.applyAt > snapshotMs),
    );
    while (sim.world.time.sim < fromMs) {
      sim.step();
      sim.drainEvents();
    }
    return ok({ sim, fromMs, untilMs });
  } catch (cause) {
    sim?.dispose();
    return fail('the sim refused or threw', cause);
  }
}
