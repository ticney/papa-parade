import type { VisibilityCounters } from '@bots/bot';
import { asSimMs } from '@shared/time';
import type { SimEvent } from '@sim';
import { createSim } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  createRunRecorder,
  type RunSummary,
  renderReport,
  summarizeRuns,
} from '../../../tools/sim/simReport.ts';
import { botTestLevel } from '../../support/botSupport.ts';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestResponseWindow,
  DISHWASHER_OPEN,
  FATIGUE_GAUGES,
  NEED_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  TEST_COOKING,
  TEST_DISHWASHER,
  TEST_OBJECTS,
  TEST_STOVE,
  TEST_TOILET,
  TEST_UNLOAD_DISHWASHER,
  testPhoneEntry,
  testWave,
} from '../../support/testContent.ts';

const INPUT = {
  level: 'salon_crawler',
  bot: 'human',
  tier: 'normal' as const,
  chronoRing: 'on' as const,
  seed: 5,
  untilSimMs: 1000,
  hashes: { feel: 'f', geometry: 'g', level: 'l', bots: 'b' },
  waves: [] as { fromMs: number; maxSimultaneous: number }[],
};

const WAVES = [
  { fromMs: 0, maxSimultaneous: 1 },
  { fromMs: 60000, maxSimultaneous: 2 },
];

const NO_NOISE: RunSummary['noiseBySourcePct'] = {
  propImpact: 0,
  phoneRinging: 0,
  babyCrying: 0,
  floorCreak: 0,
  breathReleased: 0,
  sniff: 0,
  debrisStep: 0,
  snore: 0,
  gag: 0,
  debug: 0,
};

function run(seed: number, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    seed,
    worldHash: `hash${seed}`,
    responses: 0,
    visibility: null,
    gags: 0,
    nearMisses: 0,
    microSleeps: 0,
    coffees: 0,
    asleepGags: 0,
    afterEffects: {
      electrified: 0,
      babyDownstairs: 0,
      debris: 0,
      mess: 0,
      asleep: 0,
      dim: 0,
      carryUp: 0,
    },
    phoneRings: 0,
    phoneAnswers: 0,
    phoneRingingSeconds: 0,
    silences: 0,
    silencesFound: 0,
    silencesTimedOut: 0,
    silencesCutOff: 0,
    babyPickUps: 0,
    babyPutDowns: 0,
    safePutDowns: 0,
    armsCries: 0,
    cancelledThreats: 0,
    comboCashIns: 0,
    comboPointsCashed: 0,
    comboPeakMultiplier: 0,
    instinctTriggers: 0,
    toiletVisits: 0,
    chores: {
      beats: { perfect: 0, success: 0, fail: 0 },
      completed: 0,
      homePoints: 0,
      abandoned: { telegraphed: 0, resolved: 0, boiledOver: 0 },
      byDef: {},
      objectsBroken: 0,
      open: { telegraphed: 0, closed: 0, gagged: 0 },
    },
    sequencesStarted: 0,
    sequencesSucceeded: 0,
    sequencesFailed: 0,
    sequenceRetreats: 0,
    beatsHit: 0,
    beatsMissed: 0,
    decoysTapped: 0,
    beatsStray: 0,
    cycleEntriesReached: 0,
    sequenceOutcomes: {},
    floorCreaks: 0,
    breathGasps: { empty: 0, early: 0, notHeld: 0 },
    nothingResponses: 0,
    finalRushes: 0,
    propsTidied: 0,
    frozenNearMisses: 0,
    fairnessViolations: 0,
    stretchedTelegraphs: 0,
    stretchSumMs: 0,
    bladderPeakPct: 0,
    noisePeakPct: 0,
    noiseFinalPct: 0,
    noiseBySourcePct: NO_NOISE,
    commands: 0,
    threats: {},
    byGag: {},
    waves: [],
    isEnded: false,
    endReason: null,
    mamaWokeAtMs: null,
    mamaHomeAtMs: null,
    catastrophePeakPct: 0,
    scorePoints: null,
    stars: null,
    lostStars: null,
    rows: null,
    ...overrides,
  };
}

const tally = (overrides: Partial<RunSummary['threats'][string]> = {}) => ({
  responses: 0,
  perfect: 0,
  success: 0,
  fail: 0,
  failReasons: { early: 0, late: 0, wrongResponse: 0, released: 0, acted: 0 },
  absOffsetSumMs: 0,
  offsetCount: 0,
  ...overrides,
});

