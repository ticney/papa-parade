import { botSeed } from '@bots/botSeed';
import { nextGaussian } from '@bots/gaussian';
import { playGame } from '@bots/playGame';
import { createRng } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { botSetup, legacyHuman, makeBot, playBotGame, responses } from '../support/botSupport.ts';
import {
  CARRY,
  createTestContent,
  createTestFakeSleepRound,
  createTestGeometry,
  createTestLevel,
} from '../support/testContent.ts';

// The bots and the wait response (story 4.6): `perfect` knows the answer, `human` reacts to the
// signal and cannot plan before it, `idle` never answers. Played through the bedtime duel of the
// frozen content; the human's draws on a parry are pinned unchanged.
const DUEL_LEVEL = () => createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'] });
const NO_JITTER = { reactionMs: 250, aimOffsetMs: 0, jitterSdMs: 0 };

async function playDuel(
  id: 'perfect' | 'human' | 'idle' | 'random',
  seed: number,
  human: Partial<typeof NO_JITTER> = {},
  untilSimMs = 60_000,
) {
  const level = DUEL_LEVEL();
  const sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level,
    seed,
    strictInvariants: true,
  });
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bedtime_duel' });
  const events: SimEvent[] = [];
  const settings = { human: legacyHuman({ ...NO_JITTER, ...human }) };
  playGame(sim, makeBot(id, botSetup(seed, settings, level)), untilSimMs, (event) =>
    events.push({ ...event }),
  );
  return { sim, events };
}

const eyes = (events: readonly SimEvent[]) =>
  responses(events).filter((event) => event.response === 'wait');

describe('the perfect bot and a wait threat', () => {
  it.each([1, 2, 3])('wins the duel perfectly on seed %i, with no retreat', async (seed) => {
    const { events } = await playDuel('perfect', seed);
    expect(eyes(events)).toHaveLength(3);
    for (const response of eyes(events))
      expect(response).toMatchObject({ quality: 'perfect', offsetMs: 0 });
    expect(events.filter((event) => event.type === 'SequenceStepRetreated')).toEqual([]);
    expect(events.filter((event) => event.type === 'SequenceEnded')).toEqual([
      expect.objectContaining({ outcome: 'succeeded' }),
    ]);
  });
});

describe('the human bot and a wait threat', () => {
  it('never presses before the signal, over many seeds', async () => {
    let presses = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { sim, events } = await playDuel('human', seed, { jitterSdMs: 60 }, 40_000);
      expect(eyes(events).filter((response) => response.reason === 'early')).toEqual([]);
      const signals = events.filter((event) => event.type === 'WaitSignalGiven');
      for (const entry of sim.journal().entries) {
        if (entry.command.type !== 'PressThreat') continue;
        presses++;
        const lastSignal = signals.filter((signal) => signal.t <= entry.command.t).at(-1);
        expect(lastSignal, `a press at ${entry.command.t} with no signal before it`).toBeDefined();
      }
    }
    expect(presses).toBeGreaterThan(40);
  }, 60_000);

  it('reacts to the signal, not to the centre: a fixed reaction after it, to the ms', async () => {
    const { sim, events } = await playDuel('human', 1, { reactionMs: 250, jitterSdMs: 0 });
    const presses = sim.journal().entries.filter((entry) => entry.command.type === 'PressThreat');
    const signals = events.filter((event) => event.type === 'WaitSignalGiven');
    expect(presses.length).toBeGreaterThanOrEqual(3);
    for (const press of presses.slice(0, 3)) {
      const signal = signals.filter((s) => s.t <= press.command.t).at(-1);
      // The signal event is stamped on the step grid, the instant it falls on is not.
      expect(press.command.t - (signal?.t ?? 0)).toBeGreaterThanOrEqual(240);
      expect(press.command.t - (signal?.t ?? 0)).toBeLessThanOrEqual(250);
    }
  });

  it('even aiming far before the signal it cannot be early: a reaction has a floor', async () => {
    const { events } = await playDuel('human', 2, { aimOffsetMs: -1000 }, 30_000);
    const answered = eyes(events);
    expect(answered.length).toBeGreaterThanOrEqual(1);
    expect(answered.some((response) => response.reason === 'early')).toBe(false);
  });

  it('too slow to react, every round is late and the duel is lost', async () => {
    const { events } = await playDuel('human', 1, { reactionMs: 600 }, 60_000);
    const answered = eyes(events);
    expect(answered).toHaveLength(3);
    for (const response of answered)
      expect(response).toMatchObject({ quality: 'fail', reason: 'late' });
    expect(events.filter((event) => event.type === 'SequenceEnded')).toEqual([
      expect.objectContaining({ outcome: 'failed' }),
    ]);
  });
});

