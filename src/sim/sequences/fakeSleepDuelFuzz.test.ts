import { STEP_MS } from '@shared/constants';
import { createRng, nextInt } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestFakeSleepDuel,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

// A fuzz of random presses at the duel with the fake sleep (story 4.7), the twin of the bedtime duel's:
// whatever the finger does, `retreats` stays below `maxRetreats`, no invariant fires (strict in tests),
// the sequence ends once at most, and a feint is never given twice in one telegraph. The presses fall
// on the eyes and on the fake sleep alike, so some land before the feint, on it, after it and in the window.
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestFakeSleepDuel();
const MAX_RETREATS = DEF.failure.kind === 'retreats' ? DEF.failure.maxRetreats : Number.NaN;

const SEEDS = Array.from({ length: 30 }, (_, i) => i + 1);

/** Each seed's game, played once: the per-seed tests and the aggregate one read the same events. */
const gamesBySeed = new Map<number, Promise<SimEvent[]>>();

function playSeed(seed: number): Promise<SimEvent[]> {
  let game = gamesBySeed.get(seed);
  if (game === undefined) {
    game = playFuzzedDuel(seed);
    gamesBySeed.set(seed, game);
  }
  return game;
}

async function playFuzzedDuel(seed: number): Promise<SimEvent[]> {
  const sim = await createSim({
    content,
    geometry,
    level: createTestLevel({ carry: CARRY, sequences: [DEF.id] }),
    seed,
  });
  const world = sim.world as World;
  const ids = ['bedtime_eyes', 'fake_sleep'].map((defId) => {
    const threat = world.threats.find((candidate) => candidate.defId === defId);
    if (threat === undefined) throw new Error(`no ${defId}`);
    return threat.id;
  });
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: DEF.id });
  const rng = createRng(seed * 7919);
  const events: SimEvent[] = [];
  // The windows already answered (by threat id and instant): the finger reacts once to a signal.
  const answered = new Set<string>();
  for (let i = 0; i < 4000; i++) {
    // A wild press about every 3 s, on either threat, held for a random time: some before the
    // feint, some on it, some in the window. Wilder than that, no game would get past the eyes.
    if (nextInt(rng, 0, 300) === 0) {
      const t = world.time.sim + STEP_MS;
      const threatId = ids[nextInt(rng, 0, ids.length)] as number;
      sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId });
      sim.enqueue({ type: 'Release', t: asSimMs(t + nextInt(rng, 10, 400)) });
    }
    // And a sensible one, most of the time, once a window opens: the finger reacts to the signal.
    // (`windowOpenAt` may be off the step grid: the window is seen open on the step that opens it.)
    for (const threat of world.threats) {
      if (!ids.includes(threat.id) || threat.state !== 'windowOpen') continue;
      const key = `${threat.id}@${threat.windowOpenAt}`;
      if (answered.has(key)) continue;
      answered.add(key);
      if (nextInt(rng, 0, 10) < 7) {
        const t = world.time.sim + 200 + nextInt(rng, 0, 60);
        sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: threat.id });
        sim.enqueue({ type: 'Release', t: asSimMs(t + 40) });
      }
    }
    sim.step();
    events.push(...sim.drainEvents());
    expect(world.sequence.duel.retreats).toBeGreaterThanOrEqual(0);
    expect(world.sequence.duel.retreats).toBeLessThan(MAX_RETREATS);
    if (world.sequence.id === null && world.time.sim > STEP_MS) break;
  }
  expect(world.flow.state).not.toBe('ended');
  return events;
}

describe('the duel with the fake sleep under random presses', () => {
  it.each(SEEDS)(
    'seed %i keeps retreats in range, fires no invariant and never gives a feint twice',
    async (seed) => {
      const events = await playSeed(seed);
      expect(events.map((event) => event.type)).not.toContain('InvariantViolated');
      expect(events.filter((event) => event.type === 'SequenceEnded').length).toBeLessThanOrEqual(
        1,
      );
      // One feint per telegraph at most: between two telegraphs of a threat, at most one feint of it.
      const feintsSinceTelegraph = new Map<number, number>();
      for (const event of events) {
        if (event.type === 'ThreatTelegraphed') feintsSinceTelegraph.set(event.threatId, 0);
        if (event.type === 'WaitFeintGiven') {
          const count = (feintsSinceTelegraph.get(event.threatId) ?? 0) + 1;
          feintsSinceTelegraph.set(event.threatId, count);
          expect(count).toBe(1);
        }
      }
    },
  );

  // The presses must have reached the fake sleep: across the seeds, a feint was given and a retreat came.
  it('exercised the feint (some feints given, some retreats, some results, some ends)', async () => {
    const games = await Promise.all(SEEDS.map(playSeed));
    const all = games.flat().map((event) => event.type);
    expect(all).toContain('WaitFeintGiven');
    expect(all).toContain('SequenceStepRetreated');
    expect(all).toContain('ResponseResolved');
    expect(all).toContain('SequenceEnded');
    // A press stamped before the signal did gag a fake sleep at least once, across the 30 seeds.
    const earlyGags = games
      .flat()
      .filter(
        (event) =>
          event.type === 'GagTriggered' && event.gag === 'baby_sat_up' && event.reason === 'early',
      );
    expect(earlyGags.length).toBeGreaterThan(0);
  });
});
