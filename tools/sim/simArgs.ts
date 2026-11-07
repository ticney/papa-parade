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

export const CHRONO_RING_MODES = ['on', 'off'] as const;
export type ChronoRingMode = (typeof CHRONO_RING_MODES)[number];

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
  /**
   * Whether the `human` bot is shown the chrono-ring (story 3.14): `on` (the game as it is) or `off` (the conditions
   * of the 2026-11-03 playtest). The other bots ignore it.
   */
  chronoRing: ChronoRingMode;
  /** The playtest folder (`<dir>/<testerId>/*.json`) the report compares the bot with (story 3.14); `null` = none. */
  compareDir: string | null;
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
  --chrono-ring <m>  ${CHRONO_RING_MODES.join(', ')} (default on): whether the human bot is shown the chrono-ring; off replays the conditions of 2026-11-03
  --compare <dir>    compare the bot with the testers' journals in <dir>/<testerId>/*.json (the \`comparison\` block of the report)
  --sequence <id>    start this special sequence of the level in every game (story 4.4), by \`StartSequence\`
  --sequence-at-ms <n>  when to start it, in sim ms, rounded up to ${STEP_MS} (default ${DEFAULT_SEQUENCE_AT_MS}); needs --sequence
  --help             print this

The report also holds the noise gauge of the level (story 3.1): the mean and max of each game's peak,
the mean final value and the noise per source, all in % of the gauge (0 in a level with no noise).
It also tells how the games ended (story 3.2): \`endsByReason\` counts the ended runs per reason
(\`timer\`, \`mamaWoke\`, \`cycleDone\`, \`mamaHome\`), \`mamaWokeMeanAtMs\` is the mean sim time Mama woke at, and each run has its
\`endReason\` and \`lostStars\`. The catastrophe gauge (story 3.16) adds \`mamaHome\` (Mama came home early:
the only « lost level »), \`mamaHomeMeanAtMs\` (the mean sim time of that end), \`meanCatastrophePeakPct\` (the mean
of the highest value each game's gauge reached), and per run \`mamaHomeAtMs\` and \`catastrophePeakPct\`.
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
The human bot's realism (story 3.14): the report holds \`chronoRing\` (\`on\` or \`off\`, what the bot was shown), \`perfectPct\`
(the share of perfect responses of every run, in % to one decimal; null when there is none) and each run's own. With \`--compare\` it
also holds a \`comparison\` block (null otherwise): the testers' games kept and skipped, the median stars, score and perfect rate
of the testers, the bot's, the gaps, and an OK / KO / n/a status for each indicator (the thresholds are \`content/playtest.json\`
\`humanBot\`). A KO is not an error: the exit code stays 0.
The special sequences (story 4.4) are counted per game and over the runs: \`sequencesStarted\`,
\`sequencesSucceeded\` and \`sequencesFailed\`. Nothing starts one in a normal game: \`--sequence\` does.
A start the sim refuses (Papa busy, a silence, a phone ringing) is sent once, not retried: the run logs a
warning and counts 0. A game cut by \`--until-ms\` in the middle of a sequence counts it as started only.
The lullaby walk (story 4.5) adds \`beatsHit\`, \`beatsMissed\`, \`decoysTapped\` and \`beatsStray\`: the judged
beats tapped in time, settled with no tap, the taps on a decoy, and the taps on nothing.
The bedtime duel (story 4.6) adds \`sequenceRetreats\`: the steps back its gags made (0 outside a duel). Its threat is not
counted in \`microSleeps\`.
The stealth exit (story 4.9) adds \`floorCreaks\` (the boards that creaked under Papa), \`breathGasps\` (the breaths let
out loudly, by reason: \`empty\`, \`early\`, \`notHeld\`) and \`nothingResponses\` (the false alarms sat through or touched).
Its two alerts are not counted in \`microSleeps\`. \`snore\`, \`floorCreak\` and \`breathReleased\` are sources of the noise per source.
The final rush (story 3.5) adds \`finalRushes\` (the doors that opened: 0 in a level without one) and \`propsTidied\` (the props put back
in the rush), per game and over the runs. A game that ends on \`timer\` in a level with a rush ends on the photo, not on \`ended\`.
The end photo (story 3.6) adds \`frozenNearMisses\` (the baby, not carried, within \`feel.endOfLevel.frozenNearMissReachM\` of
the stairs when the level ends: one for each, counted in Mama's « Hurlement » and kept apart from \`nearMisses\`), per game and
over the runs.
The house chores (story 9.4, FR76) add a \`chores\` block, over the runs: \`runsCompleted\` (the games where a chore was finished),
\`beats\` (the beats judged, by quality: \`perfect\`, \`success\`, \`fail\` for a missed one), \`meanHomePoints\` (the Maison points the chores
paid per game), \`meanBeatsPerRun\` and \`abandoned\` (story 9.5: the pots of the chores left alone, \`telegraphed\`, \`resolved\` when
lowered in time and \`boiledOver\`); all 0 in a level with no station. The bots do chores when \`bots.json\` › \`chores.isEnabled\` is on.
The dishwasher (story 9.6, FR76 / FR78) adds to \`chores\`: \`byDef\` (for each chore def of the level, \`runsCompleted\`, its \`beats\` by quality and
\`meanBeatsMissed\` per game), \`meanObjectsBroken\` (the plates the missed beats broke per game, each one a broken object for Mama's Soupir) and
\`open\` (the open-door threats of the chores: \`telegraphed\`, \`closed\` when shut in time and \`gagged\` when the baby got in).
The director's fairness (story 3.13, FR75) adds \`fairnessViolations\` (the director-drawn windows that opened closer than
\`movement.glideMaxMs + director.fairnessMarginMs\` to a window announced before them, inside a found silence's guard, or that were
drawn while a silence was under way: 0 when the director is right, checked on the events alone), \`stretchedTelegraphs\` (the
threats whose window opened later than their telegraph delay: how often the director waits) and \`meanStretchMs\` (how much
later, on average; null when none). The waves' \`peakSimultaneous\` and \`overLimitRuns\` count a silence for two.
What the human bot sees (story 9.8): in a level with a follow camera it only reacts to a threat once it is in the frame it rebuilds from
Papa's position and \`feel.camera\` on the screen of \`bots.json\` › \`human.view\`, or has an off-screen bubble (at most three, the most
urgent). The report then holds a \`visibility\` block (null for the other bots and in a fixed-camera level): \`telegraphs\` (the threats
telegraphed), \`seenOffscreen\` (first seen through a bubble), \`cappedMs\` (the time threats waited for a bubble behind the cap of
three), \`neverSeen\` (closed before they were seen: they gag) and \`meanSeenDelayMs\` (the mean time between the telegraph and
the sight, over the threats seen late; null when none).
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
        'chrono-ring': { type: 'string' },
        compare: { type: 'string' },
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

  const chronoRingText = text('chrono-ring') ?? 'on';
  if (!(CHRONO_RING_MODES as readonly string[]).includes(chronoRingText)) {
    return err(`unknown --chrono-ring "${chronoRingText}": choose ${CHRONO_RING_MODES.join(', ')}`);
  }
  const compareDir = text('compare');
  if (compareDir === '') return err('--compare needs a folder path, got an empty string');

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
  // The testers played whole games of the level as it is: a capped or sequence-started game says nothing.
  if (compareDir !== undefined && untilSimMs !== null) {
    return err('--compare needs whole games: drop --until-ms');
  }
  if (compareDir !== undefined && sequenceText !== undefined) {
    return err('--compare needs games as the testers played them: drop --sequence');
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
    chronoRing: chronoRingText as ChronoRingMode,
    compareDir: compareDir ?? null,
    sequenceId: sequenceText ?? null,
    sequenceAtMs: Math.ceil(sequenceAt.value / STEP_MS) * STEP_MS,
    help,
  });
}