describe('summarizeRuns', () => {
  it('the pooled perfect rate counts every response of every run, each run keeps its own, none is null (story 3.14)', () => {
    const perfect = (responses: number, perfects: number) =>
      run(1, {
        responses,
        threats: { outlet: tally({ responses, perfect: perfects, success: responses - perfects }) },
      });
    const report = summarizeRuns({ ...INPUT, chronoRing: 'off' }, [
      { ...perfect(4, 1), seed: 1 },
      { ...perfect(8, 5), seed: 2 },
      { ...run(3, {}), seed: 3 },
    ]);
    // 6 perfects of 12 responses: pooled over the responses, not the mean of the runs' rates (25 and 62.5).
    expect(report.perfectPct).toBe(50);
    expect(report.runList.map((entry) => entry.perfectPct)).toEqual([25, 62.5, null]);
    expect(report.chronoRing).toBe('off');
    expect(summarizeRuns(INPUT, [run(1, {})]).perfectPct).toBeNull();
    expect(summarizeRuns(INPUT, []).perfectPct).toBeNull();
  });

  it('counts per threat def, with percentages rounded to 0.1 and the mean offset', () => {
    const report = summarizeRuns(INPUT, [
      run(5, {
        responses: 3,
        gags: 1,
        nearMisses: 1,
        commands: 6,
        byGag: { outlet_hair: 1 },
        threats: {
          outlet: tally({
            responses: 3,
            perfect: 1,
            success: 1,
            fail: 1,
            failReasons: { early: 0, late: 1, wrongResponse: 0, released: 0, acted: 0 },
            absOffsetSumMs: 30,
            offsetCount: 2,
          }),
        },
      }),
    ]);
    expect(report.threats.outlet).toEqual({
      responses: 3,
      perfect: 1,
      success: 1,
      fail: 1,
      perfectPct: 33.3,
      successPct: 33.3,
      failPct: 33.3,
      failReasons: { early: 0, late: 1, wrongResponse: 0, released: 0, acted: 0 },
      meanAbsOffsetMs: 15,
    });
    expect(report.meanSuccessPct).toBe(66.7);
    expect(report.perfectPct).toBe(33.3);
    expect(report.chronoRing).toBe('on');
    expect(report.comparison).toBeNull();
    expect(report.gags).toEqual({
      total: 1,
      meanPerRun: 1,
      byGag: { outlet_hair: 1 },
      nearMisses: 1,
    });
    // No run ended: no score, and no star count.
    expect(report.meanScore).toBeNull();
    expect(report.meanStars).toBeNull();
    expect(report.meanRows).toBeNull();
    expect(report.starCounts).toEqual([0, 0, 0, 0, 0, 0]);
    expect(report.runList).toEqual([
      {
        seed: 5,
        worldHash: 'hash5',
        responses: 3,
        perfectPct: 33.3,
        gags: 1,
        fairnessViolations: 0,
        commands: 6,
        scorePoints: null,
        stars: null,
        endReason: null,
        lostStars: null,
        mamaHomeAtMs: null,
        catastrophePeakPct: 0,
        rows: null,
        sequencesStarted: 0,
        sequencesSucceeded: 0,
        sequencesFailed: 0,
        sequenceRetreats: 0,
        beatsHit: 0,
        beatsMissed: 0,
        decoysTapped: 0,
        beatsStray: 0,
      },
    ]);
  });

  it('totals the séquelles per kind and per run, every kind present (story 3.15)', () => {
    const none = {
      electrified: 0,
      babyDownstairs: 0,
      debris: 0,
      mess: 0,
      asleep: 0,
      dim: 0,
      carryUp: 0,
    };
    const report = summarizeRuns(INPUT, [
      run(1, { afterEffects: { ...none, electrified: 2, dim: 2, carryUp: 1 } }),
      run(2, { afterEffects: { ...none, electrified: 1, dim: 1, debris: 1 } }),
      run(3, {}),
    ]);
    expect(report.afterEffects.byKind).toEqual({
      ...none,
      electrified: 3,
      dim: 3,
      carryUp: 1,
      debris: 1,
    });
    // 8 séquelles over 3 games.
    expect(report.afterEffects.meanPerRun).toBe(2.67);
    expect(summarizeRuns(INPUT, []).afterEffects).toEqual({ byKind: none, meanPerRun: 0 });
  });

  it('adds the fairness violations and stretched telegraphs of the runs, with the mean stretch to one decimal (story 3.13)', () => {
    const report = summarizeRuns(INPUT, [
      run(1, { fairnessViolations: 2, stretchedTelegraphs: 2, stretchSumMs: 1000 }),
      run(2, { fairnessViolations: 0, stretchedTelegraphs: 1, stretchSumMs: 700 }),
      run(3, {}),
    ]);
    expect(report.fairnessViolations).toBe(2);
    expect(report.stretchedTelegraphs).toBe(3);
    expect(report.meanStretchMs).toBe(566.7);
    expect(report.runList.map((entry) => entry.fairnessViolations)).toEqual([2, 0, 0]);
  });

  it('has no mean stretch when no telegraph was stretched, not 0 (story 3.13)', () => {
    const report = summarizeRuns(INPUT, [run(1, {}), run(2, {})]);
    expect(report.stretchedTelegraphs).toBe(0);
    expect(report.meanStretchMs).toBeNull();
    expect(report.fairnessViolations).toBe(0);
  });

  it('gives Mama’s mean score and stars over the runs that ended, and counts the runs per star (story 1.22)', () => {
    const report = summarizeRuns(INPUT, [
      run(1, { isEnded: true, scorePoints: 73, stars: 3 }),
      run(2, { isEnded: true, scorePoints: 90, stars: 5 }),
      run(3, { isEnded: true, scorePoints: 61, stars: 3 }),
      // Cut by `--until-ms`: no note, left out of the means.
      run(4, {}),
    ]);
    expect(report.meanScore).toBe(74.7);
    expect(report.meanStars).toBe(3.7);
    expect(report.starCounts).toEqual([0, 0, 0, 2, 0, 1]);
    expect(report.starCounts.reduce((sum, count) => sum + count, 0)).toBe(report.endedRuns);
    expect(report.runList.map(({ scorePoints, stars }) => [scorePoints, stars])).toEqual([
      [73, 3],
      [90, 5],
      [61, 3],
      [null, null],
    ]);
    expect(report).not.toHaveProperty('scoreNote');
  });

  it('gives the mean of each of the five rows over the runs that ended, one decimal (story 3.12)', () => {
    const rows = (laugh: number, calm: number, home: number, sigh: number, scream: number) => ({
      laughPoints: laugh,
      calmPoints: calm,
      homePoints: home,
      sighPoints: sigh,
      screamPoints: scream,
    });
    const report = summarizeRuns(INPUT, [
      run(1, { isEnded: true, scorePoints: 60, stars: 3, rows: rows(10, 20, 0, 5, 0) }),
      run(2, { isEnded: true, scorePoints: 40, stars: 2, rows: rows(11, 11, 0, 8, 3) }),
      run(3, { isEnded: true, scorePoints: 30, stars: 1, rows: rows(0, 0, 3, 15, 15) }),
      // Cut by `--until-ms`: no note, left out of the means.
      run(4, {}),
      // A score without its rows (a summary built before 3.12): counted in `meanScore`, never as zero rows.
      run(5, { isEnded: true, scorePoints: 50, stars: 2, rows: null }),
    ]);
    expect(report.meanRows).toEqual({
      laughPoints: 7,
      calmPoints: 10.3,
      homePoints: 1,
      sighPoints: 9.3,
      screamPoints: 6,
    });
    expect(report.runList.map((entry) => entry.rows)).toEqual([
      rows(10, 20, 0, 5, 0),
      rows(11, 11, 0, 8, 3),
      rows(0, 0, 3, 15, 15),
      null,
      null,
    ]);
    // Nothing that 3.14 and the playtest metrics read has moved: run 5 counts in the score's mean.
    expect(report.meanScore).toBe(45);
    expect(report.meanStars).toBe(2);
  });

  it('counts how the games ended, every reason present, and the mean time Mama woke at (story 3.2)', () => {
    const report = summarizeRuns(INPUT, [
      run(1, { isEnded: true, endReason: 'timer', scorePoints: 73, stars: 3, lostStars: 0 }),
      run(2, {
        isEnded: true,
        endReason: 'mamaWoke',
        mamaWokeAtMs: 40_000,
        scorePoints: 73,
        stars: 2,
        lostStars: 1,
      }),
      run(3, {
        isEnded: true,
        endReason: 'mamaWoke',
        mamaWokeAtMs: 50_001,
        scorePoints: 73,
        stars: 2,
        lostStars: 1,
      }),
      // Cut by `--until-ms`: ended for nobody.
      run(4, {}),
    ]);
    expect(report.endsByReason).toEqual({ timer: 1, mamaWoke: 2, cycleDone: 0, mamaHome: 0 });
    expect(Object.values(report.endsByReason).reduce((sum, count) => sum + count, 0)).toBe(
      report.endedRuns,
    );
    expect(report.mamaWokeMeanAtMs).toBe(45_000.5);
    expect(report.runList.map(({ endReason, lostStars }) => [endReason, lostStars])).toEqual([
      ['timer', 0],
      ['mamaWoke', 1],
      ['mamaWoke', 1],
      [null, null],
    ]);
  });

  it('counts the games Mama came home early in, with the mean time and the mean peak of the gauge (story 3.16)', () => {
    const report = summarizeRuns(INPUT, [
      run(1, {
        isEnded: true,
        endReason: 'timer',
        scorePoints: 80,
        stars: 3,
        lostStars: 0,
        catastrophePeakPct: 40,
      }),
      run(2, {
        isEnded: true,
        endReason: 'mamaHome',
        mamaHomeAtMs: 30_000,
        catastrophePeakPct: 100,
        scorePoints: 50,
        stars: 0,
        lostStars: 0,
      }),
      run(3, {
        isEnded: true,
        endReason: 'mamaHome',
        mamaHomeAtMs: 40_001,
        catastrophePeakPct: 100,
        scorePoints: 50,
        stars: 0,
        lostStars: 0,
      }),
      // Cut by `--until-ms`: no end, but its peak still counts in the mean.
      run(4, { catastrophePeakPct: 10 }),
    ]);
    expect(report.endsByReason).toEqual({ timer: 1, mamaWoke: 0, cycleDone: 0, mamaHome: 2 });
    expect(report.mamaHomeMeanAtMs).toBe(35_000.5);
    expect(report.meanCatastrophePeakPct).toBe(62.5);
    expect(report.runList.map(({ mamaHomeAtMs }) => mamaHomeAtMs)).toEqual([
      null,
      30_000,
      40_001,
      null,
    ]);
    // A mama who never came home leaves no mean time; the peak mean is there as soon as there is a run.
    const quiet = summarizeRuns(INPUT, [run(1, { isEnded: true, endReason: 'timer' })]);
    expect(quiet.mamaHomeMeanAtMs).toBeNull();
    expect(quiet.meanCatastrophePeakPct).toBe(0);
    expect(summarizeRuns(INPUT, []).meanCatastrophePeakPct).toBeNull();
  });

  it('folds the bedtime cycle: runs completed, mean entries, and each sequence by id (story 4.10)', () => {
    const done = run(1, {
      endReason: 'cycleDone',
      cycleEntriesReached: 5,
      sequenceOutcomes: { stay_awake: { started: 2, won: 1, lost: 1 } },
    });
    const lost = run(2, {
      // A tie with the noise: the last entry won, and Mama ends the level.
      endReason: 'mamaWoke',
      cycleEntriesReached: 5,
      sequenceOutcomes: { stay_awake: { started: 3, won: 0, lost: 2 } },
    });
    const report = summarizeRuns(INPUT, [done, lost]);
    expect(report.cycleCompleted).toBe(1);
    expect(report.cycleEntriesReached).toBe(5);
    expect(report.sequenceOutcomes).toEqual({ stay_awake: { started: 5, won: 1, lost: 3 } });
    expect(summarizeRuns(INPUT, [run(1, {})]).sequenceOutcomes).toEqual({});
  });

  it('keeps every endsByReason key at 0 when nothing ended, and no mean time when Mama never woke', () => {
    const none = summarizeRuns(INPUT, [run(1, {})]);
    expect(none.endsByReason).toEqual({ timer: 0, mamaWoke: 0, cycleDone: 0, mamaHome: 0 });
    expect(none.mamaWokeMeanAtMs).toBeNull();
    const timerOnly = summarizeRuns(INPUT, [run(1, { isEnded: true, endReason: 'timer' })]);
    expect(timerOnly.endsByReason).toEqual({ timer: 1, mamaWoke: 0, cycleDone: 0, mamaHome: 0 });
    expect(timerOnly.mamaWokeMeanAtMs).toBeNull();
  });

  it('folds the waves: telegraphs summed, the peak is the max, the over-limit runs counted', () => {
    const report = summarizeRuns({ ...INPUT, waves: WAVES }, [
      run(1, {
        isEnded: true,
        waves: [
          { telegraphs: 4, peakSimultaneous: 1, isOverLimit: false },
          { telegraphs: 2, peakSimultaneous: 2, isOverLimit: false },
        ],
      }),
      run(2, {
        isEnded: true,
        waves: [
          { telegraphs: 3, peakSimultaneous: 1, isOverLimit: false },
          { telegraphs: 5, peakSimultaneous: 3, isOverLimit: true },
        ],
      }),
      run(3, {
        waves: [
          { telegraphs: 0, peakSimultaneous: 0, isOverLimit: false },
          { telegraphs: 0, peakSimultaneous: 0, isOverLimit: false },
        ],
      }),
    ]);
    expect(report.waves).toEqual([
      { fromMs: 0, maxSimultaneous: 1, telegraphs: 7, peakSimultaneous: 1, overLimitRuns: 0 },
      { fromMs: 60000, maxSimultaneous: 2, telegraphs: 7, peakSimultaneous: 3, overLimitRuns: 1 },
    ]);
    expect(report.endedRuns).toBe(2);
    expect(summarizeRuns(INPUT, []).waves).toEqual([]);
    expect(summarizeRuns({ ...INPUT, waves: WAVES }, []).waves[1]?.telegraphs).toBe(0);
  });

  it('adds the runs up', () => {
    const report = summarizeRuns(INPUT, [
      run(5, { responses: 2, threats: { outlet: tally({ responses: 2, perfect: 2 }) } }),
      run(6, { responses: 2, threats: { outlet: tally({ responses: 2, fail: 2 }) } }),
    ]);
    expect(report.runs).toBe(2);
    expect(report.threats.outlet?.responses).toBe(4);
    expect(report.threats.outlet?.perfectPct).toBe(50);
    expect(report.meanSuccessPct).toBe(50);
  });

  it('adds the near misses of the runs up', () => {
    const report = summarizeRuns(INPUT, [
      run(5, { gags: 2, nearMisses: 2 }),
      run(6, { gags: 3, nearMisses: 1 }),
    ]);
    expect(report.gags.nearMisses).toBe(3);
    expect(summarizeRuns(INPUT, []).gags.nearMisses).toBe(0);
  });

  it('adds the frozen near misses of the runs up, apart from the near misses of play (story 3.6)', () => {
    const report = summarizeRuns(INPUT, [
      run(5, { nearMisses: 2, frozenNearMisses: 1 }),
      run(6, { nearMisses: 0, frozenNearMisses: 2 }),
    ]);
    expect(report.frozenNearMisses).toBe(3);
    expect(report.gags.nearMisses).toBe(2);
    expect(report.runList.map((entry) => entry.seed)).toEqual([5, 6]);
    expect(summarizeRuns(INPUT, []).frozenNearMisses).toBe(0);
  });

  it('adds the micro-sleeps and the coffees up, and counts the runs where Papa fell asleep', () => {
    const report = summarizeRuns(INPUT, [
      run(5, { microSleeps: 3, coffees: 1, asleepGags: 2 }),
      run(6, { microSleeps: 4, coffees: 0, asleepGags: 0 }),
      run(7, { microSleeps: 1, coffees: 2, asleepGags: 1 }),
    ]);
    expect(report).toMatchObject({ microSleeps: 8, coffees: 3, asleepRuns: 2 });
    expect(summarizeRuns(INPUT, [])).toMatchObject({ microSleeps: 0, coffees: 0, asleepRuns: 0 });
  });

  it('adds the phone rings, answers and seconds of ringing up over the runs (story 1.20)', () => {
    const report = summarizeRuns(INPUT, [
      run(5, { phoneRings: 1, phoneAnswers: 0, phoneRingingSeconds: 15 }),
      run(6, { phoneRings: 1, phoneAnswers: 1, phoneRingingSeconds: 4 }),
      run(7, { phoneRings: 0, phoneAnswers: 0, phoneRingingSeconds: 0 }),
    ]);
    expect(report).toMatchObject({ phoneRings: 2, phoneAnswers: 1, phoneRingingSeconds: 19 });
    expect(summarizeRuns(INPUT, [])).toMatchObject({
      phoneRings: 0,
      phoneAnswers: 0,
      phoneRingingSeconds: 0,
    });
  });

  it('reports the mean and max of the noise peaks, the mean final noise and the noise per source (story 3.1)', () => {
    const report = summarizeRuns(INPUT, [
      run(5, {
        noisePeakPct: 40,
        noiseFinalPct: 10.5,
        noiseBySourcePct: { ...NO_NOISE, propImpact: 20.04, phoneRinging: 30 },
      }),
      run(6, {
        noisePeakPct: 100,
        noiseFinalPct: 30,
        noiseBySourcePct: { ...NO_NOISE, propImpact: 10, babyCrying: 6 },
      }),
      run(7, {}),
    ]);
    expect(report).toMatchObject({
      noisePeakMeanPct: 46.7,
      noisePeakMaxPct: 100,
      noiseFinalMeanPct: 13.5,
      noiseBySourcePct: { ...NO_NOISE, propImpact: 30, phoneRinging: 30, babyCrying: 6 },
    });
  });

  it('reports no noise for no run, and for a level with none', () => {
    expect(summarizeRuns(INPUT, [])).toMatchObject({
      noisePeakMeanPct: 0,
      noisePeakMaxPct: 0,
      noiseFinalMeanPct: 0,
      noiseBySourcePct: NO_NOISE,
    });
    expect(summarizeRuns(INPUT, [run(5)])).toMatchObject({
      noisePeakMeanPct: 0,
      noiseFinalMeanPct: 0,
    });
  });

  it('adds the silences, the ones found and the ones nobody found up over the runs (story 1.21)', () => {
    const report = summarizeRuns(INPUT, [
      run(5, { silences: 2, silencesFound: 1, silencesTimedOut: 1 }),
      run(6, { silences: 2, silencesFound: 0, silencesTimedOut: 1, silencesCutOff: 1 }),
      run(7, {}),
    ]);
    expect(report).toMatchObject({
      silences: 4,
      silencesFound: 1,
      silencesTimedOut: 2,
      silencesCutOff: 1,
    });
    expect(summarizeRuns(INPUT, [])).toMatchObject({
      silences: 0,
      silencesFound: 0,
      silencesTimedOut: 0,
      silencesCutOff: 0,
    });
  });

  it('never gives NaN: no response at all has no success rate, and the mean offset is null', () => {
    const report = summarizeRuns(INPUT, [
      run(5, { threats: { outlet: tally({ responses: 0 }) } }),
      run(6, { threats: { outlet: tally({ responses: 2, fail: 2 }) } }),
    ]);
    expect(report.threats.outlet?.meanAbsOffsetMs).toBeNull();
    expect(summarizeRuns(INPUT, []).meanSuccessPct).toBeNull();
    expect(summarizeRuns(INPUT, [run(1)]).gags.meanPerRun).toBe(0);
    const outlet = report.threats.outlet;
    for (const value of [outlet?.perfectPct, outlet?.successPct, outlet?.failPct]) {
      expect(Number.isFinite(value)).toBe(true);
    }
  });

  it('counts a threat def or a gag named like a member of Object.prototype', () => {
    const report = summarizeRuns(INPUT, [
      run(1, {
        threats: { constructor: tally({ responses: 1, success: 1 }) },
        byGag: { toString: 2 },
      }),
    ]);
    expect(Object.entries(report.threats)).toEqual([
      ['constructor', expect.objectContaining({ responses: 1 })],
    ]);
    expect(Object.entries(report.gags.byGag)).toEqual([['toString', 2]]);
  });

  it('sorts the threat and gag keys', () => {
    const report = summarizeRuns(INPUT, [
      run(5, {
        byGag: { zeta: 1, alpha: 2 },
        threats: { zebra: tally({ responses: 1 }), apple: tally({ responses: 1 }) },
      }),
    ]);
    expect(Object.keys(report.threats)).toEqual(['apple', 'zebra']);
    expect(Object.keys(report.gags.byGag)).toEqual(['alpha', 'zeta']);
  });

  it('is deterministic and renders 2-space JSON with a trailing newline', () => {
    const runs = [run(5, { threats: { outlet: tally({ responses: 1, perfect: 1 }) } })];
    const text = renderReport(summarizeRuns(INPUT, runs));
    expect(renderReport(summarizeRuns(INPUT, runs))).toBe(text);
    expect(text.endsWith('}\n')).toBe(true);
    expect(text).toContain('\n  "level"');
  });

  it('prints one line per wave, and stays valid JSON', () => {
    const report = summarizeRuns({ ...INPUT, waves: WAVES }, [run(5)]);
    const text = renderReport(report);
    const waveLines = text.split('\n').filter((line) => line.includes('"fromMs"'));
    expect(waveLines).toHaveLength(2);
    expect(JSON.parse(text)).toEqual(report);
    expect(JSON.parse(renderReport(summarizeRuns(INPUT, [])))).toMatchObject({ waves: [] });
  });
});

