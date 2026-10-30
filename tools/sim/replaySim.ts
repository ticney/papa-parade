import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { formatContentProblem } from '@content/contentError';
import { mergeFeel } from '@content/feelMerge';
import type { Feel } from '@content/schemas/feel';
import { JOURNAL_FILE_KIND, type JournalFile, JournalSchema } from '@content/schemas/journal';
import {
  DEFAULT_DIFFICULTY_TIER,
  type DifficultyTierId,
  SIM_CLI_MAX_UNTIL_MS,
} from '@shared/constants';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { type Journal, replayJournal } from '@sim';
import { loadSimLevel, type SimLevel } from './loadSimLevel.ts';
import { parseRunFile, RUN_FILE_KIND, type RunFile, toRunFile } from './runFile.ts';

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');

/**
 * Checks each `SetFeel` of a journal with `FeelSchema`, in order, laid over the level's feel (what
 * `SetFeel` does in the sim), which the sim itself cannot do (ranges and cross-field rules are the
 * sender's job, story 2.1). The first invalid patch is an `err` that names its entry and the paths.
 */
export function checkFeelPatches(
  journal: RunFile['journal'],
  levelFeel: Feel,
): Result<null, string> {
  const entries: unknown = journal.entries;
  if (!Array.isArray(entries)) return ok(null);
  let feel = levelFeel;
  for (let index = 0; index < entries.length; index++) {
    const command = (entries[index] as { command?: { type?: unknown; patch?: unknown } } | null)
      ?.command;
    if (command?.type !== 'SetFeel') continue;
    const merged = mergeFeel(feel, command.patch, `journal entry ${index} › SetFeel`);
    if (!merged.ok) {
      return err(
        `the journal has an invalid SetFeel: ${merged.error.problems.map(formatContentProblem).join('; ')}; refusing to replay it`,
      );
    }
    feel = merged.value;
  }
  return ok(null);
}

export interface ReplayRunFileOptions {
  /**
   * The invariant mode to replay in. Default `true`: a game the CLI recorded was played strict. A
   * journal exported from a playtest build was played with clamping (`false`), and replaying it
   * strict would throw where the game went on (story 3.3 D3).
   */
  strictInvariants?: boolean;
}

/**
 * Replays a recorded game on the level it was recorded on, with strict invariants unless told
 * otherwise, and compares the hash of the final world with the recorded one. A journal this build
 * cannot replay (the feel, the geometry or the level changed) and a different final state are both
 * an `err` that says so.
 */
export async function replayRunFile(
  file: RunFile,
  loaded: SimLevel,
  options: ReplayRunFileOptions = {},
): Promise<Result<{ worldHash: string }, string>> {
  const patches = checkFeelPatches(file.journal, loaded.content.feel);
  if (!patches.ok) return err(patches.error);
  let replayed: Awaited<ReturnType<typeof replayJournal>>;
  try {
    replayed = await replayJournal({
      content: loaded.content,
      geometry: loaded.geometry,
      level: loaded.level,
      journal: file.journal,
      untilSimMs: file.untilSimMs,
      strictInvariants: options.strictInvariants ?? true,
    });
  } catch (cause) {
    return err(
      `the replay crashed: ${cause instanceof Error ? cause.message : String(cause)} (was the content changed since it was recorded?)`,
    );
  }
  if (!replayed.ok) {
    return err(
      `cannot replay this game: ${replayed.error.message} (was the content changed since it was recorded?)`,
    );
  }
  const worldHash = hashJson(replayed.value.sim.world);
  replayed.value.sim.dispose();
  if (worldHash !== file.worldHash) {
    return err(
      `the replay ends in another state: recorded world ${file.worldHash}, replayed world ${worldHash}`,
    );
  }
  return ok({ worldHash });
}

/** Checks a parsed file against `JournalSchema` (story 3.3); a failure names every path. */
export function parseJournalFile(json: unknown): Result<JournalFile, string> {
  const parsed = JournalSchema.safeParse(json);
  if (parsed.success) return ok(parsed.data);
  const problems = parsed.error.issues.map(
    (issue) => `${issue.path.length === 0 ? '(file)' : issue.path.join('.')}: ${issue.message}`,
  );
  return err(`not a valid exported journal:\n  ${problems.join('\n  ')}`);
}

/**
 * An exported journal on the existing replay path: the level, how far to play, the hash to meet and
 * the sim's journal are all it needs. `bot` is the autoplay bot, or `player` for a human game.
 */
