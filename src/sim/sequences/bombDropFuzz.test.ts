import { createRng, nextInt } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBombDrop,
  createTestBombDropLay,
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

// A fuzz of fingers at the bomb drop (story 4.8). Each round is answered by one of five hands, drawn
// from a seeded rng of the test (never the sim's): a perfect drop, a quick tap, a hold that never lets
// go, a press that comes too late, and a release away from the pose. Whatever the finger does,
// `retreats` stays below `maxRetreats`, no invariant fires, the sequence ends once at most, a win lays
// the baby down in the step of the release and cashes the combo in, and a loss leaves him in the arms.
// `human` and `perfect` never exercise a wrong release alone: this does.
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestBombDrop();
const LAY = createTestBombDropLay();
const MAX_RETREATS = DEF.failure.kind === 'retreats' ? DEF.failure.maxRetreats : Number.NaN;
const { pressWithinMs } = LAY.release ?? { pressWithinMs: Number.NaN };
const { toleranceMs } = content.feel.timing;
const windowMs = LAY.windowMs ?? content.feel.timing.windowMs;

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

interface Game {
  readonly events: SimEvent[];
  readonly babyStateAtEnd: string;
}

/** Each seed's game, played once: the per-seed tests and the aggregate one read the same game. */
const gamesBySeed = new Map<number, Promise<Game>>();

function playSeed(seed: number): Promise<Game> {
  let game = gamesBySeed.get(seed);
  if (game === undefined) {
    game = playFuzzedDrop(seed);
    gamesBySeed.set(seed, game);
  }
  return game;
}

async function playFuzzedDrop(seed: number): Promise<Game> {
  const sim = await createSim({
    content,
    geometry,
    level: createTestLevel({ carry: CARRY, sequences: [DEF.id] }),
    seed,
  });
  const world = sim.world as World;
  const lay = world.threats.find((candidate) => candidate.defId === LAY.id);
  if (lay === undefined) throw new Error('no bomb drop instance');
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: DEF.id });
  const rng = createRng(seed * 7919);
  const events: SimEvent[] = [];
  let answeredAt = -1;
  for (let i = 0; i < 6000; i++) {
    if (lay.state === 'telegraph' && lay.enteredAt !== answeredAt) {
      answeredAt = lay.enteredAt;
      const press = (t: number) =>
        sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: lay.id });
      const release = (t: number) => sim.enqueue({ type: 'Release', t: asSimMs(t) });
      const hand = nextInt(rng, 0, 100);
      if (hand < 35) {
        press(lay.enteredAt + nextInt(rng, 20, pressWithinMs));
        release(lay.windowOpenAt + windowMs / 2 + nextInt(rng, -80, 80));
      } else if (hand < 50) {
        press(lay.enteredAt + nextInt(rng, 20, pressWithinMs));
        release(lay.enteredAt + nextInt(rng, 800, 1500));
      } else if (hand < 65) {
        press(lay.enteredAt + nextInt(rng, 20, pressWithinMs));
      } else if (hand < 80) {
        press(lay.enteredAt + pressWithinMs + toleranceMs + nextInt(rng, 1, 400));
      } else {
        press(lay.enteredAt + nextInt(rng, 20, pressWithinMs));
        release(lay.windowOpenAt + (nextInt(rng, 0, 2) === 0 ? -400 : windowMs + 400));
      }
    }
    sim.step();
    events.push(...sim.drainEvents());
    expect(world.sequence.duel.retreats).toBeGreaterThanOrEqual(0);
    expect(world.sequence.duel.retreats).toBeLessThan(MAX_RETREATS);
    if (world.sequence.id === null && world.time.sim > 50) break;
  }
  expect(world.flow.state).toBe('playing');
  return { events, babyStateAtEnd: world.baby.state };
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

describe('the bomb drop under random fingers (story 4.8)', () => {
  it.each(SEEDS)(
    'seed %i ends once, fires no invariant, and a win cashes in while a loss keeps him in the arms',
    async (seed) => {
      const { events, babyStateAtEnd } = await playSeed(seed);
      expect(events.map((event) => event.type)).not.toContain('InvariantViolated');
      const ends = ofType(events, 'SequenceEnded');
      expect(ends).toHaveLength(1);
      const [end] = ends;
      if (end?.outcome === 'succeeded') {
        const cashedIn = ofType(events, 'ComboCashedIn');
        expect(cashedIn).toHaveLength(1);
        expect(cashedIn[0]?.t).toBe(end.t);
        expect(ofType(events, 'BabyPutDown')).toEqual([
          expect.objectContaining({ t: end.t, safe: true }),
        ]);
        expect(babyStateAtEnd).toBe('babble');
        expect(ofType(events, 'BabyWoke')).toEqual([]);
      } else {
        expect(end?.outcome).toBe('failed');
        expect(ofType(events, 'BabyPutDown')).toEqual([]);
        expect(ofType(events, 'ComboCashedIn')).toEqual([]);
        expect(ofType(events, 'BabyWoke')).toHaveLength(1);
        expect(babyStateAtEnd).toBe('carried');
      }
      // Every retreat is a gag of the one threat, and there are never `maxRetreats` of them in a row alive.
      expect(ofType(events, 'SequenceStepRetreated').length).toBeLessThan(MAX_RETREATS);
    },
  );

  it('exercised a win, a retreat, a loss and an end across the seeds', async () => {
    const games = await Promise.all(SEEDS.map(playSeed));
    const outcomes = games.flatMap((game) =>
      ofType(game.events, 'SequenceEnded').map((event) => event.outcome),
    );
    expect(outcomes).toContain('succeeded');
    expect(outcomes).toContain('failed');
    expect(games.some((game) => ofType(game.events, 'SequenceStepRetreated').length > 0)).toBe(
      true,
    );
    // Each of the hands reached the judgement: a release too early, a release too late, a press too late.
    const reasons = games.flatMap((game) =>
      ofType(game.events, 'GagTriggered').map((event) => event.reason),
    );
    expect(reasons).toContain('released');
    expect(reasons).toContain('late');
    const qualities = games.flatMap((game) =>
      ofType(game.events, 'ResponseResolved').map((event) => event.quality),
    );
    expect(qualities.some((quality) => quality === 'perfect' || quality === 'success')).toBe(true);
  });
});