describe('summarizeRuns › chores (story 9.4)', () => {
  const chores = (
    perfect: number,
    success: number,
    fail: number,
    completed: number,
    homePoints: number,
    abandoned = { telegraphed: 0, resolved: 0, boiledOver: 0 },
  ): RunSummary['chores'] => ({
    beats: { perfect, success, fail },
    completed,
    homePoints,
    abandoned,
    byDef: {},
    objectsBroken: 0,
    open: { telegraphed: 0, closed: 0, gagged: 0 },
  });

  it('is all zero in a level with no station, and for no run at all', () => {
    const empty = {
      runsCompleted: 0,
      beats: { perfect: 0, success: 0, fail: 0 },
      meanHomePoints: 0,
      meanBeatsPerRun: 0,
      abandoned: { telegraphed: 0, resolved: 0, boiledOver: 0 },
      byDef: {},
      meanObjectsBroken: 0,
      open: { telegraphed: 0, closed: 0, gagged: 0 },
    };
    expect(summarizeRuns(INPUT, [run(1, {}), run(2, {})]).chores).toEqual(empty);
    expect(summarizeRuns(INPUT, []).chores).toEqual(empty);
  });

  it('counts the runs where a chore was finished, the beats by quality and the means per run', () => {
    const report = summarizeRuns(INPUT, [
      run(1, { chores: chores(4, 0, 0, 1, 7.5) }),
      run(2, { chores: chores(2, 1, 2, 0, 0) }),
      run(3, { chores: chores(1, 3, 0, 1, 7.5) }),
      run(4, {}),
    ]);
    expect(report.chores).toEqual({
      runsCompleted: 2,
      beats: { perfect: 7, success: 4, fail: 2 },
      // 15 points over 4 runs, 13 beats judged over 4 runs (3.25, to one decimal).
      meanHomePoints: 3.75,
      meanBeatsPerRun: 3.3,
      abandoned: { telegraphed: 0, resolved: 0, boiledOver: 0 },
      byDef: {},
      meanObjectsBroken: 0,
      open: { telegraphed: 0, closed: 0, gagged: 0 },
    });
  });

  // Story 9.6: a report per chore def, the plates the chores broke and the open dishwasher's threats.
  const byDefRun = (
    cooking: { completed: number; perfect: number; success: number; fail: number },
    dishwasher: { completed: number; perfect: number; success: number; fail: number },
    objectsBroken: number,
    open = { telegraphed: 0, closed: 0, gagged: 0 },
  ): RunSummary['chores'] => ({
    ...chores(
      cooking.perfect + dishwasher.perfect,
      cooking.success + dishwasher.success,
      cooking.fail + dishwasher.fail,
      cooking.completed + dishwasher.completed,
      7.5 * (cooking.completed + dishwasher.completed),
    ),
    byDef: {
      cooking: {
        completed: cooking.completed,
        beats: { perfect: cooking.perfect, success: cooking.success, fail: cooking.fail },
      },
      unload_dishwasher: {
        completed: dishwasher.completed,
        beats: { perfect: dishwasher.perfect, success: dishwasher.success, fail: dishwasher.fail },
      },
    },
    objectsBroken,
    open,
  });

  it('reports each chore def: the runs it was finished in, its beats and its mean beats missed', () => {
    const report = summarizeRuns(INPUT, [
      run(1, {
        chores: byDefRun(
          { completed: 1, perfect: 4, success: 0, fail: 0 },
          { completed: 1, perfect: 3, success: 1, fail: 2 },
          2,
        ),
      }),
      run(2, {
        chores: byDefRun(
          { completed: 1, perfect: 4, success: 0, fail: 1 },
          { completed: 0, perfect: 1, success: 0, fail: 3 },
          3,
        ),
      }),
      run(3, {}),
    ]);
    expect(report.chores.byDef).toEqual({
      cooking: {
        runsCompleted: 2,
        beats: { perfect: 8, success: 0, fail: 1 },
        meanBeatsMissed: 0.33,
      },
      unload_dishwasher: {
        runsCompleted: 1,
        beats: { perfect: 4, success: 1, fail: 5 },
        meanBeatsMissed: 1.67,
      },
    });
    // The runs that saw nothing of a def still count in the mean: three runs, five plates.
    expect(report.chores.meanObjectsBroken).toBe(1.67);
  });

  it('sums the open-door threats over the runs, and means the broken objects over zero runs to 0', () => {
    const report = summarizeRuns(INPUT, [
      run(1, {
        chores: byDefRun(
          { completed: 0, perfect: 0, success: 0, fail: 0 },
          { completed: 0, perfect: 0, success: 0, fail: 0 },
          0,
          { telegraphed: 3, closed: 2, gagged: 1 },
        ),
      }),
      run(2, {
        chores: byDefRun(
          { completed: 0, perfect: 0, success: 0, fail: 0 },
          { completed: 0, perfect: 0, success: 0, fail: 0 },
          0,
          { telegraphed: 1, closed: 0, gagged: 1 },
        ),
      }),
    ]);
    expect(report.chores.open).toEqual({ telegraphed: 4, closed: 2, gagged: 2 });
    expect(summarizeRuns(INPUT, []).chores.meanObjectsBroken).toBe(0);
    expect(summarizeRuns(INPUT, []).chores.byDef).toEqual({});
  });

  it('sums the pots of the abandoned chores over the runs (story 9.5)', () => {
    const report = summarizeRuns(INPUT, [
      run(1, { chores: chores(0, 0, 0, 0, 0, { telegraphed: 3, resolved: 2, boiledOver: 1 }) }),
      run(2, { chores: chores(0, 0, 0, 0, 0, { telegraphed: 1, resolved: 0, boiledOver: 1 }) }),
      run(3, {}),
    ]);
    expect(report.chores.abandoned).toEqual({ telegraphed: 4, resolved: 2, boiledOver: 2 });
  });
});

