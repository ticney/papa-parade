import type { SimCommand, SimEvent } from '@sim';
import { createSim } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  BOT_TEST_UNTIL_MS,
  botSetup,
  botTrioLevel,
  legacyHuman,
  makeBot,
  playBotGame,
} from '../support/botSupport.ts';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';

// The séquelles of the gags (story 3.15) as the bots meet them: `perfect` never misses so it has none, `idle`
// misses everything and piles them up, and the human bot fetches a baby left at the bottom of the stairs.

const started = (events: readonly SimEvent[]) =>
  events.filter(
    (event): event is Extract<SimEvent, { type: 'AfterEffectStarted' }> =>
      event.type === 'AfterEffectStarted',
  );

const SEEDS = [1, 2, 3, 4, 5, 6];

describe('the séquelles and the bots (story 3.15)', () => {
  it('perfect has none: a game with no miss leaves nothing behind', async () => {
    for (const seed of SEEDS) {
      const { events } = await playBotGame('perfect', seed, {
        untilSimMs: BOT_TEST_UNTIL_MS,
        level: botTrioLevel(),
      });
      expect(started(events), `seed ${seed}`).toEqual([]);
    }
  });

  it('idle piles them up: more than one a game on average, of every kind but the carry', async () => {
    const kinds = new Set<string>();
    let total = 0;
    for (const seed of SEEDS) {
      const { events } = await playBotGame('idle', seed, {
        untilSimMs: BOT_TEST_UNTIL_MS,
        level: botTrioLevel(),
      });
      for (const event of started(events)) {
        kinds.add(event.kind);
        total++;
      }
    }
    expect(total / SEEDS.length).toBeGreaterThan(1);
    // The trio: the outlet, the stairs and the coffee table. Nobody fetches the baby, so no carry.
    expect([...kinds].sort()).toEqual(['babyDownstairs', 'debris', 'dim', 'electrified']);
  });

  it('a slow human, who misses the stairs, fetches the baby he left there and carries him up', async () => {
    let carries = 0;
    for (const seed of SEEDS) {
      const { events } = await playBotGame('human', seed, {
        untilSimMs: BOT_TEST_UNTIL_MS,
        level: botTrioLevel(),
        settings: { human: legacyHuman({ reactionMs: 1700 }) },
      });
      carries += started(events).filter((event) => event.kind === 'carryUp').length;
    }
    expect(carries).toBeGreaterThan(0);
  });
});

describe('the human bot and a baby downstairs (story 3.15)', () => {
  async function downstairsWorld() {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: botTrioLevel(),
      seed: 1,
    });
    const { world } = sim;
    world.time.sim = 1000 as typeof world.time.sim;
    world.baby.state = 'downstairs';
    world.baby.downstairsUntil = 7000 as typeof world.time.sim;
    world.threats.length = 0;
    return world;
  }
  const bot = () =>
    makeBot('human', botSetup(1, { human: legacyHuman({ reactionMs: 250 }) }, botTrioLevel()));

  it('taps him after a reaction, once, and again a second later if it came to nothing', async () => {
    const world = await downstairsWorld();
    const human = bot();
    const taps = (): number => {
      const out: SimCommand[] = [];
      human.act(world, out);
      return out.filter((command) => command.type === 'TapBaby').length;
    };
    expect(taps()).toBe(0); // 1000: the reaction time is not over
    world.time.sim = 1250 as typeof world.time.sim;
    expect(taps()).toBe(1);
    world.time.sim = 1300 as typeof world.time.sim;
    expect(taps()).toBe(0); // sent, and Papa is on his way or about to be
    world.time.sim = 2300 as typeof world.time.sim;
    expect(taps()).toBe(1); // a second later, Papa is still idle: it taps again
  });

  it('does not tap while Papa is busy, nor once the baby is no longer downstairs', async () => {
    const world = await downstairsWorld();
    const human = bot();
    const out: SimCommand[] = [];
    world.time.sim = 3000 as typeof world.time.sim;
    world.papa.state = 'electrified';
    human.act(world, out);
    expect(out).toEqual([]);
    world.papa.state = 'idle';
    world.baby.state = 'babble';
    world.baby.downstairsUntil = null;
    human.act(world, out);
    expect(out).toEqual([]);
  });
});
