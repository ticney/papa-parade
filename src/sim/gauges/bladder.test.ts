import type { Feel } from '@content/schemas/feel';
import { MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NEED_GAUGES,
  stepN,
  TEST_OBJECTS,
  TEST_TOILET,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

const base = createTestContent();
const geometry = createTestGeometry();
const { perSec } = base.feel.bladder;

async function newSim(
  options: { need?: boolean; bladder?: Partial<Feel['bladder']> } = {},
): Promise<Sim> {
  const feel = { ...base.feel, bladder: { ...base.feel.bladder, ...options.bladder } };
  return createSim({
    content: { ...base, feel },
    geometry,
    level: createTestLevel({
      objects: [...TEST_OBJECTS, TEST_TOILET],
      gauges: options.need === false ? FATIGUE_GAUGES : { ...NEED_GAUGES, ...FATIGUE_GAUGES },
    }),
    seed: 1,
  });
}

const worldOf = (sim: Sim) => sim.world as World;

/** Steps `n` times and returns every event emitted. */
function stepEvents(sim: Sim, n = 1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const setBladder = (sim: Sim, pct: number) =>
  sim.enqueue({ type: 'SetBladder', t: asSimMs(sim.world.time.sim), pct });

describe('the pressing need (story 4.3)', () => {
  it('starts at feel.bladder.startPct and rises exactly perSec over a known span', async () => {
    const sim = await newSim({ bladder: { startPct: 10 } });
    expect(sim.world.gauges.bladderPct).toBe(10);
    const steps = 500; // 5 s
    stepN(sim, steps);
    expect(sim.world.gauges.bladderPct).toBeCloseTo(10 + (perSec * steps * STEP_MS) / MS_PER_S, 9);
    expect(sim.world.gauges.isBladderFull).toBe(false);
  });

  it('clamps at 100 with a single BladderFilled and no second one', async () => {
    const sim = await newSim({ bladder: { startPct: 99.99 } });
    const events = stepEvents(sim, 50);
    expect(sim.world.gauges.bladderPct).toBe(100);
    expect(sim.world.gauges.isBladderFull).toBe(true);
    expect(events.filter((event) => event.type === 'BladderFilled')).toHaveLength(1);
    // 99.99 + 3 steps of 0.004 is the first sum at or above 100: the step is the third one.
    expect(events.find((event) => event.type === 'BladderFilled')?.t).toBe(3 * STEP_MS);
  });

  it('is a no-op in a level without gauges.need: nothing written, no event, whatever the commands', async () => {
    const sim = await newSim({ need: false, bladder: { startPct: 60 } });
    expect(sim.world.gauges.bladderPct).toBe(0);
    setBladder(sim, 100);
    const events = stepEvents(sim, 300);
    expect(sim.world.gauges.bladderPct).toBe(0);
    expect(sim.world.gauges.isBladderFull).toBe(false);
    expect(events.filter((event) => event.type === 'BladderFilled')).toEqual([]);
  });

  it('is frozen while Papa is on the toilet, and rises during a coffee', async () => {
    const sim = await newSim({ bladder: { startPct: 20 } });
    const world = worldOf(sim);
    sim.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'coffee_machine' });
    for (let i = 0; i < 3000 && world.papa.state !== 'drink'; i++) stepEvents(sim);
    expect(world.papa.state).toBe('drink');
    const before = world.gauges.bladderPct;
    stepN(sim, 100);
    expect(world.papa.state).toBe('drink');
    expect(world.gauges.bladderPct).toBeCloseTo(before + (perSec * 100 * STEP_MS) / MS_PER_S, 9);

    const toilet = await newSim({ bladder: { startPct: 20, toiletDurationMs: 60_000 } });
    toilet.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'toilet' });
    for (let i = 0; i < 3000 && worldOf(toilet).papa.state !== 'onToilet'; i++) stepEvents(toilet);
    expect(worldOf(toilet).papa.state).toBe('onToilet');
    const frozen = toilet.world.gauges.bladderPct;
    stepN(toilet, 500);
    expect(worldOf(toilet).papa.state).toBe('onToilet');
    expect(toilet.world.gauges.bladderPct).toBe(frozen);
  });

  it('follows a slowFromPct lowered by SetFeel at the next step, with one BladderFilled', async () => {
    const sim = await newSim({ bladder: { startPct: 50 } });
    stepEvents(sim, 10);
    expect(sim.world.gauges.isBladderFull).toBe(false);
    sim.enqueue({
      type: 'SetFeel',
      t: asSimMs(sim.world.time.sim),
      patch: { bladder: { slowFromPct: 40 } },
    });
    const events = stepEvents(sim, 5);
    expect(sim.world.gauges.isBladderFull).toBe(true);
    expect(events.filter((event) => event.type === 'BladderFilled')).toHaveLength(1);
  });

  it('lets SetBladder win the step, holds it in [0, 100], and emits BladderFilled once per crossing', async () => {
    const sim = await newSim();
    setBladder(sim, 250);
    let events = stepEvents(sim);
    expect(sim.world.gauges.bladderPct).toBe(100);
    expect(events.filter((event) => event.type === 'BladderFilled')).toHaveLength(1);
    setBladder(sim, 33);
    events = stepEvents(sim);
    // The commanded value is the step's final one, not 33 + a step's gain.
    expect(sim.world.gauges.bladderPct).toBe(33);
    expect(sim.world.gauges.isBladderFull).toBe(false);
    expect(events.filter((event) => event.type === 'BladderFilled')).toEqual([]);
    setBladder(sim, -5);
    stepEvents(sim);
    expect(sim.world.gauges.bladderPct).toBe(0);
    setBladder(sim, 100);
    events = stepEvents(sim);
    expect(events.filter((event) => event.type === 'BladderFilled')).toHaveLength(1);
  });

  it('draws nothing from world.rng: a level with the gauge and one without end on the same state', async () => {
    const withNeed = await newSim({ bladder: { startPct: 90 } });
    const without = await newSim({ need: false });
    setBladder(withNeed, 100);
    stepN(withNeed, 300);
    stepN(without, 300);
    expect(worldOf(withNeed).gauges.isBladderFull).toBe(true);
    expect(worldOf(withNeed).rng).toEqual(worldOf(without).rng);
  });
});