describe('createRunRecorder', () => {
  it('counts a Firmness let go too soon under its own reason, "released" (story 1.23)', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 1,
    });
    const threatId = sim.world.threats[0]?.id ?? 0;
    const recorder = createRunRecorder(sim, 1, [{ maxSimultaneous: 1 }]);
    recorder.onEvent({
      type: 'ResponseResolved',
      t: asSimMs(0),
      threatId,
      response: 'firm',
      quality: 'fail',
      reason: 'released',
      offsetMs: 0,
      responseWindow: createTestResponseWindow(),
    });
    const tallies = Object.values(recorder.finish().threats);
    expect(tallies).toHaveLength(1);
    expect(tallies[0]?.failReasons).toEqual({
      early: 0,
      late: 0,
      wrongResponse: 0,
      released: 1,
      acted: 0,
    });
  });

  it('counts the responses, gags and near misses of the events it is given', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 1,
    });
    const threatId = sim.world.threats[0]?.id ?? 0;
    const recorder = createRunRecorder(sim, 1, [{ maxSimultaneous: 1 }]);
    const resolved = (quality: 'perfect' | 'fail', offsetMs: number | null): SimEvent => ({
      type: 'ResponseResolved',
      t: asSimMs(0),
      threatId,
      response: 'parry',
      quality,
      ...(quality === 'fail' ? { reason: 'late' as const } : {}),
      offsetMs,
      responseWindow: createTestResponseWindow(),
    });
    recorder.onEvent(resolved('perfect', -20));
    recorder.onEvent(resolved('fail', null));
    recorder.onEvent({
      type: 'GagTriggered',
      t: asSimMs(0),
      threatId,
      gag: 'outlet_hair',
      reason: 'late',
    });
    recorder.onEvent({ type: 'NearMiss', t: asSimMs(0), threatId, gag: 'stairs_slide' });
    // The photo's near miss is counted on its own, never as one of play (story 3.6).
    recorder.onEvent({ type: 'NearMissFrozen', t: asSimMs(0), threatId, gag: 'stairs_slide' });
    const summary = recorder.finish();
    expect(summary).toMatchObject({
      seed: 1,
      responses: 2,
      gags: 1,
      nearMisses: 1,
      frozenNearMisses: 1,
      commands: 0,
      byGag: { outlet_hair: 1 },
    });
    expect(summary.threats.outlet).toMatchObject({
      responses: 2,
      perfect: 1,
      fail: 1,
      failReasons: { late: 1 },
      absOffsetSumMs: 20,
      offsetCount: 1,
    });
    expect(summary.worldHash).toMatch(/^[0-9a-f]{14}$/);
    // No `LevelScored`: a run cut before the end has no note.
    expect(summary).toMatchObject({
      isEnded: false,
      endReason: null,
      mamaWokeAtMs: null,
      scorePoints: null,
      stars: null,
      lostStars: null,
      rows: null,
    });
  });

  it('keeps the score and stars of LevelScored (story 1.22)', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 1,
    });
    const recorder = createRunRecorder(sim, 1);
    recorder.onEvent({ type: 'LevelEnded', t: asSimMs(0), reason: 'timer' });
    recorder.onEvent({
      type: 'LevelScored',
      t: asSimMs(0),
      laughPoints: 30,
      calmPoints: 15,
      homePoints: 0,
      sighPoints: 5,
      screamPoints: 3,
      scorePoints: 72,
      stars: 3,
      lostStars: 0,
    });
    expect(recorder.finish()).toMatchObject({
      isEnded: true,
      endReason: 'timer',
      mamaWokeAtMs: null,
      mamaHomeAtMs: null,
      catastrophePeakPct: 0,
      scorePoints: 72,
      stars: 3,
      lostStars: 0,
      rows: { laughPoints: 30, calmPoints: 15, homePoints: 0, sighPoints: 5, screamPoints: 3 },
    });
  });

  it('keeps the reason, the MamaWoke time and the lost stars of a woken Mama (story 3.2)', async () => {
    const content = createTestContent();
    // A phone loud enough that its first ring tick fills the gauge: Mama really wakes, no SetNoise.
    content.feel.noise.sources.phoneRinging.perSec = 200;
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({
        durationMs: 60_000,
        waves: [testWave([], { disruptions: [testPhoneEntry(0)] })],
        objects: TEST_OBJECTS,
        gauges: NOISE_GAUGES,
      }),
      seed: 1,
    });
    const recorder = createRunRecorder(sim, 1);
    for (let i = 0; i < 1000 && sim.world.flow.state === 'playing'; i++) {
      sim.step();
      for (const event of sim.drainEvents()) recorder.onEvent(event);
    }
    const summary = recorder.finish();
    expect(sim.world.flow.state).toBe('ended');
    expect(summary).toMatchObject({
      isEnded: true,
      endReason: 'mamaWoke',
      mamaWokeAtMs: sim.world.flow.enteredAt,
      lostStars: sim.world.score.final?.lostStars,
    });
    expect(summary.lostStars).toBeGreaterThanOrEqual(1);
    expect(summary.mamaWokeAtMs).toBeLessThan(60_000);
    expect(summary.mamaHomeAtMs).toBeNull();
  });

  it('records Mama coming home early: the end time and the peak of the gauge, from the events (story 3.16)', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 1,
    });
    const recorder = createRunRecorder(sim, 1);
    sim.step();
    sim.drainEvents();
    sim.enqueue({ type: 'SetCatastrophe', t: asSimMs(sim.world.time.sim), pct: 70 });
    sim.step();
    for (const event of sim.drainEvents()) recorder.onEvent(event);
    sim.enqueue({ type: 'SetCatastrophe', t: asSimMs(sim.world.time.sim), pct: 100 });
    sim.step();
    for (const event of sim.drainEvents()) recorder.onEvent(event);
    const summary = recorder.finish();
    expect(sim.world.flow.endReason).toBe('mamaHome');
    expect(summary).toMatchObject({
      isEnded: true,
      endReason: 'mamaHome',
      mamaHomeAtMs: sim.world.flow.enteredAt,
      catastrophePeakPct: 100,
      mamaWokeAtMs: null,
      stars: 0,
      lostStars: 0,
    });
  });

  describe('the waves', () => {
    async function recorderOf(limits: { maxSimultaneous: number }[]) {
      const sim = await createSim({
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: botTestLevel(),
        seed: 1,
      });
      return createRunRecorder(sim, 1, limits);
    }
    const telegraph = (threatId: number, waveIndex: number): SimEvent => ({
      type: 'ThreatTelegraphed',
      t: asSimMs(0),
      threatId,
      kind: 'outlet',
      anchorId: 'outlet_01',
      waveIndex,
    });
    const resolved = (threatId: number): SimEvent => ({
      type: 'ResponseResolved',
      t: asSimMs(0),
      threatId,
      response: 'parry',
      quality: 'success',
      offsetMs: 0,
      responseWindow: createTestResponseWindow(),
    });

    it('counts the telegraphs of each wave and the most threats at once', async () => {
      const recorder = await recorderOf([{ maxSimultaneous: 2 }, { maxSimultaneous: 3 }]);
      for (const event of [
        telegraph(1, 0),
        telegraph(2, 0),
        resolved(1),
        resolved(2),
        telegraph(3, 1),
        resolved(3),
      ]) {
        recorder.onEvent(event);
      }
      expect(recorder.finish().waves).toEqual([
        { telegraphs: 2, peakSimultaneous: 2, isOverLimit: false },
        { telegraphs: 1, peakSimultaneous: 1, isOverLimit: false },
      ]);
    });

    it('flags a run that went above the limit of the wave', async () => {
      const recorder = await recorderOf([{ maxSimultaneous: 1 }]);
      recorder.onEvent(telegraph(1, 0));
      recorder.onEvent(telegraph(2, 0));
      expect(recorder.finish().waves).toEqual([
        { telegraphs: 2, peakSimultaneous: 2, isOverLimit: true },
      ]);
    });

    it('ignores a telegraph of no known wave (a threat no wave planned)', async () => {
      const recorder = await recorderOf([{ maxSimultaneous: 1 }]);
      recorder.onEvent(telegraph(1, -1));
      expect(recorder.finish().waves).toEqual([
        { telegraphs: 0, peakSimultaneous: 0, isOverLimit: false },
      ]);
    });

    it('ignores the telegraphs and the results of a threat no wave planned in the active count (story 1.19)', async () => {
      const recorder = await recorderOf([{ maxSimultaneous: 1 }]);
      // A micro-sleep is up while a wave's threat is telegraphed: the wave is not over its limit.
      recorder.onEvent(telegraph(9, -1));
      recorder.onEvent(telegraph(1, 0));
      recorder.onEvent(resolved(9));
      recorder.onEvent(resolved(1));
      recorder.onEvent(telegraph(2, 0));
      recorder.onEvent(resolved(2));
      const summary = recorder.finish();
      expect(summary.waves).toEqual([{ telegraphs: 2, peakSimultaneous: 1, isOverLimit: false }]);
      expect(summary.microSleeps).toBe(1);
    });

    it('does not let the result of a threat no wave planned free a slot of the active count', async () => {
      // Without the guard the micro-sleep's result would drop the count to 0 while the wave's
      // threat 1 is still up, and the second wave threat would not be seen over the limit of 1.
      const recorder = await recorderOf([{ maxSimultaneous: 1 }]);
      recorder.onEvent(telegraph(1, 0));
      recorder.onEvent(telegraph(9, -1));
      recorder.onEvent(resolved(9));
      recorder.onEvent(telegraph(2, 0));
      expect(recorder.finish().waves).toEqual([
        { telegraphs: 2, peakSimultaneous: 2, isOverLimit: true },
      ]);
    });

    it('counts the coffees and the papa_asleep gags', async () => {
      const recorder = await recorderOf([]);
      recorder.onEvent({ type: 'CoffeeDrunk', t: asSimMs(0), fatigue: 30 });
      recorder.onEvent({ type: 'CoffeeDrunk', t: asSimMs(0), fatigue: 10 });
      recorder.onEvent({
        type: 'GagTriggered',
        t: asSimMs(0),
        threatId: 9,
        gag: 'papa_asleep',
        reason: 'late',
      });
      expect(recorder.finish()).toMatchObject({ coffees: 2, asleepGags: 1 });
    });

    it('counts the phone rings, the answers and each second of ringing (story 1.20)', async () => {
      const recorder = await recorderOf([]);
      const phone = { objectId: 'phone', t: asSimMs(0) };
      recorder.onEvent({ type: 'PhoneRingStarted', untilAt: asSimMs(15_000), ...phone });
      for (let i = 0; i < 4; i++) recorder.onEvent({ type: 'PhoneRinging', ...phone });
      recorder.onEvent({ type: 'PhoneRingEnded', reason: 'answered', ...phone });
      recorder.onEvent({ type: 'PhoneAnswered', untilAt: asSimMs(5000), fatigue: 20, ...phone });
      expect(recorder.finish()).toMatchObject({
        phoneRings: 1,
        phoneAnswers: 1,
        phoneRingingSeconds: 4,
      });
    });

    it('keeps the peak and sums the positive change per source from NoiseChanged (story 3.1)', async () => {
      const recorder = await recorderOf([]);
      const changed = (
        source: 'propImpact' | 'phoneRinging' | 'debug',
        noisePct: number,
        deltaPct: number,
      ) => recorder.onEvent({ type: 'NoiseChanged', t: asSimMs(0), source, noisePct, deltaPct });
      changed('propImpact', 12, 12);
      changed('phoneRinging', 14, 2);
      changed('propImpact', 29, 15);
      changed('debug', 5, -24); // a fall: not noise made, the peak stays
      expect(recorder.finish()).toMatchObject({
        noisePeakPct: 29,
        noiseBySourcePct: { ...NO_NOISE, propImpact: 27, phoneRinging: 2 },
      });
    });

    it('reports the final noise of the world, to 0.1, and 0 for a level with no noise gauge', async () => {
      const recorder = await recorderOf([]);
      expect(recorder.finish()).toMatchObject({
        noisePeakPct: 0,
        noiseFinalPct: 0,
        noiseBySourcePct: NO_NOISE,
      });
      const sim = await createSim({
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel({ gauges: NOISE_GAUGES }),
        seed: 1,
      });
      sim.enqueue({ type: 'SetNoise', t: asSimMs(0), pct: 33.37 });
      for (let i = 0; i < 100; i++) sim.step();
      // 33.37 − 1 % over one second of decay = 32.37, to one decimal.
      expect(createRunRecorder(sim, 1).finish().noiseFinalPct).toBe(32.4);
    });

    it('counts the silences, found or not, from their events (story 1.21)', async () => {
      const recorder = await recorderOf([]);
      const silence = { threatId: 4, t: asSimMs(0) };
      recorder.onEvent({ type: 'SilenceStarted', ...silence });
      recorder.onEvent({ type: 'SilenceEnded', reason: 'found', ...silence });
      recorder.onEvent({ type: 'SilenceStarted', ...silence });
      recorder.onEvent({ type: 'SilenceEnded', reason: 'timedOut', ...silence });
      recorder.onEvent({ type: 'SilenceStarted', ...silence });
      recorder.onEvent({ type: 'SilenceEnded', reason: 'levelEnded', ...silence });
      expect(recorder.finish()).toMatchObject({
        silences: 3,
        silencesFound: 1,
        silencesTimedOut: 1,
        silencesCutOff: 1,
      });
    });

    it('counts a silence as one pick of its wave, found or not, for two places (story 3.13): a result with no telegraph before it keeps the active count right', async () => {
      const recorder = await recorderOf([{ maxSimultaneous: 2 }]);
      const hidden = (threatId: number): SimEvent => ({
        type: 'ThreatHidden',
        t: asSimMs(0),
        threatId,
        kind: 'silence_mischief',
        anchorId: 'behind_sofa',
        waveIndex: 0,
      });
      // Picked, never found: hidden, then a result with no telegraph in between.
      recorder.onEvent(hidden(7));
      recorder.onEvent(resolved(7));
      // Picked, found: hidden, then the reveal (not a second pick), then the result.
      recorder.onEvent(hidden(7));
      recorder.onEvent(telegraph(7, 0));
      recorder.onEvent(resolved(7));
      // A plain threat afterwards: the count is back to zero, so it is not over the limit.
      recorder.onEvent(telegraph(8, 0));
      recorder.onEvent(resolved(8));
      const [wave] = recorder.finish().waves;
      expect(wave).toEqual({ telegraphs: 3, peakSimultaneous: 2, isOverLimit: false });
    });

    it('holds a wave over its limit when a silence (two places) and another threat are active in a wave of two, as the director would never let happen', async () => {
      const recorder = await recorderOf([{ maxSimultaneous: 2 }]);
      recorder.onEvent({
        type: 'ThreatHidden',
        t: asSimMs(0),
        threatId: 7,
        kind: 'silence_mischief',
        anchorId: 'behind_sofa',
        waveIndex: 0,
      });
      recorder.onEvent(telegraph(8, 0));
      const [wave] = recorder.finish().waves;
      expect(wave).toEqual({ telegraphs: 2, peakSimultaneous: 3, isOverLimit: true });
    });

    it('knows whether the level ended', async () => {
      const recorder = await recorderOf([]);
      expect(recorder.finish().isEnded).toBe(false);
      recorder.onEvent({ type: 'LevelEnded', t: asSimMs(0), reason: 'timer' });
      expect(recorder.finish().isEnded).toBe(true);
    });
  });
});

