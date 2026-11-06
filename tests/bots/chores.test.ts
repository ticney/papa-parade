import type { BotOptions } from '@bots/bot';
import { playGame } from '@bots/playGame';
import { hashJson } from '@shared/hash';
import { createSim, replayJournal, type Sim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { botSetup, legacyHuman, makeBot } from '../support/botSupport.ts';
import {
  COFFEE_TABLE,
  createTestBots,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  TEST_COOKING,
  TEST_OBJECTS,
  TEST_STOVE,
  testWave,
} from '../support/testContent.ts';

// The house chores of story 9.4 (AC 12): the perfect and the human bots do the cooking in the lulls,
// on the frozen level with a stove, whatever `content/bots.json` says today.

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const DURATION_MS = 90_000;

/** The frozen level: two threats from the start, the stove, the frozen cooking. */
const choreLevel = () =>
  createTestLevel({
    waves: [testWave([OUTLET, COFFEE_TABLE], { gapMinMs: 4000, gapMaxMs: 7000 })],
    objects: [...TEST_OBJECTS, TEST_STOVE],
    chores: [TEST_COOKING],
    durationMs: DURATION_MS,
  });

interface Played {
  sim: Sim;
  events: SimEvent[];
}

async function play(
  botId: 'perfect' | 'human',
  seed: number,
  settings: Partial<BotOptions> = {},
  hasStation = true,
): Promise<Played> {
  const level = hasStation ? choreLevel() : createTestLevel({ waves: [testWave([OUTLET])] });
  const sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level,
    seed,
    strictInvariants: true,
  });
  const setup = { ...botSetup(seed, settings, level), choreObjectIds: hasStation ? ['stove'] : [] };
  const events: SimEvent[] = [];
  playGame(sim, makeBot(botId, setup), DURATION_MS, (event) => events.push({ ...event }));
  return { sim, events };
}

const typed = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

describe('the perfect bot does the chores', () => {
  it.each(SEEDS)('finishes the cooking and fails no threat (seed %i)', async (seed) => {
    const { sim, events } = await play('perfect', seed);
    expect(sim.world.chores[0]?.state).toBe('done');
    expect(typed(events, 'ChoreCompleted')).toHaveLength(1);
    expect(typed(events, 'ChoreBeatJudged').map((event) => event.quality)).toEqual([
      'perfect',
      'perfect',
      'perfect',
      'perfect',
    ]);
    // Leaving the station for a threat never costs a response.
    expect(typed(events, 'ResponseResolved').filter((event) => event.quality === 'fail')).toEqual(
      [],
    );
    sim.dispose();
  });

  it('pays the Maison row at the end of the level', async () => {
    const { sim, events } = await play('perfect', 1);
    expect(typed(events, 'LevelScored')[0]?.homePoints).toBe(7.5);
    sim.dispose();
  });

  it('never taps the stove when chores.isEnabled is false', async () => {
    const { sim, events } = await play('perfect', 1, {
      chores: { ...createTestBots().chores, isEnabled: false },
    });
    expect(typed(events, 'ObjectTapped').filter((event) => event.objectId === 'stove')).toEqual([]);
    expect(sim.world.chores[0]?.state).toBe('untouched');
    sim.dispose();
  });

  it('draws nothing and taps nothing in a level with no station', async () => {
    const { sim, events } = await play('perfect', 1, {}, false);
    expect(typed(events, 'ObjectTapped')).toEqual([]);
    expect(sim.world.chores).toEqual([]);
    sim.dispose();
  });

  it('waits for a lull: no tap on the stove within quietMinMs of an active threat', async () => {
    const { sim, events } = await play('perfect', 2, {
      chores: { isEnabled: true, quietMinMs: 6000 },
    });
    // With a long quiet, the first tap comes late (nothing before the first lull of 6 s).
    const first = typed(events, 'ObjectTapped').find((event) => event.objectId === 'stove');
    expect(first === undefined || first.t >= 6000).toBe(true);
    sim.dispose();
  });
});

describe('the human bot does the chores', () => {
  /** Reads the ring badly: a spread so wide that some beats are missed. */
  const clumsy: Partial<BotOptions> = {
    human: {
      ...legacyHuman({ reactionMs: 250, jitterSdMs: 60 }),
      readError: {
        withChronoRing: { offsetMs: 0, sdMs: 400 },
        withoutChronoRing: { offsetMs: 0, sdMs: 400 },
      },
    },
  };

  it('finishes it in some games and misses some beats in others, never both ways at once', async () => {
    let completed = 0;
    let misses = 0;
    for (const seed of SEEDS) {
      const { sim, events } = await play('human', seed, clumsy);
      if (sim.world.chores[0]?.state === 'done') completed++;
      misses += typed(events, 'ChoreBeatJudged').filter((event) => event.quality === 'fail').length;
      sim.dispose();
    }
    expect(completed).toBeGreaterThan(0);
    expect(misses).toBeGreaterThan(0);
  });

  it('aims worse at a telegraph while Papa works at the station: backTurnedSdMs widens the spread', async () => {
    // A human who aims exactly at the centre of the window (no jitter): the only error is the spread.
    const human = (backTurnedSdMs: number): Partial<BotOptions> => ({
      human: { ...legacyHuman({ reactionMs: 250, jitterSdMs: 0 }), backTurnedSdMs },
    });
    const failedThreats = async (settings: Partial<BotOptions>) => {
      let fails = 0;
      for (const seed of SEEDS) {
        const { sim, events } = await play('human', seed, settings);
        fails += typed(events, 'ResponseResolved').filter(
          (event) => event.quality === 'fail',
        ).length;
        sim.dispose();
      }
      return fails;
    };
    const exact = await failedThreats(human(0));
    expect(exact).toBe(0);
    // 400 ms of spread against a 300 ms window: presses fall outside it.
    expect(await failedThreats(human(400))).toBeGreaterThan(exact);
  });

  it('draws the spread only while Papa is at a station: with the chores off it changes nothing', async () => {
    const withSpread = async (backTurnedSdMs: number) => {
      const settings: Partial<BotOptions> = {
        chores: { isEnabled: false, quietMinMs: 1500 },
        human: { ...legacyHuman({ reactionMs: 250, jitterSdMs: 30 }), backTurnedSdMs },
      };
      const { sim } = await play('human', 3, settings);
      const hash = hashJson(sim.world);
      sim.dispose();
      return hash;
    };
    expect(await withSpread(400)).toBe(await withSpread(0));
  });
});

describe('a game with chores replays to the same state', () => {
  it('replays the journal of a perfect game and ends in the same world', async () => {
    const { sim } = await play('perfect', 3);
    const replayed = await replayJournal({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: choreLevel(),
      journal: sim.journal(),
      untilSimMs: sim.world.time.sim,
      strictInvariants: true,
    });
    if (!replayed.ok) throw new Error(replayed.error.message);
    expect(hashJson(replayed.value.sim.world)).toBe(hashJson(sim.world));
    replayed.value.sim.dispose();
    sim.dispose();
  });
});
