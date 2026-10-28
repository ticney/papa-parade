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
import { createTestContent, createTestGeometry } from '../../support/testContent.ts';

const INPUT = {
  level: 'salon_crawler',
  bot: 'human',
  seed: 5,
  untilSimMs: 1000,
  hashes: { feel: 'f', geometry: 'g', level: 'l', bots: 'b' },
  waves: [] as { fromMs: number; maxSimultaneous: number }[],
};

const WAVES = [
  { fromMs: 0, maxSimultaneous: 1 },
  { fromMs: 60000, maxSimultaneous: 2 },
];

function run(seed: number, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    seed,
    worldHash: `hash${seed}`,
    responses: 0,
    gags: 0,
    nearMisses: 0,
    microSleeps: 0,
    coffees: 0,
    asleepGags: 0,
    phoneRings: 0,
    phoneAnswers: 0,
    phoneRingingSeconds: 0,
    silences: 0,
    silencesFound: 0,
    silencesTimedOut: 0,
    silencesCutOff: 0,
    commands: 0,
    threats: {},
    byGag: {},
    waves: [],
    isEnded: false,
    scorePoints: null,
    stars: null,
    ...overrides,
  };
}

const tally = (overrides: Partial<RunSummary['threats'][string]> = {}) => ({
  responses: 0,
  perfect: 0,
  success: 0,
  fail: 0,
  failReasons: { early: 0, late: 0, wrongResponse: 0 },
  absOffsetSumMs: 0,
  offsetCount: 0,
  ...overrides,
});

describe('summarizeRuns', () => {
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
            failReasons: { early: 0, late: 1, wrongResponse: 0 },
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
      failReasons: { early: 0, late: 1, wrongResponse: 0 },
      meanAbsOffsetMs: 15,
    });
    expect(report.meanSuccessPct).toBe(66.7);
    expect(report.gags).toEqual({
      total: 1,
      meanPerRun: 1,
      byGag: { outlet_hair: 1 },
      nearMisses: 1,
    });
    // No run ended: no score, and no star count.
    expect(report.meanScore).toBeNull();
    expect(report.meanStars).toBeNull();
    expect(report.starCounts).toEqual([0, 0, 0, 0, 0, 0]);
    expect(report.runList).toEqual([
      {
        seed: 5,
        worldHash: 'hash5',
        responses: 3,
        gags: 1,
        commands: 6,
        scorePoints: null,
        stars: null,
      },
    ]);
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

describe('createRunRecorder', () => {
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
    const summary = recorder.finish();
    expect(summary).toMatchObject({
      seed: 1,
      responses: 2,
      gags: 1,
      nearMisses: 1,
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
    expect(summary).toMatchObject({ isEnded: false, scorePoints: null, stars: null });
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
      babyStatePoints: 20,
      sighPoints: 5,
      screamPoints: 3,
      scorePoints: 72,
      stars: 3,
    });
    expect(recorder.finish()).toMatchObject({ isEnded: true, scorePoints: 72, stars: 3 });
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

    it('counts a silence as one pick of its wave, found or not: a result with no telegraph before it keeps the active count right', async () => {
      const recorder = await recorderOf([{ maxSimultaneous: 1 }]);
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
      expect(wave).toEqual({ telegraphs: 3, peakSimultaneous: 1, isOverLimit: false });
    });

    it('knows whether the level ended', async () => {
      const recorder = await recorderOf([]);
      expect(recorder.finish().isEnded).toBe(false);
      recorder.onEvent({ type: 'LevelEnded', t: asSimMs(0), reason: 'timer' });
      expect(recorder.finish().isEnded).toBe(true);
    });
  });
});
