import { mkdir, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { BotResponse, BotSetup } from '@bots/bot';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { UINT32_RANGE } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { createSim } from '@sim';
import { loadSimLevel, type SimLevel } from './loadSimLevel.ts';
import { type RunFile, runFileName, toRunFile } from './runFile.ts';
import { parseSimArgs, SIM_HELP, type SimArgs } from './simArgs.ts';
import {
  createRunRecorder,
  type RunSummary,
  renderReport,
  type SimReport,
  summarizeRuns,
} from './simReport.ts';

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'content');
const PROGRESS_STEPS = 10;

export interface RunSimHooks {
  /** Called after each run with its recorded game (a copy of the journal: only asked for when `journalsDir` is set). */
  onGame?: (name: string, game: RunFile) => void;
  /** Called after each run. */
  onProgress?: (done: number, total: number) => void;
}

/** What every threat def of the level asks for: a bot is only told about the defs it can answer. */
function responsesOf(loaded: SimLevel): Record<string, BotResponse> {
  const responses: Record<string, BotResponse> = {};
  for (const [defId, def] of Object.entries(loaded.level.threats)) responses[defId] = def.response;
  return responses;
}

/**
 * Plays `args.runs` headless games of `args.botId` on a loaded level and folds them into a report.
 * Run `i` uses seed `(args.seed + i) % 2**32` and a fresh sim and bot. Everything runs with strict
 * invariants: a violation stops the batch with an `err` that names the seed. No I/O, no clock: the
 * same arguments give the same report.
 */
export async function runSim(
  args: SimArgs,
  loaded: SimLevel,
  hooks: RunSimHooks = {},
): Promise<Result<SimReport, string>> {
  const { content, geometry, level } = loaded;
  const responses = responsesOf(loaded);
  const summaries: RunSummary[] = [];
  for (let index = 0; index < args.runs; index++) {
    const seed = (args.seed + index) % UINT32_RANGE;
    const setup: BotSetup = {
      seed,
      holdMinMs: content.feel.input.holdMinMs,
      responses,
      settings: content.bots,
    };
    const bot = createBot(args.botId, setup);
    if (!bot.ok) return err(bot.error.message);
    try {
      const sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
      const recorder = createRunRecorder(sim, seed);
      playGame(sim, bot.value, args.untilSimMs, recorder.onEvent);
      const summary = recorder.finish();
      summaries.push(summary);
      if (hooks.onGame !== undefined) {
        hooks.onGame(
          runFileName(loaded.levelId, args.botId, seed),
          toRunFile({
            levelId: loaded.levelId,
            bot: args.botId,
            untilSimMs: args.untilSimMs,
            worldHash: summary.worldHash,
            journal: sim.journal(),
          }),
        );
      }
    } catch (cause) {
      return err(
        `run ${index + 1} of ${args.runs} (seed ${seed}) crashed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    }
    hooks.onProgress?.(index + 1, args.runs);
  }
  return ok(
    summarizeRuns(
      {
        level: loaded.levelId,
        bot: args.botId,
        seed: args.seed,
        untilSimMs: args.untilSimMs,
        hashes: {
          feel: hashJson(content.feel),
          geometry: hashJson(geometry),
          level: hashJson(level),
          bots: hashJson(content.bots),
        },
      },
      summaries,
    ),
  );
}

async function writeText(path: string, text: string): Promise<Result<null, string>> {
  try {
    await writeFile(path, text);
    return ok(null);
  } catch (cause) {
    return err(`cannot write ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

async function main(): Promise<void> {
  const fail = (message: string): void => {
    log.error('sim', message);
    process.exitCode = 1;
  };
  const parsed = parseSimArgs(process.argv.slice(2));
  if (!parsed.ok) return fail(parsed.error);
  const args = parsed.value;
  if (args.help) {
    process.stdout.write(SIM_HELP);
    return;
  }

  if (args.outPath !== null) {
    const parent = dirname(args.outPath);
    const info = await stat(parent).catch(() => null);
    if (info === null || !info.isDirectory()) {
      return fail(`--out: the folder ${parent} does not exist`);
    }
  }
  const loaded = await loadSimLevel(CONTENT_DIR, args.levelId);
  if (!loaded.ok) return fail(loaded.error);

  const games: [string, RunFile][] = [];
  const quiet = args.outPath === null; // stdout carries the report: nothing else at `info`
  let lastLoggedStep = 0;
  const startedAtReal = performance.now();
  const result = await runSim(args, loaded.value, {
    onGame: args.journalsDir === null ? undefined : (name, game) => games.push([name, game]),
    onProgress: quiet
      ? undefined
      : (done, total) => {
          const step = Math.floor((done * PROGRESS_STEPS) / total);
          if (step > lastLoggedStep) {
            lastLoggedStep = step;
            log.info('sim', `${done}/${total} runs`);
          }
        },
  });
  if (!result.ok) return fail(result.error);
  const report = result.value;

  if (args.journalsDir !== null) {
    await mkdir(args.journalsDir, { recursive: true });
    for (const [name, game] of games) {
      const written = await writeText(join(args.journalsDir, name), `${JSON.stringify(game)}\n`);
      if (!written.ok) return fail(written.error);
    }
  }
  const text = renderReport(report);
  if (args.outPath === null) {
    process.stdout.write(text);
    return;
  }
  const written = await writeText(args.outPath, text);
  if (!written.ok) return fail(written.error);
  log.info('sim', 'done', {
    level: report.level,
    bot: report.bot,
    runs: report.runs,
    meanSuccessPct: report.meanSuccessPct,
    gags: report.gags.total,
    wallMs: Math.round(performance.now() - startedAtReal),
    out: args.outPath,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
