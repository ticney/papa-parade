import { STEP_MS } from '@shared/constants';
import { createRng, nextInt } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBedtimeDuel,
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

// A fuzz of random presses at the bedtime duel (story 4.6): whatever the finger does, `retreats`
// stays below `maxRetreats` (the slice's own bound), no invariant fires (strict in tests), and the
// sequence ends once at most.
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestBedtimeDuel();
const MAX_RETREATS = DEF.failure.kind === 'retreats' ? DEF.failure.maxRetreats : Number.NaN;

describe('the bedtime duel under random presses', () => {
  it.each(Array.from({ length: 30 }, (_, i) => i + 1))(
    'seed %i keeps retreats in range and fires no invariant',
    async (seed) => {
      const sim = await createSim({
        content,
        geometry,
        level: createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'] }),
        seed,
      });
      const world = sim.world as World;
      const eyes = world.threats.find((threat) => threat.defId === 'bedtime_eyes');
      if (eyes === undefined) throw new Error('no eyes');
      sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bedtime_duel' });
      const rng = createRng(seed * 7919);
      const events: SimEvent[] = [];
      for (let i = 0; i < 4000; i++) {
        // A press about every 400 ms, held for a random time: some early, some late, some held.
        if (nextInt(rng, 0, 40) === 0) {
          const t = world.time.sim + STEP_MS;
          sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: eyes.id });
          sim.enqueue({ type: 'Release', t: asSimMs(t + nextInt(rng, 10, 400)) });
        }
        sim.step();
        events.push(...sim.drainEvents());
        expect(world.sequence.duel.retreats).toBeGreaterThanOrEqual(0);
        expect(world.sequence.duel.retreats).toBeLessThan(MAX_RETREATS);
        if (world.sequence.id === null && world.time.sim > STEP_MS) break;
      }
      expect(events.map((event) => event.type)).not.toContain('InvariantViolated');
      expect(events.filter((event) => event.type === 'SequenceEnded').length).toBeLessThanOrEqual(
        1,
      );
      expect(world.flow.state).not.toBe('ended');
    },
  );
});
