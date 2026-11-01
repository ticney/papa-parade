import { hashJson } from '@shared/hash';
import { describe, expect, it } from 'vitest';
import type { SimLevel } from '../../../tools/sim/loadSimLevel.ts';
import { replayRunFile } from '../../../tools/sim/replaySim.ts';
import type { RunFile } from '../../../tools/sim/runFile.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { simArgs } from '../../support/simSupport.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../support/testContent.ts';

// `npm run sim` and the final rush (story 3.5): the report counts the doors that opened and the props
// put back, per game and over the runs, and a game cut by the rush's end ends on `timer`.
const DURATION_MS = 20_000;

function levelWithRush(isRush: boolean): SimLevel {
  const content = createTestContent();
  content.feel.endOfLevel.doorSpillCount = 0;
  return {
    levelId: 'salon_crawler',
    contentHash: hashJson(content),
    content,
    level: createTestLevel({
      durationMs: DURATION_MS,
      ...(isRush ? { finalRush: { spillAnchor: 'coffee_table' } } : {}),
    }),
    geometry: createTestGeometry(),
  };
}

async function report(isRush: boolean, overrides: Parameters<typeof simArgs>[0] = {}) {
  const result = await runSim(
    simArgs({ untilSimMs: DURATION_MS, ...overrides }),
    levelWithRush(isRush),
  );
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

describe('runSim and the final rush (story 3.5)', () => {
  it('counts one door per game in a level with a rush, and ends on timer', async () => {
    const value = await report(true, { botId: 'idle', runs: 3 });
    expect(value.finalRushes).toBe(3);
    expect(value.endsByReason.timer).toBe(3);
    expect(value.propsTidied).toBe(0);
  });

  it('counts none in a level without one', async () => {
    const value = await report(false, { botId: 'perfect', runs: 2 });
    expect(value.finalRushes).toBe(0);
    expect(value.propsTidied).toBe(0);
  });

  it('replays a game with a rush from its journal, to the same photo', async () => {
    const games: [string, RunFile][] = [];
    const level = levelWithRush(true);
    const result = await runSim(
      simArgs({ untilSimMs: DURATION_MS, botId: 'perfect', runs: 1, seed: 2 }),
      level,
      { onGame: (name, game) => games.push([name, game]) },
    );
    expect(result.ok).toBe(true);
    const game = games[0]?.[1] as RunFile;
    expect(await replayRunFile(game, level)).toMatchObject({ ok: true });
  });
});
