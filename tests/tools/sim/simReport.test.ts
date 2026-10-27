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
};

function run(seed: number, overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    seed,
    worldHash: `hash${seed}`,
    responses: 0,
    gags: 0,
    nearMisses: 0,
    commands: 0,
    threats: {},
    byGag: {},
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
    expect(report.meanScore).toBeNull();
    expect(report.scoreNote).toContain('1.22');
    expect(report.runList).toEqual([
      { seed: 5, worldHash: 'hash5', responses: 3, gags: 1, commands: 6 },
    ]);
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
    const recorder = createRunRecorder(sim, 1);
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
  });
});