export function journalFileToRunFile(file: JournalFile): RunFile {
  const journal = file.replay.journal as Journal;
  return toRunFile({
    levelId: file.replay.levelId,
    bot: file.summary.autoplay ?? 'player',
    tier: tierOfJournal(journal),
    untilSimMs: file.replay.endSimMs,
    worldHash: file.replay.worldHash,
    // The envelope was checked by the schema; `replayJournal` checks the commands deeply.
    journal,
  });
}

/** The tier a journal was played at: its last `SetDifficultyTier`, else the default (story 2.8). */
function tierOfJournal(journal: Journal): DifficultyTierId {
  let tier: DifficultyTierId = DEFAULT_DIFFICULTY_TIER;
  for (const entry of journal.entries) {
    if (entry.command.type === 'SetDifficultyTier') tier = entry.command.tier;
  }
  return tier;
}

/**
 * Replays a journal exported from the Result screen of a playtest build, in the invariant mode it
 * was played in, and compares the final world with the recorded one. A content hash that differs
 * from this checkout's is a `warn`, never a failure: strings and cues do not change the sim, and the
 * sim's own three hashes (feel, geometry, level) are the gate inside `replayJournal`.
 */
export async function replayJournalFile(
  file: JournalFile,
  loaded: SimLevel,
): Promise<Result<{ worldHash: string; hasSameContent: boolean }, string>> {
  if (file.replay.levelId !== loaded.levelId) {
    return err(`the journal was played on level "${file.replay.levelId}", not "${loaded.levelId}"`);
  }
  if (file.replay.endSimMs > SIM_CLI_MAX_UNTIL_MS) {
    return err(
      `invalid journal: replay.endSimMs ${file.replay.endSimMs} is above the ${SIM_CLI_MAX_UNTIL_MS} ms a replay accepts`,
    );
  }
  const hasSameContent = file.replay.contentHash === loaded.contentHash;
  if (!hasSameContent) {
    log.warn(
      'sim',
      `the content of this checkout (${loaded.contentHash}) is not the content the journal was played on (${file.replay.contentHash}): strings, cues or bots may differ; the replay goes on`,
    );
  }
  const replay = await replayRunFile(journalFileToRunFile(file), loaded, {
    strictInvariants: file.replay.strictInvariants,
  });
  if (!replay.ok) return replay;
  return ok({ worldHash: replay.value.worldHash, hasSameContent });
}

const USAGE = 'usage: npm run sim:replay -- <recorded game file>';

const HELP = `Usage: npm run sim:replay -- <recorded game file>

Replays a game and checks that it ends in the same state. The file is either:
  ${RUN_FILE_KIND}      a game \`npm run sim --journals\` recorded (replayed with strict invariants)
  ${JOURNAL_FILE_KIND}  a journal a tester exported from the Result screen of a playtest build
                          (replayed in the invariant mode it was played in)
`;

async function main(): Promise<void> {
  const fail = (message: string): void => {
    log.error('sim', message);
    process.exitCode = 1;
  };
  const path = process.argv[2];
  if (path === '--help' || path === '-h') {
    process.stdout.write(HELP);
    return;
  }
  if (path === undefined || process.argv.length > 3) return fail(USAGE);
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return fail(`cannot read ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    return fail(`${path} is not JSON: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const kind = typeof json === 'object' && json !== null ? (json as { kind?: unknown }).kind : null;
  if (kind === JOURNAL_FILE_KIND) {
    const journal = parseJournalFile(json);
    if (!journal.ok) return fail(`${path}: ${journal.error}`);
    const loadedLevel = await loadSimLevel(CONTENT_DIR, journal.value.replay.levelId);
    if (!loadedLevel.ok) return fail(loadedLevel.error);
    const played = await replayJournalFile(journal.value, loadedLevel.value);
    if (!played.ok) return fail(played.error);
    log.info('sim', 'replay matches', { worldHash: played.value.worldHash });
    return;
  }
  if (kind !== null && kind !== undefined && kind !== RUN_FILE_KIND) {
    return fail(
      `${path}: not a recorded game: "kind" must be "${RUN_FILE_KIND}" or "${JOURNAL_FILE_KIND}"`,
    );
  }
  const file = parseRunFile(json);
  if (!file.ok) return fail(`${path}: ${file.error}`);
  const loaded = await loadSimLevel(CONTENT_DIR, file.value.levelId);
  if (!loaded.ok) return fail(loaded.error);
  const replay = await replayRunFile(file.value, loaded.value);
  if (!replay.ok) return fail(replay.error);
  log.info('sim', 'replay matches', { worldHash: replay.value.worldHash });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
