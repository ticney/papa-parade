import { describe, expect, it, vi } from 'vitest';
import {
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  STAIRS,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';

// The séquelles of story 3.15 switched off (`applyAfterEffect` does nothing): the level of the director's
// baseline trace must end on the rng state captured before story 1.21, which is the proof that the séquelles
// moved no draw on their own. What they change in the game (and so in the trace of `directorSystem.test.ts`) is
// what follows a gag, never how the rng is drawn.
vi.mock('../threats/afterEffects.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../threats/afterEffects.ts')>()),
  applyAfterEffect: () => {},
}));

describe('the baseline trace without the séquelles (story 3.15)', () => {
  it('ends on the rng state captured before story 1.21', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({
        waves: [
          testWave([OUTLET, STAIRS, COFFEE_TABLE], {
            maxSimultaneous: 2,
            gapMinMs: 1000,
            gapMaxMs: 3000,
            lullMs: 1000,
          }),
        ],
        gauges: FATIGUE_GAUGES,
      }),
      seed: 7,
    });
    while (sim.world.time.sim < 60_000) {
      sim.step();
      sim.drainEvents();
    }
    expect(sim.world.rng).toEqual({ a: 1581132668, b: 1663718832, c: 1567227279, d: 81 });
  });
});