describe('the bots and the feint of a fake sleep (story 4.7)', () => {
  /** The fake sleep alone, as a duel of one round, played by `id`. */
  async function playFakeSleep(
    id: 'perfect' | 'human' | 'idle',
    seed: number,
    human: Partial<typeof NO_JITTER> = {},
    untilSimMs = 60_000,
  ) {
    const def = createTestFakeSleepRound();
    const level = createTestLevel({
      carry: CARRY,
      sequences: [def.id],
      sequenceDefs: { [def.id]: def },
    });
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level,
      seed,
      strictInvariants: true,
    });
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: def.id });
    const events: SimEvent[] = [];
    const settings = { human: legacyHuman({ ...NO_JITTER, ...human }) };
    playGame(sim, makeBot(id, botSetup(seed, settings, level)), untilSimMs, (event) =>
      events.push({ ...event }),
    );
    return { sim, events };
  }

  it('the perfect bot reads the drawn signal, so the feint cannot fool it: perfect, offset 0', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { events } = await playFakeSleep('perfect', seed);
      expect(events.filter((event) => event.type === 'WaitFeintGiven')).toHaveLength(1);
      expect(eyes(events)).toHaveLength(1);
      expect(eyes(events)[0]).toMatchObject({ quality: 'perfect', offsetMs: 0 });
    }
  });

  it('the human bot never presses before the signal on a fake sleep, over many seeds', async () => {
    let presses = 0;
    let feints = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { sim, events } = await playFakeSleep('human', seed, { jitterSdMs: 60 }, 40_000);
      expect(eyes(events).filter((response) => response.reason === 'early')).toEqual([]);
      feints += events.filter((event) => event.type === 'WaitFeintGiven').length;
      const signals = events.filter((event) => event.type === 'WaitSignalGiven');
      for (const entry of sim.journal().entries) {
        if (entry.command.type !== 'PressThreat') continue;
        presses++;
        const lastSignal = signals.filter((signal) => signal.t <= entry.command.t).at(-1);
        expect(lastSignal, `a press at ${entry.command.t} with no signal before it`).toBeDefined();
      }
    }
    // The feint did come (a round a game, one feint each), and the bot did press: it simply never
    // reacted to the feint.
    expect(feints).toBeGreaterThanOrEqual(40);
    expect(presses).toBeGreaterThanOrEqual(40);
  }, 60_000);

  it('the human bot draws nothing of its own for the feint: its press is the first of its draws', async () => {
    const human = { reactionMs: 250, aimOffsetMs: 10, jitterSdMs: 60 };
    for (const seed of [1, 2, 3]) {
      const { sim, events } = await playFakeSleep('human', seed, human, 30_000);
      const presses = sim.journal().entries.filter((entry) => entry.command.type === 'PressThreat');
      const signals = events.filter((event) => event.type === 'WaitSignalGiven');
      expect(presses.length).toBeGreaterThanOrEqual(1);
      // Replays the bot's own stream: one `nextGaussian` per plan, in order, nothing else drawn.
      const rng = createRng(botSeed(seed));
      const reactionAt = (signalAt: number) =>
        signalAt + human.reactionMs + human.aimOffsetMs + human.jitterSdMs * nextGaussian(rng);
      const first = events.find((event) => event.type === 'WaitSignalGiven');
      expect(first).toBeDefined();
      const expected = Math.round(reactionAt(first?.t ?? 0));
      // The signal event is stamped on the step grid, the instant it falls on is not: within one step.
      expect(Math.abs((presses[0]?.command.t ?? 0) - expected)).toBeLessThanOrEqual(10);
      expect(signals.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('the idle bot answers nothing, so the round is late, feint or not', async () => {
    const { events } = await playFakeSleep('idle', 1);
    const answered = eyes(events);
    expect(answered.length).toBeGreaterThanOrEqual(1);
    for (const response of answered) expect(response).toMatchObject({ reason: 'late' });
  });
});

describe('the idle bot and a wait threat', () => {
  it('answers nothing, so every round is late', async () => {
    const { events } = await playDuel('idle', 1);
    const answered = eyes(events);
    expect(answered).toHaveLength(3);
    for (const response of answered) expect(response).toMatchObject({ reason: 'late' });
  });
});

describe('the human bot and a parry: its draws are unchanged (story 4.6)', () => {
  it.each([1, 2, 3])(
    'seed %i: each press is the first of its rng draws, aimed at the centre, floored by the reaction',
    async (seed) => {
      const human = { reactionMs: 250, aimOffsetMs: 10, jitterSdMs: 60 };
      const { sim, events } = await playBotGame('human', seed, {
        untilSimMs: 30_000,
        settings: { human: legacyHuman(human) },
      });
      const presses = sim.journal().entries.filter((entry) => entry.command.type === 'PressThreat');
      const telegraphs = events.filter((event) => event.type === 'ThreatTelegraphed');
      expect(presses.length).toBeGreaterThanOrEqual(3);
      // Replays the bot's own stream: one `nextGaussian` per plan, in order, nothing else drawn.
      const rng = createRng(botSeed(seed));
      for (let i = 0; i < 3; i++) {
        const telegraph = telegraphs[i] as (typeof telegraphs)[number];
        const { windowMs } = responses(events)[i]?.responseWindow ?? { windowMs: 0 };
        const centre = telegraph.t + 1200 + windowMs / 2;
        const aim = centre + human.aimOffsetMs + human.jitterSdMs * nextGaussian(rng);
        const expected = Math.max(
          Math.round(Math.max(telegraph.t + human.reactionMs, aim)),
          telegraph.t,
        );
        expect(presses[i]?.command.t, `press ${i}`).toBe(expected);
      }
    },
  );
});
