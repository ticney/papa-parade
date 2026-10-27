import type { LevelContent } from '@content/contentBundle';
import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

const content = createTestContent();
const geometry = createTestGeometry();

async function newSim(level: LevelContent, seed = 1): Promise<Sim> {
  return createSim({ content, geometry, level, seed });
}

function runTo(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const telegraphs = (events: readonly SimEvent[]) =>
  events.filter(
    (event): event is Extract<SimEvent, { type: 'ThreatTelegraphed' }> =>
      event.type === 'ThreatTelegraphed',
  );

describe('runDirector', () => {
  it('does nothing in a level that plans nothing', async () => {
    const sim = await newSim(createTestLevel());
    expect(telegraphs(runTo(sim, 30_000))).toEqual([]);
    expect(sim.world.threats).toEqual([]);
  });

  it('waits for fromMs', async () => {
    const sim = await newSim(createTestLevel([outletEntry(3000)]));
    expect(telegraphs(runTo(sim, 2990))).toEqual([]);
    expect(sim.world.threats[0]?.state).toBe('idle');
    expect(telegraphs(runTo(sim, 3000))).toEqual([
      expect.objectContaining({ t: 3000, threatId: 1, kind: 'outlet', anchorId: 'outlet_01' }),
    ]);
  });

  it('targets the first idle threat that is due, one at a time', async () => {
    // The first is planned later than the second: before 1000 only the second can be targeted.
    const sim = await newSim(createTestLevel([outletEntry(1000), outletEntry(0)]));
    expect(telegraphs(runTo(sim, 20))).toEqual([expect.objectContaining({ threatId: 2 })]);
    expect(sim.world.threats.map((threat) => threat.state)).toEqual(['idle', 'telegraph']);
    // While one is active the other is never targeted, even when due.
    expect(telegraphs(runTo(sim, 1500))).toEqual([]);
  });

  it('targets again once the threat is rearmed and the baby is free', async () => {
    const sim = await newSim(createTestLevel([outletEntry(0)]));
    // No press: the outlet gags, the baby plays its mischief for actMs, the cooldown is 6000 ms.
    const events = runTo(sim, 20_000);
    const gag = events.find((event) => event.type === 'GagTriggered');
    expect(gag).toBeDefined();
    const gagAt = (gag as { t: number }).t;
    const all = telegraphs(events);
    expect(all.length).toBeGreaterThanOrEqual(2);
    const next = all[1];
    expect(next?.t).toBeGreaterThanOrEqual(gagAt + 6000);
    // Not targeted while the baby is still in `act`: only once it babbles (or wanders) again.
    const acts = events.filter(
      (event) => event.type === 'BabyStateChanged' && event.to === 'act',
    ) as { t: number }[];
    const actEndsAt = (acts[0]?.t ?? 0) + content.feel.baby.actMs;
    expect(actEndsAt).toBeLessThanOrEqual(next?.t ?? 0);
    // Targeted as soon as both the cooldown is over and the baby is free: it does not wait for a babble.
    expect(next?.t).toBeLessThanOrEqual(Math.max(gagAt + 6000, actEndsAt) + STEP_MS * 2);
  });

  it('never targets while the baby is in act', async () => {
    const feel = createTestContent();
    feel.feel.baby.actMs = 10_000;
    const level = createTestLevel([outletEntry(0)]);
    const def = level.threats.outlet;
    if (def === undefined) throw new Error('no outlet');
    const sim = await createSim({
      content: feel,
      geometry,
      level: { ...level, threats: { outlet: { ...def, cooldownMs: 0 } } },
      seed: 1,
    });
    const events = runTo(sim, 9000);
    // Rearmed at once after the gag, but the baby plays for 10 s: no second telegraph yet.
    expect(telegraphs(events)).toHaveLength(1);
    expect(sim.world.baby.state).toBe('act');
    expect(sim.world.threats[0]?.state).toBe('idle');
  });

  it('draws nothing from the rng: the same schedule for every seed', async () => {
    const firstTimes: number[] = [];
    for (const seed of [1, 2, 3]) {
      const sim = await newSim(createTestLevel([outletEntry(200)]), seed);
      firstTimes.push(telegraphs(runTo(sim, 400))[0]?.t ?? -1);
    }
    expect(firstTimes).toEqual([200, 200, 200]);
  });
});
