import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { createSim } from '@sim';
import { describe, expect, it } from 'vitest';
import { checkFeelPatches, replayRunFile } from '../../../tools/sim/replaySim.ts';
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
    loaded.level = { ...loaded.level, level: { ...loaded.level.level, waves: [] } };
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

describe('SetFeel in a recorded game (story 2.1)', () => {
  const feel = createTestSimLevel().content.feel;
  const entry = (applyAt: number, patch: unknown) => ({
    applyAt: asSimMs(applyAt),
    command: { type: 'SetFeel', t: asSimMs(applyAt), patch } as never,
  });
  const journalOf = (...entries: ReturnType<typeof entry>[]) =>
    ({ entries }) as unknown as Parameters<typeof checkFeelPatches>[0];

  it('checks each patch laid over the one before it, in order', () => {
    const widen = entry(10, { timing: { windowMs: feel.timing.windowMs + 100 } });
    const widerPerfect = entry(20, {
      timing: { perfectMs: feel.timing.windowMs + 50 },
    });
    expect(checkFeelPatches(journalOf(widen), feel).ok).toBe(true);
    // perfectMs above the original window is only legal because the first patch widened it.
    expect(checkFeelPatches(journalOf(widen, widerPerfect), feel).ok).toBe(true);
    expect(checkFeelPatches(journalOf(widerPerfect), feel).ok).toBe(false);
  });

  it('refuses a patch the schema refuses, with the entry and the path in the message', () => {
    const result = checkFeelPatches(
      journalOf(entry(10, { timing: { windowMs: feel.timing.windowMs } }), entry(20, { nope: 1 })),
      feel,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('invalid SetFeel');
      expect(result.error).toContain('entry 1');
    }
  });

  it('lets a journal without any SetFeel, or without entries, through', () => {
    expect(checkFeelPatches(journalOf(), feel).ok).toBe(true);
    expect(checkFeelPatches({} as never, feel).ok).toBe(true);
  });

  it('replays a recorded game that holds a valid SetFeel, and refuses one that holds an invalid one', async () => {
    const file = await recorded();
    // Past the end of the replay (untilSimMs), so the final world is the recorded one.
    const later = file.untilSimMs + 1000;
    const withValid: RunFile = {
      ...file,
      journal: {
        ...file.journal,
        entries: [...file.journal.entries, entry(later, { timing: { windowMs: 300 } })],
      },
    };
    const accepted = await replayRunFile(withValid, createTestSimLevel());
    expect(accepted).toEqual({ ok: true, value: { worldHash: file.worldHash } });

    const withInvalid: RunFile = {
      ...file,
      journal: {
        ...file.journal,
        entries: [...file.journal.entries, entry(later, { timing: { windowMs: -5 } })],
      },
    };
    const refused = await replayRunFile(withInvalid, createTestSimLevel());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('invalid SetFeel');
  });
  /** A game played live with a `SetFeel` in the middle, then recorded the way the CLI does. */
  async function recordedWithSetFeel(patch: unknown): Promise<RunFile> {
    const loaded = createTestSimLevel();
    const untilSimMs = 3000;
    const sim = await createSim({
      content: loaded.content,
      geometry: loaded.geometry,
      level: loaded.level,
      seed: 4,
    });
    while (sim.world.time.sim < untilSimMs) {
      if (sim.world.time.sim === 1000) {
        sim.enqueue({ type: 'SetFeel', t: asSimMs(1000), patch: patch as never });
      }
      sim.step();
    }
    const file: RunFile = {
      kind: 'papa-parade.run',
      version: 1,
      levelId: loaded.levelId,
      bot: 'human',
      untilSimMs,
      worldHash: hashJson(sim.world),
      journal: sim.journal(),
    };
    sim.dispose();
    return file;
  }

  it('replays a game whose SetFeel is applied mid-run to the recorded hash, and the SetFeel changes that hash', async () => {
    const windowMs = createTestSimLevel().content.feel.timing.windowMs;
    const file = await recordedWithSetFeel({ timing: { windowMs: windowMs + 30 } });
    const midRun = file.journal.entries.find((entry) => entry.command.type === 'SetFeel');
    expect(midRun?.applyAt).toBeLessThan(file.untilSimMs);
    expect(midRun?.applyAt).toBeGreaterThan(0);
    expect(await replayRunFile(file, createTestSimLevel())).toEqual({
      ok: true,
      value: { worldHash: file.worldHash },
    });

    // Without the SetFeel the replay ends in another world: the tool does apply it.
    const without: RunFile = {
      ...file,
      journal: { ...file.journal, entries: [] },
    };
    const refused = await replayRunFile(without, createTestSimLevel());
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toContain('another state');
  });
});
