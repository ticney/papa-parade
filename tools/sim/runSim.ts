import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Bot, BotSetup } from '@bots/bot';
import { botResponsesOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { UINT32_RANGE } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { asSimMs } from '@shared/time';
import { createSim, type Sim } from '@sim';
import { outProblem, writeText } from '../outputFile.ts';
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

/**
 * Wraps `bot` so that the same `StartSequence` is enqueued, once, at the first step at or after
 * `atMs` (story 4.4): journaled like any command, so `sim:replay` agrees. Sent first, so that a
 * command of the bot in the same step meets the sequence already running.
 */
export function withSequenceStart(bot: Bot, sequenceId: string, atMs: number): Bot {
  let isSent = false;
  return {
    id: bot.id,
    act(world, out) {
      if (!isSent && world.time.sim >= atMs) {
        isSent = true;
        out.push({ type: 'StartSequence', t: asSimMs(world.time.sim), sequenceId });
      }
      bot.act(world, out);
    },
  };
}

export interface RunSimHooks {
  /** Called after each run with its recorded game (a copy of the journal: only asked for when `journalsDir` is set). */
  onGame?: (name: string, game: RunFile) => void;
  /** Called after each run. */
  onProgress?: (done: number, total: number) => void;
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
  const responses = botResponsesOf(level.threats);
  // A game lasts the level's duration unless a cap says less (or more: the flow ends it anyway).
  const untilSimMs = args.untilSimMs ?? level.level.durationMs;
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
    let game: RunFile | null = null;
    let sim: Sim | null = null;
    try {
      sim = await createSim({ content, geometry, level, seed, strictInvariants: true });
      // The way the client sends it (story 2.8): nothing at `normal`, so a journal stays as before.
      if (args.tier !== 'normal') {
        sim.enqueue({ type: 'SetDifficultyTier', t: asSimMs(0), tier: args.tier });
      }
      const recorder = createRunRecorder(
        sim,
        seed,
        level.level.waves,
        level.level.carry?.armsCryDef ?? null,
      );
      const player =
        args.sequenceId === null
          ? bot.value
          : withSequenceStart(bot.value, args.sequenceId, args.sequenceAtMs);
      playGame(sim, player, untilSimMs, recorder.onEvent);
      const summary = recorder.finish();
      summaries.push(summary);
      game = toRunFile({
        levelId: loaded.levelId,
        bot: args.botId,
        tier: args.tier,
        // Where the game really stopped (the level may have ended before the cap), so that a
        // replay to this time ends in the same world.
        untilSimMs: sim.world.time.sim,
        worldHash: summary.worldHash,
        journal: sim.journal(),
      });
    } catch (cause) {
      return err(
        `run ${index + 1} of ${args.runs} (seed ${seed}) crashed: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      // 10 000 runs must not leak 10 000 WASM worlds, a crashed run included.
      sim?.dispose();
    }
    // Outside the `try`: a bug in the hook is not a crash of the sim.
    if (hooks.onGame !== undefined && game !== null) {
      hooks.onGame(runFileName(loaded.levelId, args.botId, seed, args.tier), game);
    }
    hooks.onProgress?.(index + 1, args.runs);
  }
  return ok(
    summarizeRuns(
      {
        level: loaded.levelId,
        bot: args.botId,
        tier: args.tier,
        seed: args.seed,
        untilSimMs,
        waves: level.level.waves,
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

async function makeDir(path: string): Promise<Result<null, string>> {
  try {
    await mkdir(path, { recursive: true });
    return ok(null);
  } catch (cause) {
    return err(`cannot create ${path}: ${cause instanceof Error ? cause.message : String(cause)}`);
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
    const problem = await outProblem(args.outPath);
    if (problem !== null) return fail(`--out: ${problem}`);
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
    const made = await makeDir(args.journalsDir);
    if (!made.ok) return fail(made.error);
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
