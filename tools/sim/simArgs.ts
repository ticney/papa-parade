import { parseArgs } from 'node:util';
import { BOT_IDS, type BotId } from '@bots/bot';
import {
  DEFAULT_DIFFICULTY_TIER,
  DEFAULT_LEVEL_ID,
  DIFFICULTY_TIER_IDS,
  type DifficultyTierId,
  SIM_CLI_MAX_RUNS,
  SIM_CLI_MAX_UNTIL_MS,
  STEP_MS,
  UINT32_RANGE,
} from '@shared/constants';
import { err, ok, type Result } from '@shared/result';

/** When `--sequence` starts the sequence if `--sequence-at-ms` says nothing, in sim ms. */
export const DEFAULT_SEQUENCE_AT_MS = 1000;

export interface SimArgs {
  levelId: string;
  botId: BotId;
  /** The difficulty tier the games are played at; `normal` sends no command (story 2.8). */
  tier: DifficultyTierId;
  /** The seed of run 0; run `i` uses `(seed + i) % 2**32`. */
  seed: number;
  runs: number;
  /** A cap on the sim time of a game, rounded up to the step grid; `null` = the level's own duration. */
  untilSimMs: number | null;
  /** Where the report goes; `null` = stdout. */
  outPath: string | null;
  /** Where the recorded games go; `null` = nowhere. */
  journalsDir: string | null;
  /** The special sequence to start in every game (story 4.4); `null` = none. */
  sequenceId: string | null;
  /** When the sequence is started, in sim ms, rounded up to the step grid (default 1000). */
  sequenceAtMs: number;
  help: boolean;
}

export const SIM_HELP = `Usage: npm run sim -- --bot <id> [options]

  --level <id>       level to play (default ${DEFAULT_LEVEL_ID})
  --bot <id>         ${BOT_IDS.join(', ')} (required)
  --tier <id>        ${DIFFICULTY_TIER_IDS.join(', ')} (default ${DEFAULT_DIFFICULTY_TIER}); a SetDifficultyTier at t = 0 unless normal
  --seed <n>         seed of the first run, an integer in [0, 2**32) (default 1)
  --runs <n>         number of games, an integer in [1, ${SIM_CLI_MAX_RUNS}] (default 1); run i uses seed + i
  --until-ms <n>     cap the sim time of a game, in ms, rounded up to ${STEP_MS}, at most ${SIM_CLI_MAX_UNTIL_MS} (default: no cap, a game lasts the level's duration)
  --out <file>       write the JSON report there (default: stdout)
  --journals <dir>   write one recorded game per run there, for \`npm run sim:replay\`
  --sequence <id>    start this special sequence of the level in every game (story 4.4), by \`StartSequence\`
  --sequence-at-ms <n>  when to start it, in sim ms, rounded up to ${STEP_MS} (default ${DEFAULT_SEQUENCE_AT_MS}); needs --sequence
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
Fatherly Instinct (story 2.9) is counted per game and over the runs: \`instinctTriggers\`, the
\`InstinctTriggered\` events (a bot that misses a lot triggers it; \`perfect\` never does, and the
\`experienced\` tier has none).
The pressing need (story 4.3) is counted per game and over the runs: \`toiletVisits\` (the finished
visits; 0 for a bot, which never goes) and \`bladderPeakPct\`, the highest the need reached, in % to
one decimal (the highest of any game in the aggregate; 0 in a level with no \`gauges.need\`).
The special sequences (story 4.4) are counted per game and over the runs: \`sequencesStarted\`,
\`sequencesSucceeded\` and \`sequencesFailed\`. Nothing starts one in a normal game: \`--sequence\` does.
A start the sim refuses (Papa busy, a silence, a phone ringing) is sent once, not retried: the run logs a
warning and counts 0. A game cut by \`--until-ms\` in the middle of a sequence counts it as started only.
The lullaby walk (story 4.5) adds \`beatsHit\`, \`beatsMissed\`, \`decoysTapped\` and \`beatsStray\`: the judged
beats tapped in time, settled with no tap, the taps on a decoy, and the taps on nothing.
The bedtime duel (story 4.6) adds \`sequenceRetreats\`: the steps back its gags made (0 outside a duel). Its threat is not
counted in \`microSleeps\`.
\`snore\` is a source of the noise per source.
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
        tier: { type: 'string' },
        seed: { type: 'string' },
        runs: { type: 'string' },
        'until-ms': { type: 'string' },
        out: { type: 'string' },
        journals: { type: 'string' },
        sequence: { type: 'string' },
        'sequence-at-ms': { type: 'string' },
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

  const tierText = text('tier') ?? DEFAULT_DIFFICULTY_TIER;
  if (!(DIFFICULTY_TIER_IDS as readonly string[]).includes(tierText)) {
    return err(`unknown --tier "${tierText}": choose ${DIFFICULTY_TIER_IDS.join(', ')}`);
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

  const sequenceText = text('sequence');
  if (sequenceText === '') return err('--sequence needs a sequence id, got an empty string');
  const sequenceAt = integerOption(
    'sequence-at-ms',
    text('sequence-at-ms'),
    DEFAULT_SEQUENCE_AT_MS,
  );
  if (!sequenceAt.ok) return sequenceAt;
  if (sequenceAt.value > SIM_CLI_MAX_UNTIL_MS) {
    return err(`--sequence-at-ms must be at most ${SIM_CLI_MAX_UNTIL_MS}, got ${sequenceAt.value}`);
  }
  if (sequenceText === undefined && text('sequence-at-ms') !== undefined) {
    return err('--sequence-at-ms needs --sequence');
  }

  return ok({
    levelId: text('level') ?? DEFAULT_LEVEL_ID,
    botId: (botText ?? 'idle') as BotId,
    tier: tierText as DifficultyTierId,
    seed: seed.value,
    runs: runs.value,
    untilSimMs,
    outPath: outPath ?? null,
    journalsDir: journalsDir ?? null,
    sequenceId: sequenceText ?? null,
    sequenceAtMs: Math.ceil(sequenceAt.value / STEP_MS) * STEP_MS,
    help,
  });
}
