import { parseArgs } from 'node:util';
import { BOT_IDS, type BotId } from '@bots/bot';
import {
  DEFAULT_LEVEL_ID,
  SIM_CLI_MAX_RUNS,
  SIM_CLI_MAX_UNTIL_MS,
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
  /** A cap on the sim time of a game, rounded up to the step grid; `null` = the level's own duration. */
  untilSimMs: number | null;
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
  --runs <n>         number of games, an integer in [1, ${SIM_CLI_MAX_RUNS}] (default 1); run i uses seed + i
  --until-ms <n>     cap the sim time of a game, in ms, rounded up to ${STEP_MS}, at most ${SIM_CLI_MAX_UNTIL_MS} (default: no cap, a game lasts the level's duration)
  --out <file>       write the JSON report there (default: stdout)
  --journals <dir>   write one recorded game per run there, for \`npm run sim:replay\`
  --help             print this

The report also holds the noise gauge of the level (story 3.1): the mean and max of each game's peak,
the mean final value and the noise per source, all in % of the gauge (0 in a level with no noise).
It also tells how the games ended (story 3.2): \`endsByReason\` counts the ended runs per reason
(\`timer\`, \`mamaWoke\`), \`mamaWokeMeanAtMs\` is the mean sim time Mama woke at, and each run has its
\`endReason\` and \`lostStars\`.
Carrying (story 4.1) is counted over the runs: \`babyPickUps\`, \`babyPutDowns\`, \`safePutDowns\`,
\`armsCries\` (the cries in the arms) and \`cancelledThreats\` (threats dropped when Papa took the
baby). The bots never carry, so they are 0 for a bot.
The combo (story 4.2) is counted per game and over the runs: \`comboCashIns\` and \`comboPointsCashed\`
(0 for a bot, which never puts the baby down), and \`comboPeakMultiplier\`, the highest multiplier a
game reached (the highest of any game in the aggregate; 0 in a level with no \`carry\`).
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
  if (runs.value < 1 || runs.value > SIM_CLI_MAX_RUNS) {
    return err(`--runs must be between 1 and ${SIM_CLI_MAX_RUNS}, got ${runs.value}`);
  }

  let untilSimMs: number | null = null;
  const untilText = text('until-ms');
  if (untilText !== undefined) {
    const parsed = DECIMAL.test(untilText) ? Number(untilText) : Number.NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return err(`--until-ms must be a number above 0, got "${untilText}"`);
    }
    if (parsed > SIM_CLI_MAX_UNTIL_MS) {
      return err(`--until-ms must be at most ${SIM_CLI_MAX_UNTIL_MS}, got "${untilText}"`);
    }
    untilSimMs = Math.ceil(parsed / STEP_MS) * STEP_MS;
  }

  const outPath = text('out');
  if (outPath === '') return err('--out needs a file path, got an empty string');
  const journalsDir = text('journals');
  if (journalsDir === '') return err('--journals needs a folder path, got an empty string');

  return ok({
    levelId: text('level') ?? DEFAULT_LEVEL_ID,
    botId: (botText ?? 'idle') as BotId,
    seed: seed.value,
    runs: runs.value,
    untilSimMs,
    outPath: outPath ?? null,
    journalsDir: journalsDir ?? null,
    help,
  });
}
