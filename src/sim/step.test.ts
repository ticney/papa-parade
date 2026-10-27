import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../../tests/support/testContent.ts';
import type { System } from './context.ts';
import { createSimWithSystems } from './createSim.ts';
import { SYSTEMS } from './step.ts';

describe('system order', () => {
  it('is pinned: changing it is a deliberate edit (and a golden regeneration)', () => {
    expect(SYSTEMS.map((system) => system.name)).toEqual([
      'applyCommands',
      'advanceTime',
      'runPapa',
    ]);
  });

  it('runs the given systems in order, once per step', async () => {
    const calls: string[] = [];
    const first: System = () => calls.push('first');
    const second: System = () => calls.push('second');
    const sim = await createSimWithSystems(
      { content: createTestContent(), geometry: createTestGeometry(), seed: 1 },
      [first, second],
    );
    sim.step();
    sim.step();
    expect(calls).toEqual(['first', 'second', 'first', 'second']);
    // No time system in the list: the clock does not move by itself.
    expect(sim.world.time.sim).toBe(0);
  });
});
