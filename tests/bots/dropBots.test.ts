import { botSeed } from '@bots/botSeed';
import { nextGaussian } from '@bots/gaussian';
import { playGame } from '@bots/playGame';
import { createRng } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { createSim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { botSetup, makeBot, responses } from '../support/botSupport.ts';
import {
  CARRY,
  createTestBombDrop,
  createTestBombDropLay,
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../support/testContent.ts';

// The bots and the bomb drop (story 4.8): `perfect` presses at the first step of the descent and lets go
// at the centre of the window, `human` presses `reactionMs` after the telegraph and lets go around the
// centre with one draw, `idle` does nothing and loses on its third gag. The frozen content: a 2600 ms
// descent, a press within 700 ms, a 300 ms window, three retreats to lose.
const LAY = createTestBombDropLay();
const DEF = createTestBombDrop();
const MAX_RETREATS = DEF.failure.kind === 'retreats' ? DEF.failure.maxRetreats : Number.NaN;
const NO_JITTER = { reactionMs: 250, aimOffsetMs: 0, jitterSdMs: 0 };
const level = () => createTestLevel({ carry: CARRY, sequences: ['bomb_drop'] });

async function playDrop(
  id: 'perfect' | 'human' | 'idle' | 'random',
  seed: number,
  human: Partial<typeof NO_JITTER> = {},
  untilSimMs = 60_000,
) {
  const lvl = level();
  const sim = await createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: lvl,
    seed,
    strictInvariants: true,
  });
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bomb_drop' });
  const events: SimEvent[] = [];
  const settings = { human: { ...NO_JITTER, ...human } };
  playGame(sim, makeBot(id, botSetup(seed, settings, lvl)), untilSimMs, (event) =>
    events.push({ ...event }),
  );
  return { sim, events };
}

const drops = (events: readonly SimEvent[]) =>
  responses(events).filter((event) => event.response === 'firm');
const telegraphs = (events: readonly SimEvent[]) =>
  events.filter((event) => event.type === 'ThreatTelegraphed');

describe('the perfect bot and the bomb drop', () => {
  it.each([1, 2, 3, 4, 5])(
    'lays the baby perfectly on seed %i: one perfect response, the baby down, the combo cashed',
    async (seed) => {
      const { events, sim } = await playDrop('perfect', seed);
      expect(drops(events)).toEqual([expect.objectContaining({ quality: 'perfect', offsetMs: 0 })]);
      expect(events.filter((event) => event.type === 'SequenceStepRetreated')).toEqual([]);
      expect(events.filter((event) => event.type === 'SequenceEnded')).toEqual([
        expect.objectContaining({ outcome: 'succeeded' }),
      ]);
      expect(events.filter((event) => event.type === 'BabyPutDown')).toEqual([
        expect.objectContaining({ safe: true }),
      ]);
      expect(events.filter((event) => event.type === 'ComboCashedIn')).toHaveLength(1);
      expect(sim.world.baby.state).not.toBe('carried');
    },
  );

  it('presses at the first step of the telegraph and lets go at the centre, to the ms', async () => {
    const { sim, events } = await playDrop('perfect', 1);
    const [telegraph] = telegraphs(events);
    const [press, release] = sim
      .journal()
      .entries.filter((entry) => ['PressThreat', 'Release'].includes(entry.command.type));
    expect(press?.command.t).toBe(telegraph?.t);
    const windowMs = LAY.windowMs ?? 0;
    const delayMs = LAY.telegraphDelayMs ?? 0;
    expect(release?.command.t).toBe((telegraph?.t ?? 0) + delayMs + windowMs / 2);
  });
});

describe('the human bot and the bomb drop', () => {
  it('presses reactionMs after the telegraph and lets go at the aim: one draw, in whole ms', async () => {
    const { sim, events } = await playDrop('human', 1, { reactionMs: 300, aimOffsetMs: 80 });
    const [telegraph] = telegraphs(events);
    const [press, release] = sim
      .journal()
      .entries.filter((entry) => ['PressThreat', 'Release'].includes(entry.command.type));
    const windowMs = LAY.windowMs ?? 0;
    const delayMs = LAY.telegraphDelayMs ?? 0;
    expect(press?.command.t).toBe((telegraph?.t ?? 0) + 300);
    expect(release?.command.t).toBe((telegraph?.t ?? 0) + delayMs + windowMs / 2 + 80);
    expect(drops(events)).toEqual([expect.objectContaining({ quality: 'success' })]);
  });

  it('draws exactly one gaussian per round, the same stream as a parry', async () => {
    const jitter = 40;
    const { sim, events } = await playDrop('human', 3, { jitterSdMs: jitter });
    const rng = createRng(botSeed(3));
    const [telegraph] = telegraphs(events);
    const windowMs = LAY.windowMs ?? 0;
    const delayMs = LAY.telegraphDelayMs ?? 0;
    const expected = Math.round(
      (telegraph?.t ?? 0) + delayMs + windowMs / 2 + jitter * nextGaussian(rng),
    );
    const [, release] = sim
      .journal()
      .entries.filter((entry) => ['PressThreat', 'Release'].includes(entry.command.type));
    expect(release?.command.t).toBe(expected);
  });

  it('wins the drop over many seeds with a plausible hand, and gags only by `released` or `late`', async () => {
    let wins = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const { events } = await playDrop('human', seed, { jitterSdMs: 60 }, 40_000);
      for (const response of drops(events)) {
        if (response.quality === 'fail') {
          expect(['released', 'late']).toContain(response.reason);
        }
      }
      if (events.some((event) => event.type === 'SequenceEnded' && event.outcome === 'succeeded')) {
        wins++;
      }
    }
    expect(wins).toBeGreaterThan(0);
  }, 60_000);
});

describe('the idle bot and the random bot at the bomb drop', () => {
  it.each([1, 2, 3, 4, 5])(
    'the idle bot loses it on seed %i: three late gags with no offset, two retreats, then the baby wakes',
    async (seed) => {
      const { events, sim } = await playDrop('idle', seed);
      const answered = drops(events);
      expect(answered).toHaveLength(MAX_RETREATS);
      for (const response of answered) {
        expect(response).toMatchObject({ quality: 'fail', reason: 'late', offsetMs: null });
      }
      expect(events.filter((event) => event.type === 'SequenceStepRetreated')).toHaveLength(
        MAX_RETREATS - 1,
      );
      expect(events.filter((event) => event.type === 'BabyWoke')).toHaveLength(1);
      expect(sim.world.baby.state).toBe('carried');
    },
  );

  it('the random bot plays it end to end with strict invariants on', async () => {
    const { events } = await playDrop('random', 7, {}, 40_000);
    expect(events.map((event) => event.type)).not.toContain('InvariantViolated');
    expect(events.some((event) => event.type === 'SequenceStarted')).toBe(true);
  });
});