describe('the lullaby walk in the report (story 4.5)', () => {
  it('counts each beat event under its own field, none under another', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 5,
    });
    const recorder = createRunRecorder(sim, 1, [{ maxSimultaneous: 1 }]);
    // 3 hits, 2 misses, 4 decoy taps, 1 stray: distinct, so a swap shows.
    for (let i = 0; i < 3; i++) {
      recorder.onEvent({ type: 'BeatHit', t: asSimMs(0), judgedIndex: i, offsetMs: 0 });
    }
    for (let i = 0; i < 2; i++) {
      recorder.onEvent({ type: 'BeatMissed', t: asSimMs(0), judgedIndex: i });
    }
    for (let i = 0; i < 4; i++)
      recorder.onEvent({ type: 'DecoyTapped', t: asSimMs(0), entryIndex: i });
    recorder.onEvent({ type: 'BeatStrayTapped', t: asSimMs(0) });
    expect(recorder.finish()).toMatchObject({
      beatsHit: 3,
      beatsMissed: 2,
      decoysTapped: 4,
      beatsStray: 1,
    });
  });

  it('adds the runs up field by field', () => {
    const report = summarizeRuns(INPUT, [
      run(5, { beatsHit: 10, beatsMissed: 1, decoysTapped: 2, beatsStray: 3 }),
      run(6, { beatsHit: 20, beatsMissed: 4, decoysTapped: 5, beatsStray: 6 }),
    ]);
    expect(report).toMatchObject({
      beatsHit: 30,
      beatsMissed: 5,
      decoysTapped: 7,
      beatsStray: 9,
    });
    expect(report.runList.map((entry) => entry.beatsMissed)).toEqual([1, 4]);
  });
});

