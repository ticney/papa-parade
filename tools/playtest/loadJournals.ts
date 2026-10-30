import type { Dirent } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { JournalFile } from '@content/schemas/journal';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { parseJournalFile } from '../sim/replaySim.ts';
import { RUN_FILE_KIND } from '../sim/runFile.ts';
import { compareNames, TESTER_ID_PATTERN } from './testerId.ts';

/** One human game of a tester. `file` is `<testerId>/<name>.json`, for the messages. */
export interface TesterGame {
  file: string;
  journal: JournalFile;
}

export interface TesterGames {
  testerId: string;
  /** In file-name order; the computation orders them by session and index. */
  games: TesterGame[];
}

export interface SkippedFile {
  /** `<testerId>/<name>.json`. */
  file: string;
  reason: string;
}

export interface LoadedJournals {
  /** Testers with at least one usable game, sorted by id. */
  testers: TesterGames[];
  skipped: SkippedFile[];
  warnings: string[];
  /** The distinct level ids and content hashes of the games read, sorted: a mix shows here. */
  levels: string[];
  contentHashes: string[];
  /** Files that were parsed as a journal or looked at as one (usable or skipped). */
  filesRead: number;
}

const JSON_SUFFIX = '.json';

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

async function listDir(path: string): Promise<Result<Dirent[], string>> {
  try {
    const entries = await readdir(path, { withFileTypes: true });
    return ok(entries.sort((a, b) => compareNames(a.name, b.name)));
  } catch (cause) {
    return err(`cannot read the folder ${path}: ${reasonOf(cause)}`);
  }
}

type FileVerdict = { game: JournalFile } | { skip: string };

async function readJournal(path: string): Promise<FileVerdict> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (cause) {
    return { skip: `cannot be read: ${reasonOf(cause)}` };
  }
  let json: unknown;
  try {
    json = JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  } catch (cause) {
    return { skip: `not valid JSON: ${reasonOf(cause)}` };
  }
  if (
    typeof json === 'object' &&
    json !== null &&
    (json as { kind?: unknown }).kind === RUN_FILE_KIND
  ) {
    return { skip: 'a bot run file, not a playtest journal' };
  }
  const parsed = parseJournalFile(json);
  if (!parsed.ok) return { skip: parsed.error };
  const { autoplay } = parsed.value.summary;
  if (autoplay !== null) return { skip: `played by the ${autoplay} bot` };
  return { game: parsed.value };
}

/**
 * Reads `<dir>/<testerId>/*.json`: one folder per tester, one exported journal per file (story 3.3).
 * A file that is not a human game (invalid, a bot run, an autoplay game, a duplicate) is skipped and
 * listed; a layout that cannot be trusted (a journal outside a tester folder, a folder that is not a
 * tester id, one session under two testers, one game index twice in a session with two different
 * outcomes) is an input error. Every problem is returned, not only the first. Folders and files are
 * read in sorted order, so the result never depends on the file system.
 */
export async function loadJournals(dir: string): Promise<Result<LoadedJournals, string[]>> {
  const top = await listDir(dir);
  if (!top.ok) return err([top.error]);

  const errors: string[] = [];
  const warnings: string[] = [];
  const skipped: SkippedFile[] = [];
  const testers: TesterGames[] = [];
  let filesRead = 0;
  /** `sessionId` → the tester it was first seen under. */
  const sessionOwner = new Map<string, { testerId: string; file: string }>();

  for (const entry of top.value) {
    if (entry.name.startsWith('.')) continue;
    if (entry.isFile()) {
      if (entry.name.endsWith(JSON_SUFFIX)) {
        errors.push(
          `${entry.name}: a journal directly in ${dir}: put each tester's journals in a folder named after their testerId`,
        );
      }
      continue;
    }
    if (!entry.isDirectory()) continue;
    const testerId = entry.name;
    if (!TESTER_ID_PATTERN.test(testerId)) {
      errors.push(
        `${testerId}/: not a tester id (1-32 of A-Z a-z 0-9 _ -): rename the folder after the pseudonym of the tester`,
      );
      continue;
    }

    const inside = await listDir(join(dir, testerId));
    if (!inside.ok) {
      errors.push(inside.error);
      continue;
    }
    const games: TesterGame[] = [];
    /** `(sessionId, gameIndexInSession)` → the file that holds it and its world hash. */
    const seen = new Map<string, { file: string; worldHash: string }>();

    for (const file of inside.value) {
      if (file.name.startsWith('.')) continue;
      const label = `${testerId}/${file.name}`;
      if (file.isDirectory()) {
        warnings.push(`${label}/: a folder inside a tester folder is ignored`);
        continue;
      }
      if (!file.isFile() || !file.name.endsWith(JSON_SUFFIX)) continue;
      filesRead++;
      const verdict = await readJournal(join(dir, testerId, file.name));
      if ('skip' in verdict) {
        skipped.push({ file: label, reason: verdict.skip });
        warnings.push(`${label} skipped: ${verdict.skip}`);
        continue;
      }
      const journal = verdict.game;
      const { sessionId, gameIndexInSession } = journal.summary;
      const owner = sessionOwner.get(sessionId);
      if (owner !== undefined && owner.testerId !== testerId) {
        errors.push(
          `session ${sessionId} is in ${owner.file} and in ${label}: a page visit belongs to one tester`,
        );
        continue;
      }
      if (owner === undefined) sessionOwner.set(sessionId, { testerId, file: label });

      const key = `${sessionId}#${gameIndexInSession}`;
      const first = seen.get(key);
      if (first !== undefined) {
        if (first.worldHash === journal.replay.worldHash) {
          const reason = `the same game as ${first.file} (sent twice)`;
          skipped.push({ file: label, reason });
          warnings.push(`${label} skipped: ${reason}`);
        } else {
          errors.push(
            `${first.file} and ${label} are both game ${gameIndexInSession} of session ${sessionId} with different outcomes: two games cannot have one index in one session`,
          );
        }
        continue;
      }
      seen.set(key, { file: label, worldHash: journal.replay.worldHash });
      games.push({ file: label, journal });
    }

    if (games.length === 0) {
      warnings.push(`${testerId}/: no usable game`);
    } else {
      testers.push({ testerId, games });
    }
  }

  if (errors.length > 0) return err(errors);
  if (testers.length === 0) {
    return err([
      `${dir}: no tester has a usable game (expected ${dir}/<testerId>/*.json, journals exported from the Result screen of a playtest build)`,
    ]);
  }
  for (const warning of warnings) log.warn('playtest', warning);

  const levels = new Set<string>();
  const hashes = new Set<string>();
  for (const tester of testers) {
    for (const game of tester.games) {
      levels.add(game.journal.replay.levelId);
      hashes.add(game.journal.replay.contentHash);
    }
  }
  return ok({
    testers,
    skipped,
    warnings,
    levels: [...levels].sort(compareNames),
    contentHashes: [...hashes].sort(compareNames),
    filesRead,
  });
}
