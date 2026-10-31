import { hashJson } from '@shared/hash';
import { describe, expect, it } from 'vitest';
import type { SimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { replayRunFile } from '../../../tools/sim/replaySim.ts';
import type { RunFile } from '../../../tools/sim/runFile.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';
import {
  CARRY,
  createTestBedtimeDuel,
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../support/testContent.ts';

// `npm run sim -- --sequence bedtime_duel` (story 4.6): the golden rule, a duel played end to end by a
// bot with no human, journaled so that `sim:replay` agrees. The frozen def: three rounds, three
// retreats to lose; the frozen eyes wait 2 to 4 s for the signal.
const DEF = createTestBedtimeDuel();
const MAX_RETREATS = DEF.failure.kind === 'retreats' ? DEF.failure.maxRetreats : Number.NaN;

function levelWithDuel(): SimLevel {
  const content = createTestContent();
  return {
    levelId: 'salon_crawler',
    contentHash: hashJson(content),
    content,
    level: createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'], durationMs: 120_000 }),
    geometry: createTestGeometry(),
  };
}

async function duelReport(overrides: Parameters<typeof simArgs>[0]) {
  const result = await runSim(
    simArgs({ sequenceId: 'bedtime_duel', sequenceAtMs: 1000, untilSimMs: 120_000, ...overrides }),
    levelWithDuel(),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('runSim with --sequence bedtime_duel (story 4.6)', () => {
  it.each([1, 2, 3, 4, 5])(
    'the perfect bot wins it on seed %i, with no retreat and every response perfect',
    async (seed) => {
      const report = await duelReport({ botId: 'perfect', seed });
      expect(report.sequencesStarted).toBe(1);
      expect(report.sequencesSucceeded).toBe(1);
      expect(report.sequencesFailed).toBe(0);
      expect(report.sequenceRetreats).toBe(0);
      expect(report.gags.total).toBe(0);
      expect(report.threats.bedtime_eyes).toMatchObject({
        responses: DEF.steps.length,
        perfect: DEF.steps.length,
        success: 0,
        fail: 0,
      });
      // The duel's threat is not counted as a micro-sleep. (The baby stays carried after a sequence
      // and the bots never put him down, 4.10's: the cries in the arms go on and are not this test's.)
      expect(report.microSleeps).toBe(0);
    },
  );

  it.each([1, 2, 3, 4, 5])(
    'the idle bot loses it on seed %i, on its third failure: two retreats, then the baby wakes',
    async (seed) => {
      const report = await duelReport({ botId: 'idle', seed });
      expect(report.sequencesStarted).toBe(1);
      expect(report.sequencesSucceeded).toBe(0);
      expect(report.sequencesFailed).toBe(1);
      // The failure that ends the sequence is not a retreat: `outcome` says it.
      expect(report.sequenceRetreats).toBe(MAX_RETREATS - 1);
      expect(report.threats.bedtime_eyes).toMatchObject({
        responses: MAX_RETREATS,
        fail: MAX_RETREATS,
        perfect: 0,
        success: 0,
      });
    },
  );

  it('the human bot plays it: it never presses before the signal, so it never gags early', async () => {
    const report = await duelReport({ botId: 'human', seed: 3, runs: 10 });
    expect(report.sequencesStarted).toBe(10);
    expect(report.sequencesSucceeded + report.sequencesFailed).toBe(10);
    const eyes = report.threats.bedtime_eyes;
    expect(eyes?.failReasons.early).toBe(0);
    expect((eyes?.perfect ?? 0) + (eyes?.success ?? 0)).toBeGreaterThan(0);
  });

  it('the random bot plays it: it presses threats at random, so it cannot be told from luck', async () => {
    const report = await duelReport({ botId: 'random', seed: 3, runs: 3 });
    expect(report.sequencesStarted).toBe(3);
    expect(report.sequencesSucceeded + report.sequencesFailed).toBeLessThanOrEqual(3);
  });

  it('counts the retreats per run and over the runs', async () => {
    const report = await duelReport({ botId: 'idle', runs: 3 });
    expect(report.runList.map((run) => run.sequenceRetreats)).toEqual([2, 2, 2]);
    expect(report.sequenceRetreats).toBe(6);
  });

  it('journals the game so that replaying it agrees', async () => {
    const games: [string, RunFile][] = [];
    const result = await runSim(
      simArgs({
        botId: 'idle',
        sequenceId: 'bedtime_duel',
        sequenceAtMs: 1000,
        untilSimMs: 120_000,
        seed: 2,
      }),
      levelWithDuel(),
      { onGame: (name, game) => games.push([name, game]) },
    );
    expect(result.ok).toBe(true);
    const game = games[0]?.[1] as RunFile;
    expect(game.journal.entries.map((entry) => entry.command.type)).toContain('StartSequence');
    expect(await replayRunFile(game, levelWithDuel())).toMatchObject({ ok: true });
  });
});