describe('a level that carries the baby (story 4.1)', () => {
  const carryLevel = () =>
    createTestLevel({
      waves: [testWave([OUTLET], { gapMinMs: 4000, gapMaxMs: 4000 })],
      gauges: FATIGUE_GAUGES,
      carry: CARRY,
    });

  async function recorder(waves = [{ maxSimultaneous: 1 }]) {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: carryLevel(),
      seed: 1,
    });
    return { sim, recorder: createRunRecorder(sim, 1, waves, 'arms_cry') };
  }

  const telegraphed = (threatId: number, kind: string, waveIndex: number): SimEvent => ({
    type: 'ThreatTelegraphed',
    t: asSimMs(0),
    threatId,
    kind,
    anchorId: 'outlet_01',
    waveIndex,
  });

  it('counts a cry in the arms as such, not as a micro-sleep, and keeps it out of the waves', async () => {
    const { recorder: rec } = await recorder();
    rec.onEvent(telegraphed(9, 'arms_cry', -1));
    rec.onEvent(telegraphed(8, 'papa_microsleep', -1));
    const summary = rec.finish();
    expect(summary).toMatchObject({ armsCries: 1, microSleeps: 1 });
    expect(summary.waves).toEqual([{ telegraphs: 0, peakSimultaneous: 0, isOverLimit: false }]);
  });

  it('counts the pick-ups, the put-downs and the safe ones', async () => {
    const { recorder: rec } = await recorder();
    rec.onEvent({ type: 'BabyPickedUp', t: asSimMs(0) });
    rec.onEvent({ type: 'BabyPutDown', t: asSimMs(0), safe: false });
    rec.onEvent({ type: 'BabyPickedUp', t: asSimMs(0) });
    rec.onEvent({ type: 'BabyPutDown', t: asSimMs(0), safe: true });
    expect(rec.finish()).toMatchObject({ babyPickUps: 2, babyPutDowns: 2, safePutDowns: 1 });
  });

  it('counts the combos cashed in, their points and the highest multiplier (story 4.2)', async () => {
    const { recorder: rec } = await recorder();
    expect(rec.finish()).toMatchObject({
      comboCashIns: 0,
      comboPointsCashed: 0,
      comboPeakMultiplier: 0,
    });
    rec.onEvent({ type: 'ComboChanged', t: asSimMs(10), multiplier: 2, reason: 'response' });
    rec.onEvent({ type: 'ComboChanged', t: asSimMs(20), multiplier: 3, reason: 'carryTick' });
    rec.onEvent({ type: 'ComboChanged', t: asSimMs(30), multiplier: 1, reason: 'gag' });
    rec.onEvent({
      type: 'ComboCashedIn',
      t: asSimMs(40),
      multiplier: 3,
      basePoints: 1.5,
      points: 4.5,
    });
    rec.onEvent({ type: 'ComboCashedIn', t: asSimMs(50), multiplier: 2, basePoints: 1, points: 2 });
    expect(rec.finish()).toMatchObject({
      comboCashIns: 2,
      comboPointsCashed: 6.5,
      comboPeakMultiplier: 3,
    });
  });

  it('takes a cancelled wave threat out of the count at once, so the next one is not over the limit', async () => {
    const { recorder: rec } = await recorder();
    rec.onEvent(telegraphed(7, 'outlet', 0));
    rec.onEvent({ type: 'ThreatCancelled', t: asSimMs(0), threatId: 7, reason: 'carried' });
    // Without the −1 this second one would count as two at once, over the limit of 1.
    rec.onEvent(telegraphed(7, 'outlet', 0));
    const summary = rec.finish();
    expect(summary.cancelledThreats).toBe(1);
    expect(summary.waves).toEqual([{ telegraphs: 2, peakSimultaneous: 1, isOverLimit: false }]);
  });

  it('leaves the count alone for a cancelled system threat (the cry in the arms)', async () => {
    const { recorder: rec } = await recorder();
    rec.onEvent(telegraphed(7, 'outlet', 0));
    rec.onEvent(telegraphed(9, 'arms_cry', -1));
    rec.onEvent({ type: 'ThreatCancelled', t: asSimMs(0), threatId: 9, reason: 'putDown' });
    rec.onEvent({ type: 'ThreatCancelled', t: asSimMs(0), threatId: 7, reason: 'carried' });
    rec.onEvent(telegraphed(7, 'outlet', 0));
    expect(rec.finish().waves[0]?.isOverLimit).toBe(false);
  });

  it('counts the toilet visits and reads the need peak from the world (story 4.3)', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({ objects: [...TEST_OBJECTS, TEST_TOILET], gauges: NEED_GAUGES }),
      seed: 1,
    });
    const rec = createRunRecorder(sim, 1);
    expect(rec.finish()).toMatchObject({ toiletVisits: 0, bladderPeakPct: 0 });
    sim.enqueue({ type: 'SetBladder', t: asSimMs(0), pct: 80 });
    sim.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'toilet' });
    let visits = 0;
    for (let i = 0; i < 6000 && visits === 0; i++) {
      sim.step();
      for (const event of sim.drainEvents()) {
        rec.onEvent(event);
        if (event.type === 'ToiletFinished') visits++;
      }
    }
    // The peak is what the world held when the visit started (frozen from then on), not the 0.0x
    // it holds just after the reset.
    const summary = rec.finish();
    expect(summary.toiletVisits).toBe(1);
    expect(summary.bladderPeakPct).toBeGreaterThanOrEqual(80);
    expect(summary.bladderPeakPct).toBeLessThan(100);
    expect(sim.world.gauges.bladderPct).toBeLessThan(1);
  });

  it('reads 100 as the peak once the need has filled, and the final value of a run that never visits', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({ objects: [...TEST_OBJECTS, TEST_TOILET], gauges: NEED_GAUGES }),
      seed: 1,
    });
    const rec = createRunRecorder(sim, 1);
    sim.enqueue({ type: 'SetBladder', t: asSimMs(0), pct: 100 });
    sim.step();
    for (const event of sim.drainEvents()) rec.onEvent(event);
    expect(rec.finish()).toMatchObject({ toiletVisits: 0, bladderPeakPct: 100 });
    const quiet = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({ gauges: NEED_GAUGES }),
      seed: 1,
    });
    const quietRec = createRunRecorder(quiet, 1);
    for (let i = 0; i < 1000; i++) quiet.step();
    // 10 s at the frozen feel's rate, to one decimal.
    expect(quietRec.finish().bladderPeakPct).toBeCloseTo(
      createTestContent().feel.bladder.perSec * 10,
      1,
    );
  });

  it('sums the visits over the runs and keeps the highest need peak', () => {
    const report = summarizeRuns(INPUT, [
      run(1, { toiletVisits: 1, bladderPeakPct: 60.4 }),
      run(2, { toiletVisits: 2, bladderPeakPct: 72 }),
      run(3, { toiletVisits: 0, bladderPeakPct: 12.3 }),
    ]);
    expect(report).toMatchObject({ toiletVisits: 3, bladderPeakPct: 72 });
  });

  it('counts the instincts triggered per run and sums them over the runs (story 2.9)', async () => {
    const { recorder: rec } = await recorder();
    expect(rec.finish()).toMatchObject({ instinctTriggers: 0 });
    rec.onEvent({ type: 'InstinctTriggered', t: asSimMs(100), untilAt: asSimMs(4100) });
    rec.onEvent({ type: 'InstinctEnded', t: asSimMs(4100), reason: 'timer' });
    rec.onEvent({ type: 'InstinctTriggered', t: asSimMs(40_000), untilAt: asSimMs(44_000) });
    expect(rec.finish()).toMatchObject({ instinctTriggers: 2 });
    const report = summarizeRuns(INPUT, [
      run(1, { instinctTriggers: 2 }),
      run(2, { instinctTriggers: 0 }),
      run(3, { instinctTriggers: 1 }),
    ]);
    expect(report).toMatchObject({ instinctTriggers: 3 });
  });

  it('sums the combo counters over the runs and keeps the highest peak', () => {
    const report = summarizeRuns(INPUT, [
      run(1, { comboCashIns: 1, comboPointsCashed: 4.5, comboPeakMultiplier: 3 }),
      run(2, { comboCashIns: 2, comboPointsCashed: 8, comboPeakMultiplier: 5 }),
      run(3, { comboCashIns: 0, comboPointsCashed: 0, comboPeakMultiplier: 0 }),
    ]);
    expect(report).toMatchObject({
      comboCashIns: 3,
      comboPointsCashed: 12.5,
      comboPeakMultiplier: 5,
    });
  });

  it('sums the counters over the runs in the report', () => {
    const report = summarizeRuns(INPUT, [
      run(1, {
        babyPickUps: 2,
        babyPutDowns: 1,
        safePutDowns: 1,
        armsCries: 3,
        cancelledThreats: 1,
      }),
      run(2, {
        babyPickUps: 1,
        babyPutDowns: 1,
        safePutDowns: 0,
        armsCries: 0,
        cancelledThreats: 2,
      }),
    ]);
    expect(report).toMatchObject({
      babyPickUps: 3,
      babyPutDowns: 2,
      safePutDowns: 1,
      armsCries: 3,
      cancelledThreats: 3,
    });
  });
});

