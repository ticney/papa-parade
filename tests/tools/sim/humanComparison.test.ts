import type { JournalFile } from '@content/schemas/journal';
import { describe, expect, it } from 'vitest';
import type { TesterGame } from '../../../tools/playtest/loadJournals.ts';
import {
  type ComparedBot,
  compareWithTesters,
  type HumanBotThresholds,
  medianOf,
} from '../../../tools/sim/humanComparison.ts';
import { type JournalSpec, makeJournal } from '../playtest/support.ts';

const THRESHOLDS: HumanBotThresholds = { maxStarGap: 1, maxPerfectExcessPct: 10 };
const BOT: ComparedBot = {
  level: 'salon_crawler',
  tier: 'normal',
  meanStars: 3,
  meanScore: 60,
  perfectPct: 40,
};

/** `perfects` perfect and `others` success responses: a game whose perfect rate is perfects / (perfects + others). */
function mix(perfects: number, others: number): JournalSpec['responses'] {
  return [
    ...Array.from({ length: perfects }, () => ({ threat: 'outlet', quality: 'perfect' as const })),
    ...Array.from({ length: others }, () => ({ threat: 'outlet', quality: 'success' as const })),
  ];
}

interface GameSpec extends JournalSpec {
  scorePoints?: number;
  tier?: string;
  legacyScore?: boolean;
}

/** A tester's game: a valid journal file, with the points, the tier and the score shape of the spec. */
function game(file: string, spec: GameSpec = {}): TesterGame {
  const journal: JournalFile = makeJournal({ responses: mix(2, 2), ...spec });
  if (spec.scorePoints !== undefined) {
    (journal.summary.score as { scorePoints: number }).scorePoints = spec.scorePoints;
  }
  if (spec.tier !== undefined) {
    journal.replay.journal.entries.push({
      applyAt: 0,
      command: { type: 'SetDifficultyTier', t: 0, tier: spec.tier },
    });
  }
  if (spec.legacyScore === true) {
    const { calmPoints, homePoints, ...rest } = journal.summary.score as Record<string, number>;
    journal.summary.score = {
      ...rest,
      babyStatePoints: (calmPoints ?? 0) + (homePoints ?? 0),
    } as never;
  }
  return { file, journal };
}

const panel = (games: TesterGame[], skipped: { file: string; reason: string }[] = []) => ({
  testers: [{ testerId: 'geo', games }],
  skipped,
});

describe('medianOf', () => {
  it('is the middle value of an odd count, whatever the order', () => {
    expect(medianOf([5, 1, 3])).toBe(3);
    expect(medianOf([7])).toBe(7);
  });

  it('is the mean of the two middle values of an even count', () => {
    expect(medianOf([4, 1, 2, 3])).toBe(2.5);
    expect(medianOf([1, 1000])).toBe(500.5);
  });

  it('is null for nothing, and does not reorder its argument', () => {
    expect(medianOf([])).toBeNull();
    const values = [3, 1, 2];
    medianOf(values);
    expect(values).toEqual([3, 1, 2]);
  });
});

