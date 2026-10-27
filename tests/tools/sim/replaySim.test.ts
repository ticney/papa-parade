import { describe, expect, it } from 'vitest';
import { replayRunFile } from '../../../tools/sim/replaySim.ts';
import type { RunFile } from '../../../tools/sim/runFile.ts';
import { runSim } from '../../../tools/sim/runSim.ts';
import { createTestSimLevel, simArgs } from '../../support/simSupport.ts';

async function recorded(botId: 'human' | 'random' = 'human'): Promise<RunFile> {
  const games: RunFile[] = [];
  const result = await runSim(
    simArgs({ botId, seed: 6, untilSimMs: 30_000 }),
    createTestSimLevel(),
    {
      onGame: (_name, game) => games.push(game),
    },
  );
  if (!result.ok || games[0] === undefined) throw new Error('no recorded game');
  return games[0];
}

describe('replayRunFile', () => {
  it.each(['human', 'random'] as const)('replays a %s game to its recorded hash', async (botId) => {
    const file = await recorded(botId);
    const replay = await replayRunFile(file, createTestSimLevel());
    expect(replay).toEqual({ ok: true, value: { worldHash: file.worldHash } });
  });

  it('is an err that gives both hashes when the final state differs', async () => {
    const file = { ...(await recorded()), worldHash: '00000000000000' };
    const replay = await replayRunFile(file, createTestSimLevel());
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error).toContain('00000000000000');
      expect(replay.error).toContain('another state');
    }
  });

  it('is an err when the feel changed since the recording', async () => {
    const file = await recorded();
    const loaded = createTestSimLevel();
    loaded.content = {
      ...loaded.content,
      feel: { ...loaded.content.feel, timing: { ...loaded.content.feel.timing, windowMs: 999 } },
    };
    const replay = await replayRunFile(file, loaded);
    expect(replay.ok).toBe(false);
    if (!replay.ok) {
      expect(replay.error).toContain('different feel');
      expect(replay.error).toContain('content changed');
    }
  });

  it('is an err when the level changed since the recording', async () => {
    const file = await recorded();
    const loaded = createTestSimLevel();
    loaded.level = { ...loaded.level, level: { ...loaded.level.level, threats: [] } };
    const replay = await replayRunFile(file, loaded);
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.error).toContain('another level');
  });

  it('is an err for a journal that is not one', async () => {
    const file = { ...(await recorded()), journal: { nope: true } as never };
    const replay = await replayRunFile(file, createTestSimLevel());
    expect(replay.ok).toBe(false);
  });
});