describe('createRunRecorder › chores (story 9.4)', () => {
  const judged = (quality: 'perfect' | 'success' | 'fail', t = 0): SimEvent => ({
    type: 'ChoreBeatJudged',
    t: asSimMs(t),
    choreIndex: 0,
    beatIndex: 0,
    quality,
    reason: quality === 'fail' ? 'late' : null,
    offsetMs: quality === 'fail' ? 400 : 0,
  });

  it('counts the beats judged by quality and the chores completed with their points', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 1,
    });
    const recorder = createRunRecorder(sim, 1);
    for (const quality of ['perfect', 'success', 'fail', 'perfect', 'fail', 'fail'] as const) {
      recorder.onEvent(judged(quality));
    }
    recorder.onEvent({ type: 'ChoreCompleted', t: asSimMs(0), choreIndex: 0, homePoints: 7.5 });
    recorder.onEvent({ type: 'ChoreCompleted', t: asSimMs(0), choreIndex: 1, homePoints: 2.5 });
    expect(recorder.finish().chores).toEqual({
      beats: { perfect: 2, success: 1, fail: 3 },
      completed: 2,
      homePoints: 10,
      abandoned: { telegraphed: 0, resolved: 0, boiledOver: 0 },
      // The level has no chore def to put them under, and no door.
      byDef: {},
      objectsBroken: 0,
      open: { telegraphed: 0, closed: 0, gagged: 0 },
    });
  });

  it('counts a pot telegraphed, lowered in time and boiled over, and never as a micro-sleep (story 9.5)', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 1,
    });
    const threatId = sim.world.threats[0]?.id ?? 0;
    const defId = sim.world.threats[0]?.defId ?? '';
    // The first threat of the level stands in for the pot: the recorder is told it is one.
    const recorder = createRunRecorder(sim, 1, [], null, new Set(), null, new Set([defId]));
    const telegraphed = (): SimEvent => ({
      type: 'ThreatTelegraphed',
      t: asSimMs(0),
      threatId,
      kind: defId,
      anchorId: 'stove',
      waveIndex: -1,
    });
    const resolved = (quality: 'perfect' | 'fail'): SimEvent =>
      quality === 'fail'
        ? {
            type: 'ResponseResolved',
            t: asSimMs(0),
            threatId,
            response: 'parry',
            quality,
            reason: 'late',
            offsetMs: null,
            responseWindow: { windowMs: 0, perfectMs: 0, toleranceMs: 0, bufferMs: 0 },
          }
        : {
            type: 'ResponseResolved',
            t: asSimMs(0),
            threatId,
            response: 'parry',
            quality,
            offsetMs: 0,
            responseWindow: { windowMs: 0, perfectMs: 0, toleranceMs: 0, bufferMs: 0 },
          };
    recorder.onEvent(telegraphed());
    recorder.onEvent(resolved('perfect'));
    recorder.onEvent(telegraphed());
    recorder.onEvent(resolved('fail'));
    recorder.onEvent({
      type: 'GagTriggered',
      t: asSimMs(0),
      threatId,
      gag: 'pot_boiled_over',
      reason: 'late',
    });
    const summary = recorder.finish();
    expect(summary.chores.abandoned).toEqual({ telegraphed: 2, resolved: 1, boiledOver: 1 });
    expect(summary.microSleeps).toBe(0);
  });

  it('counts nothing for a game that never touches a station', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: 1,
    });
    expect(createRunRecorder(sim, 1).finish().chores).toEqual({
      beats: { perfect: 0, success: 0, fail: 0 },
      completed: 0,
      homePoints: 0,
      abandoned: { telegraphed: 0, resolved: 0, boiledOver: 0 },
      byDef: {},
      objectsBroken: 0,
      open: { telegraphed: 0, closed: 0, gagged: 0 },
    });
  });
});