describe('compareWithTesters (story 3.14, D6)', () => {
  it('takes the median of the stars, the score and each game perfect rate', () => {
    const games = [
      game('geo/1.json', { stars: 1, scorePoints: 20, responses: mix(0, 10) }),
      game('geo/2.json', { stars: 2, scorePoints: 40, responses: mix(1, 3) }),
      game('geo/3.json', { stars: 5, scorePoints: 90, responses: mix(5, 5) }),
    ];
    const result = compareWithTesters('panel', panel(games), BOT, THRESHOLDS);
    expect(result).toMatchObject({
      dir: 'panel',
      games: 3,
      skipped: [],
      medianStars: 2,
      medianScorePoints: 40,
      medianPerfectPct: 25,
      botMeanStars: 3,
      botMeanScore: 60,
      botPerfectPct: 40,
    });
  });

  it('averages the two middle games of an even count', () => {
    const games = [
      game('geo/1.json', { stars: 1, scorePoints: 10 }),
      game('geo/2.json', { stars: 2, scorePoints: 20 }),
    ];
    const result = compareWithTesters('panel', panel(games), BOT, THRESHOLDS);
    expect(result.medianStars).toBe(1.5);
    expect(result.medianScorePoints).toBe(15);
  });

  it('skips another level, another tier and a four-row score, each with its reason, and keeps the rest', () => {
    const games = [
      game('geo/kept.json', { stars: 3 }),
      game('geo/level.json', { levelId: 'chambre_night' }),
      game('geo/tier.json', { tier: 'assistance' }),
      game('geo/old.json', { legacyScore: true }),
      game('geo/silent.json', { responses: [] }),
    ];
    const result = compareWithTesters(
      'panel',
      panel(games, [{ file: 'geo/bot.json', reason: 'a bot run file, not a playtest journal' }]),
      BOT,
      THRESHOLDS,
    );
    expect(result.games).toBe(1);
    expect(result.skipped).toEqual([
      { file: 'geo/bot.json', reason: 'a bot run file, not a playtest journal' },
      { file: 'geo/level.json', reason: 'another level (chambre_night, not salon_crawler)' },
      { file: 'geo/tier.json', reason: 'another tier (assistance, not normal)' },
      { file: 'geo/old.json', reason: expect.stringContaining('four-row score') },
      { file: 'geo/silent.json', reason: 'no response in the game' },
    ]);
  });

  it('reads the tier of the last SetDifficultyTier, and the default tier when there is none', () => {
    const asked = { ...BOT, tier: 'experienced' };
    expect(
      compareWithTesters(
        'p',
        panel([game('geo/1.json', { tier: 'experienced' })]),
        asked,
        THRESHOLDS,
      ).games,
    ).toBe(1);
    expect(compareWithTesters('p', panel([game('geo/1.json')]), asked, THRESHOLDS).games).toBe(0);
    const twice = game('geo/2.json', { tier: 'assistance' });
    twice.journal.replay.journal.entries.push({
      applyAt: 10,
      command: { type: 'SetDifficultyTier', t: 10, tier: 'normal' },
    });
    expect(compareWithTesters('p', panel([twice]), BOT, THRESHOLDS).games).toBe(1);
  });

  it('has nothing to say with no game kept: every figure and both statuses are n/a', () => {
    const result = compareWithTesters('panel', panel([]), BOT, THRESHOLDS);
    expect(result).toMatchObject({
      games: 0,
      medianStars: null,
      medianScorePoints: null,
      medianPerfectPct: null,
      starGap: null,
      perfectExcessPct: null,
      starStatus: 'n/a',
      perfectStatus: 'n/a',
    });
  });

  it('has nothing to say when the bot played no response either', () => {
    const result = compareWithTesters(
      'panel',
      panel([game('geo/1.json')]),
      { ...BOT, meanStars: null, perfectPct: null },
      THRESHOLDS,
    );
    expect(result.games).toBe(1);
    expect([result.starStatus, result.perfectStatus]).toEqual(['n/a', 'n/a']);
  });

  describe('the star status is OK strictly under maxStarGap, either way', () => {
    const statusFor = (meanStars: number) =>
      compareWithTesters(
        'p',
        panel([game('geo/1.json', { stars: 3 })]),
        { ...BOT, meanStars },
        THRESHOLDS,
      );

    it.each([
      [3, 'OK'],
      [3.9, 'OK'],
      [2.1, 'OK'],
      [4, 'KO'],
      [2, 'KO'],
      [5, 'KO'],
    ] as const)('mean %s stars against a median of 3: %s', (meanStars, status) => {
      expect(statusFor(meanStars).starStatus).toBe(status);
    });

    it('decides on the exact gap, and only rounds what it reports', () => {
      const close = statusFor(3.96);
      expect(close.starStatus).toBe('OK'); // 0.96 is under 1, though it prints as 1
      expect(close.starGap).toBe(1);
    });

    it('gives the gap signed, to one decimal', () => {
      expect(statusFor(3.9).starGap).toBe(0.9);
      expect(statusFor(2.1).starGap).toBe(-0.9);
    });
  });

  describe('the perfect status is OK up to maxPerfectExcessPct more than the median, and never for fewer', () => {
    // The testers' median perfect rate is 25 %.
    const games = [game('geo/1.json', { responses: mix(1, 3) })];
    const statusFor = (perfectPct: number) =>
      compareWithTesters('p', panel(games), { ...BOT, perfectPct }, THRESHOLDS);

    it.each([
      [0, 'OK'],
      [25, 'OK'],
      [34.9, 'OK'],
      [35, 'OK'],
      [35.1, 'KO'],
      [75, 'KO'],
    ] as const)('a bot at %s %%: %s', (perfectPct, status) => {
      expect(statusFor(perfectPct).perfectStatus).toBe(status);
    });

    it('decides on the exact excess, and only rounds what it reports', () => {
      // One game in three is perfect: a median of 33.33 %, printed 33.3.
      const third = [game('geo/1.json', { responses: mix(1, 2) })];
      const over = compareWithTesters('p', panel(third), { ...BOT, perfectPct: 43.34 }, THRESHOLDS);
      expect(over.perfectStatus).toBe('KO'); // 10.007 is over 10, though it prints as 10
      expect(over.perfectExcessPct).toBe(10);
    });

    it('gives the excess in points, signed', () => {
      expect(statusFor(35).perfectExcessPct).toBe(10);
      expect(statusFor(5).perfectExcessPct).toBe(-20);
    });
  });

  it('reads its thresholds from the content: a wider gap is allowed when the file says so', () => {
    const games = [game('geo/1.json', { stars: 1 })];
    const bot = { ...BOT, meanStars: 3 };
    expect(compareWithTesters('p', panel(games), bot, THRESHOLDS).starStatus).toBe('KO');
    expect(
      compareWithTesters('p', panel(games), bot, { ...THRESHOLDS, maxStarGap: 2.5 }).starStatus,
    ).toBe('OK');
  });
});
