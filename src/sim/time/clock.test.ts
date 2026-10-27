import { describe, expect, it } from 'vitest';
import { createTestContent, stepN } from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';

describe('advanceTime', () => {
  it('adds exactly STEP_MS per step, with whole-ms values', async () => {
    const sim = await createSim({ content: createTestContent(), seed: 1 });
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      sim.step();
      seen.push(sim.world.time.sim);
    }
    expect(seen).toEqual([10, 20, 30, 40, 50]);
    stepN(sim, 10000);
    expect(Number.isInteger(sim.world.time.sim)).toBe(true);
    expect(sim.world.time.sim).toBe(100050);
  });
});
