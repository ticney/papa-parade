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

/**
 * When a threat is active, as the bots see it: from its telegraph to its answer, its gag or its
 * cancellation (the events alone; the same threat may end by more than one of them).
 */
function threatsActivity(events: readonly SimEvent[]) {
  // Strictly before `t`: the bot decides a step before the sim handles its tap, and cannot see that step.
  const activeAt = (t: number): { isActive: boolean; lastEndMs: number } => {
    const open = new Set<number>();
    let lastEndMs = 0;
    for (const event of events) {
      if (event.t >= t) break;
      if (event.type === 'ThreatTelegraphed') open.add(event.threatId);
      else if (
        event.type === 'ResponseResolved' ||
        event.type === 'GagTriggered' ||
        event.type === 'ThreatCancelled'
      ) {
        if (open.delete(event.threatId)) lastEndMs = event.t;
      }
    }
    return { isActive: open.size > 0, lastEndMs };
  };
  return { activeAt };
}

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

  it('taps nothing in a level with no station', async () => {
    const { sim, events } = await play('perfect', 1, {}, false);
    expect(typed(events, 'ObjectTapped')).toEqual([]);
    expect(sim.world.chores).toEqual([]);
    sim.dispose();
  });

  it('waits for a lull: every tap on the stove follows the last active threat by quietMinMs', async () => {
    const quietMinMs = 3000;
    const { sim, events } = await play('perfect', 2, {
      chores: { isEnabled: true, quietMinMs },
    });
    const taps = typed(events, 'ObjectTapped').filter((event) => event.objectId === 'stove');
    expect(taps.length).toBeGreaterThan(0);
    const { activeAt } = threatsActivity(events);
    for (const tap of taps) {
      const { isActive, lastEndMs } = activeAt(tap.t);
      expect(isActive, `a threat was active at ${tap.t}`).toBe(false);
      // Two steps of slack: the bot decides a step before the sim handles its tap.
      expect(tap.t - lastEndMs, `the lull before the tap at ${tap.t}`).toBeGreaterThanOrEqual(
        quietMinMs - 20,
      );
    }
    sim.dispose();
  });

  it('never starts a chore in the middle of a threat, even with no lull asked for (quietMinMs 0)', async () => {
    const { planChore, createChoreMemory } = await import('@bots/threatTiming');
    const worldWith = (threatState: string) =>
      ({
        time: { sim: 20_000 },
        flow: { state: 'playing' },
        papa: { state: 'idle' },
        baby: { state: 'wander' },
        threats: [{ state: threatState }],
        chores: [{ state: 'untouched' }],
      }) as unknown as Parameters<typeof planChore>[0];
    const settings = { isEnabled: true, quietMinMs: 0 };
    for (const state of ['hidden', 'telegraph', 'windowOpen']) {
      const out: Parameters<typeof planChore>[4] = [];
      planChore(worldWith(state), ['stove'], settings, true, out, createChoreMemory());
      expect(out, `a ${state} threat`).toEqual([]);
    }
    const out: Parameters<typeof planChore>[4] = [];
    planChore(worldWith('idle'), ['stove'], settings, true, out, createChoreMemory());
    expect(out).toMatchObject([{ type: 'TapObject', objectId: 'stove' }]);
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

  it('finishes the cooking in some games and misses beats in others (a clumsy read of the ring)', async () => {
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

  it('draws nothing for the chores in a level with no station: its game does not depend on their settings', async () => {
    const hashWith = async (settings: Partial<BotOptions>) => {
      const { sim, events } = await play('human', 1, settings, false);
      expect(typed(events, 'ObjectTapped')).toEqual([]);
      const hash = hashJson(sim.world);
      sim.dispose();
      return hash;
    };
    const plain = await hashWith({});
    const other = await hashWith({
      chores: { isEnabled: false, quietMinMs: 0 },
      human: { ...createTestBots().human, backTurnedSdMs: 900 },
    });
    expect(other).toBe(plain);
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
  it.each([
    ['perfect', 3, undefined],
    ['human', 2, undefined],
    ['human', 5, 'clumsy'],
  ] as const)(
    'replays the journal of a %s game (seed %i, %s) and ends in the same world',
    async (botId, seed, mode) => {
      const clumsyRing: Partial<BotOptions> = {
        human: {
          ...legacyHuman({ reactionMs: 250, jitterSdMs: 60 }),
          readError: {
            withChronoRing: { offsetMs: 0, sdMs: 400 },
            withoutChronoRing: { offsetMs: 0, sdMs: 400 },
          },
        },
      };
      const { sim, events } = await play(botId, seed, mode === 'clumsy' ? clumsyRing : {});
      // The game is a real one: the stove was tapped, beats were judged, and a threat took Papa away at
      // least once (the chore was paused and resumed), so the replay has something to get wrong.
      const journal = sim.journal();
      expect(
        journal.entries.some(
          (entry) => entry.command.type === 'TapObject' && entry.command.objectId === 'stove',
        ),
      ).toBe(true);
      expect(typed(events, 'ChoreBeatJudged').length).toBeGreaterThan(0);
      expect(typed(events, 'PapaGlideStarted').some((event) => event.threatId !== null)).toBe(true);
      const replayed = await replayJournal({
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: choreLevel(),
        journal,
        untilSimMs: sim.world.time.sim,
        strictInvariants: true,
      });
      if (!replayed.ok) throw new Error(replayed.error.message);
      expect(hashJson(replayed.value.sim.world)).toBe(hashJson(sim.world));
      replayed.value.sim.dispose();
      sim.dispose();
    },
  );
});

describe('the final rush with a chore under way (story 9.4 review)', () => {
  it('tidies from a Papa who works at the station: he leaves the chore for the props', async () => {
    const { planTidy, createTidyMemory } = await import('@bots/threatTiming');
    const out: Parameters<typeof planTidy>[2] = [];
    const memory = createTidyMemory();
    const world = {
      time: { sim: 12_000 },
      flow: { state: 'finalRush', finalRushAt: 10_000 },
      papa: { state: 'chore', xM: 0, zM: 0 },
      threats: [],
      props: [{ id: 'cup', isMess: true, xM: 1, zM: 1 }],
    } as unknown as Parameters<typeof planTidy>[0];
    planTidy(world, {}, out, memory, 0);
    expect(out).toMatchObject([{ type: 'TapObject', objectId: 'cup' }]);
    // A walking Papa is still left alone.
    out.length = 0;
    planTidy(
      { ...world, time: { sim: 14_000 }, papa: { state: 'walkPath', xM: 0, zM: 0 } } as never,
      {},
      out,
      createTidyMemory(),
      0,
    );
    expect(out).toEqual([]);
  });
});
