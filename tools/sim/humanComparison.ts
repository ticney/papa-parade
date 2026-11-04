import type { PlaytestFile } from '@content/schemas/playtest';
import { DEFAULT_DIFFICULTY_TIER } from '@shared/constants';
import { err, ok, type Result } from '@shared/result';
import { type LoadedJournals, loadJournals, type TesterGame } from '../playtest/loadJournals.ts';

// The GDD indicator « Le joueur simulé humain joue comme un humain » (story 3.14): the bot's mean
// stars stay within `maxStarGap` of the median of the testers', and it does not get more perfects than
// they do (by more than `maxPerfectExcessPct` points). The computation is pure; `loadHumanComparison`
// is the only I/O, and `runSim`'s `main` is its only caller.

/** The same three words as `computeMetrics`' `Status`. */
export type ComparisonStatus = 'OK' | 'KO' | 'n/a';

/** What the comparison reads of the report: it is a pure function of the report and the panel. */
export interface ComparedBot {
  level: string;
  tier: string;
  meanStars: number | null;
  meanScore: number | null;
  perfectPct: number | null;
}

export type HumanBotThresholds = PlaytestFile['humanBot'];

export interface HumanComparison {
  /** The panel folder, as `--compare` named it. */
  dir: string;
  /** The testers' games kept: same level, same tier, five-row score, at least one response. */
  games: number;
  /** The files left out, with the reason: `loadJournals`' own, then the ones this comparison drops. */
  skipped: { file: string; reason: string }[];
  /** Middle value of the games' stars (mean of the two middle ones for an even count), one decimal; null when no game is kept. */
  medianStars: number | null;
  medianScorePoints: number | null;
  /** Median of the games' own perfect rate (`perfect / (perfect + success + fail)`), in %, one decimal. */
  medianPerfectPct: number | null;
  botMeanStars: number | null;
  botMeanScore: number | null;
  botPerfectPct: number | null;
  /** `botMeanStars - medianStars`, one decimal; null when either side is. */
  starGap: number | null;
  /** `botPerfectPct - medianPerfectPct`, in points, one decimal; null when either side is. */
  perfectExcessPct: number | null;
  /** `OK` when `|starGap| < maxStarGap`. */
  starStatus: ComparisonStatus;
  /** `OK` when `perfectExcessPct <= maxPerfectExcessPct`. */
  perfectStatus: ComparisonStatus;
}

const round1 = (value: number): number => Math.round(value * 10) / 10 + 0; // + 0: no "-0"

/** Middle value; the mean of the two middle ones for an even count. `null` for an empty list. */
export function medianOf(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const high = sorted[middle] as number;
  return sorted.length % 2 === 1 ? high : ((sorted[middle - 1] as number) + high) / 2;
}

/**
 * The tier a game was played at: the `tier` of its last `SetDifficultyTier` (the client sends none at the
 * default tier). It is not in the summary (deferred-work 2.8), so it is read off the journal.
 */
function tierOf(game: TesterGame): string {
  const { entries } = game.journal.replay.journal;
  for (let i = entries.length - 1; i >= 0; i--) {
    const { command } = entries[i] as (typeof entries)[number];
    if (command.type === 'SetDifficultyTier') {
      const { tier } = command as { tier?: unknown };
      if (typeof tier === 'string') return tier;
    }
  }
  return DEFAULT_DIFFICULTY_TIER;
}

interface KeptGame {
  stars: number;
  scorePoints: number;
  perfectPct: number;
}

/** A game's figures, or why it cannot be compared with the bot. */
function judge(game: TesterGame, bot: ComparedBot): KeptGame | string {
  const { replay, summary } = game.journal;
  if (replay.levelId !== bot.level) return `another level (${replay.levelId}, not ${bot.level})`;
  const tier = tierOf(game);
  if (tier !== bot.tier) return `another tier (${tier}, not ${bot.tier})`;
  const { score } = summary;
  if (!('calmPoints' in score)) {
    return 'a four-row score (before v2.3): another note, not comparable';
  }
  const { perfect, success, fail } = summary.responses.byQuality;
  const responses = perfect + success + fail;
  if (responses === 0) return 'no response in the game';
  return {
    stars: score.stars,
    scorePoints: score.scorePoints,
    perfectPct: (perfect / responses) * 100,
  };
}

/** The bot against the testers' games. Pure: no I/O, no clock. */
export function compareWithTesters(
  dir: string,
  loaded: Pick<LoadedJournals, 'testers' | 'skipped'>,
  bot: ComparedBot,
  thresholds: HumanBotThresholds,
): HumanComparison {
  const kept: KeptGame[] = [];
  const skipped = loaded.skipped.map(({ file, reason }) => ({ file, reason }));
  for (const tester of loaded.testers) {
    for (const game of tester.games) {
      const verdict = judge(game, bot);
      if (typeof verdict === 'string') skipped.push({ file: game.file, reason: verdict });
      else kept.push(verdict);
    }
  }
  const median = (pick: (game: KeptGame) => number): number | null => medianOf(kept.map(pick));
  const roundOrNull = (value: number | null): number | null =>
    value === null ? null : round1(value);
  // The statuses are decided on the exact figures; only the report rounds them (a true gap of 0.96 is under 1).
  const medianStars = median((game) => game.stars);
  const medianPerfectPct = median((game) => game.perfectPct);
  const starGap =
    medianStars === null || bot.meanStars === null ? null : bot.meanStars - medianStars;
  const perfectExcessPct =
    medianPerfectPct === null || bot.perfectPct === null ? null : bot.perfectPct - medianPerfectPct;
  return {
    dir,
    games: kept.length,
    skipped,
    medianStars: roundOrNull(medianStars),
    medianScorePoints: roundOrNull(median((game) => game.scorePoints)),
    medianPerfectPct: roundOrNull(medianPerfectPct),
    botMeanStars: bot.meanStars,
    botMeanScore: bot.meanScore,
    botPerfectPct: bot.perfectPct,
    starGap: roundOrNull(starGap),
    perfectExcessPct: roundOrNull(perfectExcessPct),
    starStatus: starGap === null ? 'n/a' : Math.abs(starGap) < thresholds.maxStarGap ? 'OK' : 'KO',
    perfectStatus:
      perfectExcessPct === null
        ? 'n/a'
        : perfectExcessPct <= thresholds.maxPerfectExcessPct
          ? 'OK'
          : 'KO',
  };
}

/** Reads the panel in `dir` (`<dir>/<testerId>/*.json`, as `playtest:metrics` does) and compares the bot with it. */
export async function loadHumanComparison(
  dir: string,
  bot: ComparedBot,
  thresholds: HumanBotThresholds,
): Promise<Result<HumanComparison, string>> {
  const loaded = await loadJournals(dir);
  if (!loaded.ok) return err(`--compare ${dir}: ${loaded.error.join('; ')}`);
  return ok(compareWithTesters(dir, loaded.value, bot, thresholds));
}
