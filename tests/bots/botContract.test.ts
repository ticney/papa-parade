import { BOT_IDS, type BotId, type BotOptions } from '@bots/bot';
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
