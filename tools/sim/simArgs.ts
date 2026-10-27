import { parseArgs } from 'node:util';
import { BOT_IDS, type BotId } from '@bots/bot';
import {
  DEFAULT_LEVEL_ID,
  SIM_CLI_DEFAULT_UNTIL_MS,
  STEP_MS,
  UINT32_RANGE,
} from '@shared/constants';
import { err, ok, type Result } from '@shared/result';

export interface SimArgs {
  levelId: string;
  botId: BotId;
  /** The seed of run 0; run `i` uses `(seed + i) % 2**32`. */
  seed: number;
  runs: number;
  /** Rounded up to the step grid. */
  untilSimMs: number;
  /** Where the report goes; `null` = stdout. */
  outPath: string | null;
  /** Where the recorded games go; `null` = nowhere. */
  journalsDir: string | null;
  help: boolean;
}

export const SIM_HELP = `Usage: npm run sim -- --bot <id> [options]

  --level <id>       level to play (default ${DEFAULT_LEVEL_ID})
  --bot <id>         ${BOT_IDS.join(', ')} (required)
  --seed <n>         seed of the first run, an integer in [0, 2**32) (default 1)
  --runs <n>         number of games, an integer >= 1 (default 1); run i uses seed + i
  --until-ms <n>     sim time of a game, in ms, rounded up to ${STEP_MS} (default ${SIM_CLI_DEFAULT_UNTIL_MS})
  --out <file>       write the JSON report there (default: stdout)
  --journals <dir>   write one recorded game per run there, for \`npm run sim:replay\`
  --help             print this
`;

const DIGITS = /^\d+$/;
const DECIMAL = /^\d+(\.\d+)?$/;

function integerOption(
  name: string,
  text: string | undefined,
  fallback: number,
): Result<number, string> {
  if (text === undefined) return ok(fallback);
  if (!DIGITS.test(text) || !Number.isSafeInteger(Number(text))) {
    return err(`--${name} must be a whole number, got "${text}"`);
  }
  return ok(Number(text));
}

/** Parses the command line. Pure: nothing is read from disk or from the environment. */
export function parseSimArgs(argv: readonly string[]): Result<SimArgs, string> {
  let values: ReturnType<typeof parseArgs>['values'];
  try {
    values = parseArgs({
      args: [...argv],
      strict: true,
      allowPositionals: false,
      options: {
        level: { type: 'string' },
        bot: { type: 'string' },
        seed: { type: 'string' },
        runs: { type: 'string' },
        'until-ms': { type: 'string' },
        out: { type: 'string' },
        journals: { type: 'string' },
        help: { type: 'boolean' },
      },
    }).values;
  } catch (cause) {
    // Node's own message names the offending flag; it becomes the error of the Result.
    return err(`${cause instanceof Error ? cause.message : String(cause)} (see --help)`);
  }

  const text = (name: string): string | undefined => {
    const value = values[name];
    return typeof value === 'string' ? value : undefined;
  };

  const help = values.help === true;
  const botText = text('bot');
  if (!help && botText === undefined) {
    return err(`--bot is required: choose ${BOT_IDS.join(', ')}`);
  }
  if (botText !== undefined && !(BOT_IDS as readonly string[]).includes(botText)) {
    return err(`unknown bot "${botText}": choose ${BOT_IDS.join(', ')}`);
  }

  const seed = integerOption('seed', text('seed'), 1);
  if (!seed.ok) return seed;
  if (seed.value >= UINT32_RANGE) return err(`--seed must be below 2**32, got ${seed.value}`);
  const runs = integerOption('runs', text('runs'), 1);
  if (!runs.ok) return runs;
  if (runs.value < 1) return err(`--runs must be at least 1, got ${runs.value}`);

  let untilSimMs = SIM_CLI_DEFAULT_UNTIL_MS;
  const untilText = text('until-ms');
  if (untilText !== undefined) {
    const parsed = DECIMAL.test(untilText) ? Number(untilText) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return err(`--until-ms must be a number above 0, got "${untilText}"`);
    }
    untilSimMs = Math.ceil(parsed / STEP_MS) * STEP_MS;
  }

  return ok({
    levelId: text('level') ?? DEFAULT_LEVEL_ID,
    botId: (botText ?? 'idle') as BotId,
    seed: seed.value,
    runs: runs.value,
    untilSimMs,
    outPath: text('out') ?? null,
    journalsDir: text('journals') ?? null,
    help,
  });
}
