import { BOT_IDS, type BotId, type BotOptions, type BotSetup } from '@bots/bot';
import { playGame } from '@bots/playGame';
import type { BotSettings } from '@content/schemas/bots';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { createSim, replayJournal, type SimCommand } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  BOT_TEST_UNTIL_MS,
  botSetup,
  botTestLevel,
  makeBot,
  playBotGame,
} from '../support/botSupport.ts';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';

// (e) Compile-time: the content type is assignable to the options the bots take, so the two
// cannot drift. A failure here is a typecheck error, not a test failure.
const settingsAreOptions = (settings: BotSettings): BotOptions => settings;

const SEED = 11;
/** Hash the whole world on one step in this many: 1, because a bot only touches anything in the few steps where it acts. */
const HASH_EVERY_STEPS = 1;

describe.each(BOT_IDS)('the %s bot contract', (id: BotId) => {
  it('never mutates the world, and only sends a t in the coming step', async () => {
    const content = createTestContent();
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: SEED,
      strictInvariants: true,
    });
    const bot = makeBot(id, botSetup(SEED));
    const out: SimCommand[] = [];
    let step = 0;
    while (sim.world.time.sim < BOT_TEST_UNTIL_MS) {
      const now = sim.world.time.sim;
      const sample = step % HASH_EVERY_STEPS === 0;
      const before = sample ? hashJson(sim.world) : '';
      out.length = 0;
      bot.act(sim.world, out);
      if (sample) expect(hashJson(sim.world)).toBe(before);
      for (const command of out) {
        expect(command.t).toBeGreaterThanOrEqual(now);
        expect(command.t).toBeLessThan(now + STEP_MS);
        sim.enqueue(command);
      }
      sim.step();
      sim.drainEvents();
      step++;
    }
  });

  it('plays the same game twice for the same seed', async () => {
    const a = await playBotGame(id, SEED);
    const b = await playBotGame(id, SEED);
    expect(a.sim.journal()).toEqual(b.sim.journal());
    expect(hashJson(a.sim.world)).toBe(hashJson(b.sim.world));
  });

  it('leaves the world to the sim: replaying its journal, with no bot, gives the same final world', async () => {
    const live = await playBotGame(id, SEED);
    const replayed = await replayJournal({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      journal: live.sim.journal(),
      untilSimMs: BOT_TEST_UNTIL_MS,
      strictInvariants: true,
    });
    if (!replayed.ok) throw new Error(replayed.error.message);
    expect(hashJson(replayed.value.sim.world)).toBe(hashJson(live.sim.world));
  });
});

describe('bot settings', () => {
  it('are the content type', () => {
    expect(settingsAreOptions(createTestContent().bots).tapMs).toBeGreaterThan(0);
  });
});

// Parry and wait draws do not move (story 4.8, AC 14): the ids of the release defs are read only for
// a threat of those defs, so a bot that is told about them plays any other game as it did before.
describe.each(BOT_IDS)('the %s bot and the release defs it is told about', (id: BotId) => {
  const played = async (releaseDefIds: readonly string[]) => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: SEED,
      strictInvariants: true,
    });
    playGame(sim, makeBot(id, { ...botSetup(SEED), releaseDefIds }), BOT_TEST_UNTIL_MS, () => {});
    return sim;
  };

  it('plays the same game on a level that never uses them, told or not', async () => {
    const told = await played(botSetup(SEED).releaseDefIds);
    const untold = await played([]);
    expect(botSetup(SEED).releaseDefIds.length).toBeGreaterThan(0);
    expect(told.journal()).toEqual(untold.journal());
    expect(hashJson(told.world)).toBe(hashJson(untold.world));
  });
});

// The stealth defs move no draw (story 4.9, AC 18): `nothing` is read only for a threat of that response,
// and the walk and the breath only in a stealth step, so a bot that is told about the false alarm and the
// real wake plays any other game as it did before.
describe.each(BOT_IDS)('the %s bot and the stealth defs it is told about', (id: BotId) => {
  const STEALTH_DEFS = ['false_alarm_sigh', 'real_wake'];
  const played = async (responses: BotSetup['responses']) => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: SEED,
      strictInvariants: true,
    });
    playGame(sim, makeBot(id, { ...botSetup(SEED), responses }), BOT_TEST_UNTIL_MS, () => {});
    return sim;
  };

  it('plays the same game on a level that never uses them, told or not', async () => {
    const told = botSetup(SEED).responses;
    for (const defId of STEALTH_DEFS) expect(told[defId]).toBeDefined();
    const untold = Object.fromEntries(
      Object.entries(told).filter(([defId]) => !STEALTH_DEFS.includes(defId)),
    );
    const a = await played(told);
    const b = await played(untold);
    expect(a.journal()).toEqual(b.journal());
    expect(hashJson(a.world)).toBe(hashJson(b.world));
    expect(a.journal().entries.some((entry) => entry.command.type === 'HoldAnywhere')).toBe(false);
  });
});

// The cycle bot moves no draw (story 4.10, AC 12): with no cycle `world.cycle.nextAt` stays null, so a
// bot that is told where the crib is plays any other game as it did before.
describe('a safe spot in a level with no cycle', () => {
  const played = async (id: BotId, safeSpot: BotSetup['safeSpot']) => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTestLevel(),
      seed: SEED,
      strictInvariants: true,
    });
    playGame(sim, makeBot(id, { ...botSetup(SEED), safeSpot }), BOT_TEST_UNTIL_MS, () => {});
    return sim;
  };

  it.each(['perfect', 'human'] as const)('plays the same %s game, told or not', async (id) => {
    const told = await played(id, { xM: -2, zM: 1.6 });
    const untold = await played(id, null);
    expect(told.journal()).toEqual(untold.journal());
    expect(hashJson(told.world)).toBe(hashJson(untold.world));
  });
});