describe('createRunRecorder › the dishwasher (story 9.6)', () => {
  async function kitchen() {
    return createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({
        waves: [testWave([DISHWASHER_OPEN], { fromMs: 500_000 })],
        objects: [...TEST_OBJECTS, TEST_STOVE, TEST_DISHWASHER],
        chores: [TEST_COOKING, TEST_UNLOAD_DISHWASHER],
      }),
      seed: 1,
    });
  }
  const judged = (choreIndex: number, quality: 'perfect' | 'success' | 'fail'): SimEvent => ({
    type: 'ChoreBeatJudged',
    t: asSimMs(0),
    choreIndex,
    beatIndex: 0,
    quality,
    reason: quality === 'fail' ? 'late' : null,
    offsetMs: quality === 'fail' ? 400 : 0,
  });

  it('lists every chore def of the level from the start, with nothing counted', async () => {
    const sim = await kitchen();
    expect(createRunRecorder(sim, 1).finish().chores).toEqual({
      beats: { perfect: 0, success: 0, fail: 0 },
      completed: 0,
      homePoints: 0,
      abandoned: { telegraphed: 0, resolved: 0, boiledOver: 0 },
      byDef: {
        cooking: { completed: 0, beats: { perfect: 0, success: 0, fail: 0 } },
        unload_dishwasher: { completed: 0, beats: { perfect: 0, success: 0, fail: 0 } },
      },
      objectsBroken: 0,
      open: { telegraphed: 0, closed: 0, gagged: 0 },
    });
  });

  it('counts the beats under their def, and a plate only for a def that breaks them', async () => {
    const sim = await kitchen();
    const plates = sim.chores[1]?.def.missBrokenObjects as number;
    expect(plates).toBeGreaterThan(0);
    const recorder = createRunRecorder(sim, 1);
    for (const event of [
      judged(0, 'perfect'),
      judged(0, 'fail'),
      judged(1, 'success'),
      judged(1, 'fail'),
      judged(1, 'fail'),
    ]) {
      recorder.onEvent(event);
    }
    recorder.onEvent({ type: 'ChoreCompleted', t: asSimMs(0), choreIndex: 1, homePoints: 7.5 });
    const { byDef, objectsBroken, completed } = recorder.finish().chores;
    expect(byDef.cooking).toEqual({ completed: 0, beats: { perfect: 1, success: 0, fail: 1 } });
    expect(byDef.unload_dishwasher).toEqual({
      completed: 1,
      beats: { perfect: 0, success: 1, fail: 2 },
    });
    // Two dishwasher misses, none counted for the cooking's.
    expect(objectsBroken).toBe(2 * plates);
    expect(completed).toBe(1);
  });

  it('counts the open door telegraphed, closed in time and got into, by the threat that stands at it', async () => {
    const sim = await kitchen();
    const doorIndex = sim.chores[1]?.openThreatIndex as number;
    const door = sim.world.threats[doorIndex]!;
    const recorder = createRunRecorder(sim, 1, [{ maxSimultaneous: 1 }]);
    const telegraph = (): SimEvent => ({
      type: 'ThreatTelegraphed',
      t: asSimMs(0),
      threatId: door.id,
      kind: door.defId,
      anchorId: door.anchorId,
      waveIndex: 0,
    });
    const resolved = (quality: 'perfect' | 'success' | 'fail'): SimEvent => ({
      type: 'ResponseResolved',
      t: asSimMs(0),
      threatId: door.id,
      response: 'parry',
      quality,
      offsetMs: 0,
      responseWindow: { windowMs: 400, perfectMs: 100, toleranceMs: 50, bufferMs: 50 },
    });
    recorder.onEvent(telegraph());
    recorder.onEvent(resolved('perfect'));
    recorder.onEvent(telegraph());
    recorder.onEvent(resolved('success'));
    recorder.onEvent(telegraph());
    recorder.onEvent(resolved('fail'));
    recorder.onEvent({
      type: 'GagTriggered',
      t: asSimMs(0),
      threatId: door.id,
      gag: 'baby_in_dishwasher',
      reason: 'late',
    });
    expect(recorder.finish().chores.open).toEqual({ telegraphed: 3, closed: 2, gagged: 1 });
  });
});

describe('summarizeRuns › visibility (story 9.8)', () => {
  const sight = (patch: Partial<VisibilityCounters>): VisibilityCounters => ({
    telegraphs: 0,
    seenOffscreen: 0,
    cappedMs: 0,
    neverSeen: 0,
    seenLate: 0,
    seenLateDelayMs: 0,
    ...patch,
  });

  it('sums the human bot’s counters over the runs, and averages the delay over the threats seen late', () => {
    const report = summarizeRuns(INPUT, [
      run(1, {
        visibility: sight({
          telegraphs: 10,
          seenOffscreen: 2,
          cappedMs: 150,
          neverSeen: 1,
          seenLate: 2,
          seenLateDelayMs: 200,
        }),
      }),
      run(2, {
        visibility: sight({
          telegraphs: 6,
          seenOffscreen: 1,
          cappedMs: 0,
          neverSeen: 0,
          seenLate: 1,
          seenLateDelayMs: 130,
        }),
      }),
    ]);
    expect(report.visibility).toEqual({
      telegraphs: 16,
      seenOffscreen: 3,
      cappedMs: 150,
      neverSeen: 1,
      meanSeenDelayMs: 110,
    });
  });

  it('has no mean delay when nothing was seen late', () => {
    const report = summarizeRuns(INPUT, [run(1, { visibility: sight({ telegraphs: 4 }) })]);
    expect(report.visibility).toEqual({
      telegraphs: 4,
      seenOffscreen: 0,
      cappedMs: 0,
      neverSeen: 0,
      meanSeenDelayMs: null,
    });
  });

  it('is null for a bot with no sight, in a fixed level, and with no run at all', () => {
    expect(summarizeRuns(INPUT, [run(1), run(2)]).visibility).toBeNull();
    expect(summarizeRuns(INPUT, []).visibility).toBeNull();
    // Mixed runs cannot happen in one batch; a missing block is never read as zeros.
    expect(
      summarizeRuns(INPUT, [run(1, { visibility: sight({ telegraphs: 1 }) }), run(2)]).visibility,
    ).toBeNull();
  });
});
