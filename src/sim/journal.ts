import { STEP_MS, UINT32_RANGE } from '@shared/constants';
import type { SimMs } from '@shared/time';
import { commandProblem, type SimCommand } from './commands.ts';

/**
 * A command and the end time of the step that applies it. `applyAt` makes a replay independent of
 * when the live game happened to enqueue the command (a press can be enqueued after its `t`).
 */
export interface JournalEntry {
  applyAt: SimMs;
  command: SimCommand;
}

export interface Journal {
  /** 3 since story 1.10: the journal names the level (its planned threats) it was recorded on. */
  version: 3;
  seed: number;
  /** `hashJson` of the effective feel the game ran with. */
  feelHash: string;
  /** `hashJson` of the level geometry the game ran on (the room is part of what a replay needs). */
  geometryHash: string;
  /** `hashJson` of the level content (the planned threats and their defs) the game ran on. */
  levelHash: string;
  /**
   * Sim time the entries start from: 0 for a game recorded from its start, the snapshot time for a
   * sim that was restored (its journal then only holds the commands that came after).
   * `replayJournal` replays from the start and refuses a journal that does not start at 0.
   */
  startSimMs: number;
  entries: JournalEntry[];
}

export function createJournal(
  seed: number,
  feelHash: string,
  geometryHash: string,
  levelHash: string,
  startSimMs = 0,
): Journal {
  return { version: 3, seed, feelHash, geometryHash, levelHash, startSimMs, entries: [] };
}

/** `null` when an entry is well formed, else the reason. */
export function entryProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'an entry must be an object';
  const entry = value as Record<string, unknown>;
  if (typeof entry.applyAt !== 'number' || !Number.isFinite(entry.applyAt)) {
    return 'applyAt must be a finite number';
  }
  if (entry.applyAt % STEP_MS !== 0) return `applyAt ${entry.applyAt} is not on the step grid`;
  return commandProblem(entry.command);
}

/**
 * Runtime check of a journal that comes from outside the type system (a file, the clipboard):
 * `null` when it can be handed to `createSim`, else the first reason. It checks shapes, not
 * whether the journal matches a given content (that is the feel and geometry hashes).
 */
export function journalProblem(value: unknown): string | null {
  if (typeof value !== 'object' || value === null) return 'a journal must be an object';
  const journal = value as Record<string, unknown>;
  if (journal.version === 1) {
    return 'journal version 1 was recorded before the sim read the level geometry (story 1.7): record it again';
  }
  if (journal.version === 2) {
    return 'journal version 2 was recorded before the sim read the level (story 1.10): record it again';
  }
  if (journal.version !== 3) return `unsupported journal version ${String(journal.version)}`;
  const { seed } = journal;
  if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed >= UINT32_RANGE) {
    return `seed must be an integer in [0, 2**32), got ${String(seed)}`;
  }
  if (typeof journal.feelHash !== 'string') return 'feelHash must be a string';
  if (typeof journal.geometryHash !== 'string') return 'geometryHash must be a string';
  if (typeof journal.levelHash !== 'string') return 'levelHash must be a string';
  if (typeof journal.startSimMs !== 'number' || !Number.isFinite(journal.startSimMs)) {
    return 'startSimMs must be a finite number';
  }
  if (!Array.isArray(journal.entries)) return 'entries must be an array';
  for (let i = 0; i < journal.entries.length; i++) {
    const problem = entryProblem(journal.entries[i]);
    if (problem !== null) return `entries[${i}]: ${problem}`;
  }
  return null;
}
