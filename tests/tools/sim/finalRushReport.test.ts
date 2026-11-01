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

/** `isSpill`: the mug cannot break, so the door's opening knocks it off its table and there is a mess to tidy. */
function levelWithRush(isRush: boolean, isSpill = false): SimLevel {
  const content = createTestContent();
  content.feel.endOfLevel.doorSpillCount = isSpill ? 1 : 0;
  if (isSpill) content.feel.physics.kinds.mug.breakable = false;
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

async function report(
  isRush: boolean,
  overrides: Parameters<typeof simArgs>[0] = {},
  isSpill = false,
) {
  const result = await runSim(
    simArgs({ untilSimMs: DURATION_MS, ...overrides }),
    levelWithRush(isRush, isSpill),
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

  it('counts the props put back, per game and over the runs: the door knocks the mug off, perfect tidies it', async () => {
    const tidying = await report(true, { botId: 'perfect', runs: 2 }, true);
    expect(tidying.finalRushes).toBe(2);
    expect(tidying.propsTidied).toBe(2);
    const idle = await report(true, { botId: 'idle', runs: 2 }, true);
    expect(idle.finalRushes).toBe(2);
    expect(idle.propsTidied).toBe(0);
  });

  it('counts none in a level without one', async () => {
    const value = await report(false, { botId: 'perfect', runs: 2 });
    expect(value.finalRushes).toBe(0);
    expect(value.propsTidied).toBe(0);
  });

  it('replays a game with a rush and a tidied prop from its journal, to the same photo', async () => {
    const games: [string, RunFile][] = [];
    const level = levelWithRush(true, true);
    const result = await runSim(
      simArgs({ untilSimMs: DURATION_MS, botId: 'perfect', runs: 1, seed: 2 }),
      level,
      { onGame: (name, game) => games.push([name, game]) },
    );
    expect(result.ok).toBe(true);
    const game = games[0]?.[1] as RunFile;
    // The game is the one the title says: a door that opened, a prop put back.
    expect(game.journal.entries.some((entry) => entry.command.type === 'TapObject')).toBe(true);
    expect(await replayRunFile(game, level)).toMatchObject({ ok: true });
  });
});
