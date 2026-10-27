import { BOT_IDS, type BotId } from '@bots/bot';
import { botResponsesOf } from '@bots/botResponses';
import { createBot } from '@bots/createBot';
import { playGame } from '@bots/playGame';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { createSim, type Sim } from '@sim';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { botSetup, botTestLevel } from '../../tests/support/botSupport.ts';
import { createFakeTestHost } from '../../tests/support/fakeTestHost.ts';
import { createTestContent, createTestGeometry } from '../../tests/support/testContent.ts';
import { installAutoplay } from './autoplay.ts';

beforeAll(() => {
  log.setLevel('error');
});

const GAME_STEPS = 4000;

async function newSim(seed: number): Promise<Sim> {
  return createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: botTestLevel(),
    seed,
    strictInvariants: true,
  });
}

function startedOf(sim: Sim, seed: number) {
  const content = createTestContent();
  return {
    sim,
    levelId: 'salon_crawler',
    seed,
    level: botTestLevel(),
    feel: content.feel,
  };
}

describe('installAutoplay', () => {
  for (const id of ['perfect', 'human'] as const satisfies readonly BotId[]) {
    it(`plays a ${id} game through the step hook exactly as playGame does (same journal, same world)`, async () => {
      const seed = 42;
      const host = createFakeTestHost();
      expect(installAutoplay(host, id).ok).toBe(true);
      const hooked = await newSim(seed);
      host.fireLevelStarted(startedOf(hooked, seed));
      const hook = host.stepHook;
      expect(hook).not.toBeNull();
      for (let i = 0; i < GAME_STEPS; i++) {
        hook?.(hooked);
        hooked.step();
        hooked.drainEvents();
      }

      const reference = await newSim(seed);
      const made = createBot(id, botSetup(seed));
      if (!made.ok) throw new Error(made.error.message);
      playGame(reference, made.value, GAME_STEPS * STEP_MS);

      expect(hooked.world.time.sim).toBe(GAME_STEPS * STEP_MS);
      expect(hooked.journal()).toEqual(reference.journal());
      expect(hashJson(hooked.world)).toBe(hashJson(reference.world));
    });
  }

  it('blocks the game input as soon as it is installed', () => {
    const host = createFakeTestHost();
    expect(installAutoplay(host, 'idle').ok).toBe(true);
    expect(host.isGameInputBlocked).toBe(true);
  });

  it('refuses an unknown bot with the createBot message that names the bots, and touches nothing', () => {
    const host = createFakeTestHost();
    const result = installAutoplay(host, 'nobody');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe(
        'unknown bot "nobody": choose perfect, human, random, idle',
      );
      expect(result.error.message).toContain(BOT_IDS.join(', '));
    }
    expect(host.calls).toEqual([]);
    expect(host.stepHook).toBeNull();
  });

  it('builds a fresh bot for each level: nothing of the previous plan is carried over', async () => {
    const host = createFakeTestHost();
    installAutoplay(host, 'perfect');

    const first = await newSim(1);
    host.fireLevelStarted(startedOf(first, 1));
    const firstHook = host.stepHook;
    for (let i = 0; i < 1500; i++) {
      firstHook?.(first);
      first.step();
      first.drainEvents();
    }

    // The next level begins at sim time 0 with a new sim: its bot plays it as a bot made for it.
    const second = await newSim(2);
    host.fireLevelStarted(startedOf(second, 2));
    expect(host.stepHook).not.toBe(firstHook);
    const hook = host.stepHook;
    for (let i = 0; i < GAME_STEPS; i++) {
      hook?.(second);
      second.step();
      second.drainEvents();
    }
    const reference = await newSim(2);
    const made = createBot('perfect', botSetup(2));
    if (!made.ok) throw new Error(made.error.message);
    playGame(reference, made.value, GAME_STEPS * STEP_MS);
    expect(second.journal()).toEqual(reference.journal());
  });

  it('tells the bot what each def of the level asks for, from the level and the feel it is started with', async () => {
    const host = createFakeTestHost();
    installAutoplay(host, 'perfect');
    const sim = await newSim(3);
    const started = startedOf(sim, 3);
    expect(botResponsesOf(started.level.threats)).toEqual({ outlet: 'parry' });
    host.fireLevelStarted(started);
    // The perfect bot answers the outlet: after 10 s of play it has pressed it (a command is journaled).
    for (let i = 0; i < 1000; i++) {
      host.stepHook?.(sim);
      sim.step();
      sim.drainEvents();
    }
    expect(sim.journal().entries.some((entry) => entry.command.type === 'PressThreat')).toBe(true);
  });

  it('removes the hook and says so when a level cannot get its bot (a seed no bot accepts)', async () => {
    const host = createFakeTestHost();
    installAutoplay(host, 'perfect');
    const sim = await newSim(4);
    host.fireLevelStarted(startedOf(sim, 4));
    expect(host.stepHook).not.toBeNull();
    expect(host.isGameInputBlocked).toBe(true);
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    host.fireLevelStarted({ ...startedOf(sim, 4), seed: -1 });
    expect(host.stepHook).toBeNull();
    // Nothing plays this level: the player gets the game back, and the log says why.
    expect(host.isGameInputBlocked).toBe(false);
    expect(warn).toHaveBeenCalledWith('debug', expect.stringContaining('no bot for this level'));
    warn.mockRestore();
  });
});
