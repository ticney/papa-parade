import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { replayJournal } from '@sim';
import { loadSimLevel, type SimLevel } from './loadSimLevel.ts';
import { parseRunFile, type RunFile } from './runFile.ts';

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');

/**
 * Replays a recorded game on the level it was recorded on, with strict invariants, and compares the
 * hash of the final world with the recorded one. A journal this build cannot replay (the feel, the
 * geometry or the level changed) and a different final state are both an `err` that says so.
 */
export async function replayRunFile(
  file: RunFile,
  loaded: SimLevel,
): Promise<Result<{ worldHash: string }, string>> {
  let replayed: Awaited<ReturnType<typeof replayJournal>>;
  try {
    replayed = await replayJournal({
      content: loaded.content,
      geometry: loaded.geometry,
      level: loaded.level,
      journal: file.journal,
      untilSimMs: file.untilSimMs,
      strictInvariants: true,
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
  if (worldHash !== file.worldHash) {
    return err(
      `the replay ends in another state: recorded world ${file.worldHash}, replayed world ${worldHash}`,
    );
  }
  return ok({ worldHash });
}

async function main(): Promise<void> {
  const fail = (message: string): void => {
    log.error('sim', message);
    process.exitCode = 1;
  };
  const path = process.argv[2];
  if (path === undefined || process.argv.length > 3) {
    return fail('usage: npm run sim:replay -- <recorded game file>');
  }
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
