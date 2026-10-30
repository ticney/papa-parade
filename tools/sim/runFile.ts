import {
  DEFAULT_DIFFICULTY_TIER,
  DIFFICULTY_TIER_IDS,
  type DifficultyTierId,
  SIM_CLI_MAX_UNTIL_MS,
} from '@shared/constants';
import { err, ok, type Result } from '@shared/result';
import type { Journal } from '@sim';

export const RUN_FILE_KIND = 'papa-parade.run';
export const RUN_FILE_VERSION = 1;

/**
 * A recorded game, as `npm run sim --journals` writes it and `npm run sim:replay` reads it: the
 * journal, plus what a replay needs and the journal does not carry (the level, how far to play and
 * the hash of the final world to compare with).
 */
export interface RunFile {
  kind: typeof RUN_FILE_KIND;
  version: typeof RUN_FILE_VERSION;
  levelId: string;
  bot: string;
  /** The tier it was played at (story 2.8); informational, the journal holds the command. */
  tier: DifficultyTierId;
  untilSimMs: number;
  worldHash: string;
  journal: Journal;
}

export function toRunFile(fields: Omit<RunFile, 'kind' | 'version'>): RunFile {
  return { kind: RUN_FILE_KIND, version: RUN_FILE_VERSION, ...fields };
}

/**
 * The file name of the recorded game of one run. A tier other than the default is in the name
 * (story 2.8), so that the same seed played at two tiers into one folder does not overwrite itself.
 */
export function runFileName(
  levelId: string,
  bot: string,
  seed: number,
  tier: DifficultyTierId = DEFAULT_DIFFICULTY_TIER,
): string {
  const tierPart = tier === DEFAULT_DIFFICULTY_TIER ? '' : `_${tier}`;
  return `${levelId}_${bot}_${seed}${tierPart}.journal.json`;
}

/**
 * Checks the shape of a parsed file. The journal itself is not re-checked here: `replayJournal`
 * does, and gives the feel, geometry and level messages.
 */
export function parseRunFile(json: unknown): Result<RunFile, string> {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    return err('not a recorded game: the file must hold a JSON object');
  }
  const file = json as Record<string, unknown>;
  if (file.kind !== RUN_FILE_KIND) {
    return err(`not a recorded game: "kind" must be "${RUN_FILE_KIND}"`);
  }
  if (file.version !== RUN_FILE_VERSION) {
    return err(
      `unsupported recorded game version ${String(file.version)} (this build reads version ${RUN_FILE_VERSION})`,
    );
  }
  for (const key of ['levelId', 'bot', 'worldHash'] as const) {
    if (typeof file[key] !== 'string' || file[key] === '') {
      return err(`invalid recorded game: "${key}" must be a non-empty string`);
    }
  }
  // Files written before story 2.8 have no tier: they were played at the default one.
  const tier = file.tier ?? DEFAULT_DIFFICULTY_TIER;
  if (typeof tier !== 'string' || !(DIFFICULTY_TIER_IDS as readonly string[]).includes(tier)) {
    return err(`invalid recorded game: "tier" must be one of ${DIFFICULTY_TIER_IDS.join(', ')}`);
  }
  const { untilSimMs } = file;
  if (
    typeof untilSimMs !== 'number' ||
    !Number.isFinite(untilSimMs) ||
    untilSimMs <= 0 ||
    untilSimMs > SIM_CLI_MAX_UNTIL_MS
  ) {
    return err(
      `invalid recorded game: "untilSimMs" must be a number in (0, ${SIM_CLI_MAX_UNTIL_MS}]`,
    );
  }
  const { journal } = file;
  if (typeof journal !== 'object' || journal === null || Array.isArray(journal)) {
    return err('invalid recorded game: "journal" must be an object');
  }
  const { version, entries } = journal as Record<string, unknown>;
  if (typeof version !== 'number' || !Array.isArray(entries)) {
    return err('invalid recorded game: "journal" needs a numeric "version" and an "entries" array');
  }
  return ok({
    kind: RUN_FILE_KIND,
    version: RUN_FILE_VERSION,
    levelId: file.levelId as string,
    bot: file.bot as string,
    tier: tier as DifficultyTierId,
    untilSimMs,
    worldHash: file.worldHash as string,
    journal: file.journal as Journal,
  });
}
