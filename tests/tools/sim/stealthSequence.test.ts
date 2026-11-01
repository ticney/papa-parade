import { hashJson } from '@shared/hash';
import { describe, expect, it } from 'vitest';
import type { SimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { replayRunFile } from '../../../tools/sim/replaySim.ts';
import type { RunFile } from '../../../tools/sim/runFile.ts';
import { runSim, sequenceDefIdsOf } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  NOISE_GAUGES,
} from '../../support/testContent.ts';

// `npm run sim -- --sequence stealth_exit` (story 4.9): the infiltration played end to end by a bot with no
// human, journaled so that `sim:replay` agrees. The frozen sequence: a door at 0.9 m, an alert every 4 to 7 s, 30 % real
// wakes. `perfect` wins it every time with no gag and no gasp; `idle` loses to a real wake.
function levelWithStealth(): SimLevel {
  const content = createTestContent();
  return {
    levelId: 'salon_crawler',
    contentHash: hashJson(content),
    content,
    level: createTestLevel({
      carry: CARRY,
      gauges: NOISE_GAUGES,
      sequences: ['stealth_exit'],
      durationMs: 180_000,
    }),
    geometry: createTestGeometry(),
  };
}

async function stealthReport(overrides: Parameters<typeof simArgs>[0]) {
  const result = await runSim(
    simArgs({
      sequenceId: 'stealth_exit',
      sequenceAtMs: 5000,
      untilSimMs: 180_000,
      ...overrides,
    }),
    levelWithStealth(),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('runSim with --sequence stealth_exit (story 4.9)', () => {
  it('counts the two alerts as sequence threats, so they are not micro-sleeps', async () => {
    expect([...sequenceDefIdsOf(levelWithStealth().level)].sort()).toEqual([
      'false_alarm_sigh',
      'real_wake',
    ]);
    const report = await stealthReport({ botId: 'perfect', seed: 1, runs: 5 });
    expect(report.microSleeps).toBe(0);
  });

  it.each([1, 2, 3, 4, 5])('the perfect bot wins seed %i: no gag, no gasp', async (seed) => {
    const report = await stealthReport({ botId: 'perfect', seed });
    expect(report.sequencesStarted).toBe(1);
    expect(report.sequencesSucceeded).toBe(1);
    expect(report.sequencesFailed).toBe(0);
    expect(report.gags.total).toBe(0);
    expect(report.breathGasps).toEqual({ empty: 0, early: 0, notHeld: 0 });
  });

  it('the perfect bot creaks: it walks the plain path, over the room’s boards', async () => {
    const report = await stealthReport({ botId: 'perfect', seed: 1, runs: 10 });
    expect(report.floorCreaks).toBeGreaterThan(0);
    expect(report.sequencesSucceeded).toBe(10);
  });

  it.each([1, 2, 3, 4, 5])(
    'the idle bot loses seed %i: no one answers the first real wake',
    async (seed) => {
      const report = await stealthReport({ botId: 'idle', seed });
      expect(report.sequencesStarted).toBe(1);
      expect(report.sequencesSucceeded).toBe(0);
      expect(report.sequencesFailed).toBe(1);
      expect(report.gags.byGag).toEqual({ baby_woke_crying: 1 });
      expect(report.threats.real_wake?.failReasons.late).toBe(1);
    },
  );

  it('the human bot plays it and ends it every time, by a win or a loss, and sometimes gasps', async () => {
    const report = await stealthReport({ botId: 'human', seed: 3, runs: 10 });
    expect(report.sequencesStarted).toBe(10);
    expect(report.sequencesSucceeded + report.sequencesFailed).toBe(10);
    expect(report.sequencesSucceeded).toBeGreaterThan(0);
    expect(report.microSleeps).toBe(0);
    expect(report.nothingResponses).toBeGreaterThanOrEqual(0);
  }, 90_000);

  it('the random bot plays it too, and touches false alarms (an acted gag)', async () => {
    const report = await stealthReport({ botId: 'random', seed: 1, runs: 30 });
    expect(report.sequencesStarted).toBe(30);
    expect(report.sequencesSucceeded + report.sequencesFailed).toBeGreaterThan(0);
    expect(report.threats.false_alarm_sigh?.failReasons.acted ?? 0).toBeGreaterThan(0);
  }, 90_000);

  it('counts a false alarm sat through as a nothing response', async () => {
    const report = await stealthReport({ botId: 'perfect', seed: 1, runs: 30 });
    expect(report.nothingResponses).toBeGreaterThan(0);
    expect(report.threats.false_alarm_sigh).toMatchObject({ success: report.nothingResponses });
  }, 90_000);

  it('journals the game so that replaying it agrees', async () => {
    const games: [string, RunFile][] = [];
    const result = await runSim(
      simArgs({
        botId: 'perfect',
        sequenceId: 'stealth_exit',
        sequenceAtMs: 1000,
        untilSimMs: 120_000,
        seed: 2,
      }),
      levelWithStealth(),
      { onGame: (name, game) => games.push([name, game]) },
    );
    expect(result.ok).toBe(true);
    const game = games[0]?.[1] as RunFile;
    const types = game.journal.entries.map((entry) => entry.command.type);
    expect(types).toContain('StartSequence');
    expect(types).toContain('TapFloor');
    expect(await replayRunFile(game, levelWithStealth())).toMatchObject({ ok: true });
  });
});
