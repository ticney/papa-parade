import { hashJson } from '@shared/hash';
import { describe, expect, it } from 'vitest';
import type { SimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { replayRunFile } from '../../../tools/sim/replaySim.ts';
import type { RunFile } from '../../../tools/sim/runFile.ts';
import { runSim, sequenceDefIdsOf } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';
import {
  CARRY,
  createTestBombDrop,
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../support/testContent.ts';

// `npm run sim -- --sequence bomb_drop` (story 4.8): the golden rule, the drop played end to end by a bot
// with no human, journaled so that `sim:replay` agrees. The frozen def: one duel step, three retreats to
// lose, and the baby laid to win.
const DEF = createTestBombDrop();
const MAX_RETREATS = DEF.failure.kind === 'retreats' ? DEF.failure.maxRetreats : Number.NaN;

function levelWithDrop(): SimLevel {
  const content = createTestContent();
  return {
    levelId: 'salon_crawler',
    contentHash: hashJson(content),
    content,
    level: createTestLevel({ carry: CARRY, sequences: ['bomb_drop'], durationMs: 120_000 }),
    geometry: createTestGeometry(),
  };
}

async function dropReport(overrides: Parameters<typeof simArgs>[0]) {
  const result = await runSim(
    simArgs({ sequenceId: 'bomb_drop', sequenceAtMs: 1000, untilSimMs: 120_000, ...overrides }),
    levelWithDrop(),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('runSim with --sequence bomb_drop (story 4.8)', () => {
  it('counts the drop’s threat as a duel threat, so it is not a micro-sleep', () => {
    expect([...sequenceDefIdsOf(levelWithDrop().level)]).toEqual(['bomb_drop_lay']);
  });

  it.each([1, 2, 3, 4, 5])(
    'the perfect bot wins it on seed %i: no retreat, one perfect response, the baby down, the combo cashed',
    async (seed) => {
      const report = await dropReport({ botId: 'perfect', seed });
      expect(report.sequencesStarted).toBe(1);
      expect(report.sequencesSucceeded).toBe(1);
      expect(report.sequencesFailed).toBe(0);
      expect(report.sequenceRetreats).toBe(0);
      expect(report.gags.total).toBe(0);
      expect(report.threats.bomb_drop_lay).toMatchObject({
        responses: 1,
        perfect: 1,
        success: 0,
        fail: 0,
        meanAbsOffsetMs: 0,
      });
      expect(report.babyPutDowns).toBe(1);
      expect(report.safePutDowns).toBe(1);
      expect(report.comboCashIns).toBe(1);
      expect(report.microSleeps).toBe(0);
    },
  );

  it.each([1, 2, 3, 4, 5])(
    'the idle bot loses it on seed %i, on its third failure: two retreats, then the baby wakes',
    async (seed) => {
      const report = await dropReport({ botId: 'idle', seed });
      expect(report.sequencesStarted).toBe(1);
      expect(report.sequencesSucceeded).toBe(0);
      expect(report.sequencesFailed).toBe(1);
      expect(report.sequenceRetreats).toBe(MAX_RETREATS - 1);
      expect(report.threats.bomb_drop_lay).toMatchObject({
        responses: MAX_RETREATS,
        fail: MAX_RETREATS,
        perfect: 0,
        success: 0,
      });
      expect(report.threats.bomb_drop_lay?.failReasons.late).toBe(MAX_RETREATS);
      // He is never put down after a loss.
      expect(report.babyPutDowns).toBe(0);
      expect(report.comboCashIns).toBe(0);
    },
  );

  it('the human bot plays it and ends it every time, by a win or a loss', async () => {
    const report = await dropReport({ botId: 'human', seed: 3, runs: 10 });
    expect(report.sequencesStarted).toBe(10);
    expect(report.sequencesSucceeded + report.sequencesFailed).toBe(10);
    expect(report.sequencesSucceeded).toBeGreaterThan(0);
    expect(report.microSleeps).toBe(0);
  });

  it('journals the game so that replaying it agrees', async () => {
    const games: [string, RunFile][] = [];
    const result = await runSim(
      simArgs({
        botId: 'perfect',
        sequenceId: 'bomb_drop',
        sequenceAtMs: 1000,
        untilSimMs: 120_000,
        seed: 2,
      }),
      levelWithDrop(),
      { onGame: (name, game) => games.push([name, game]) },
    );
    expect(result.ok).toBe(true);
    const game = games[0]?.[1] as RunFile;
    const types = game.journal.entries.map((entry) => entry.command.type);
    expect(types).toContain('StartSequence');
    expect(types).toContain('PressThreat');
    expect(types).toContain('Release');
    expect(await replayRunFile(game, levelWithDrop())).toMatchObject({ ok: true });
  });
});
