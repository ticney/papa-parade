import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  NOISE_GAUGES,
  TEST_OBJECTS,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

const DURATION_MS = 15_000;
const content = createTestContent();
const RUSH_AT = DURATION_MS - content.feel.endOfLevel.finalRushMs;
const SIGH_POINTS = content.feel.mama.sighPerPropOnFloorPoints;

interface Options {
  finalRush?: boolean;
  noise?: boolean;
  objects?: typeof TEST_OBJECTS;
}

async function newSim(options: Options = {}): Promise<Sim> {
  const bundle = createTestContent();
  bundle.feel.endOfLevel.doorSpillCount = 0;
  return createSim({
    content: bundle,
    geometry: createTestGeometry(),
    level: createTestLevel({
      durationMs: DURATION_MS,
      objects: options.objects ?? TEST_OBJECTS,
      gauges: options.noise === true ? NOISE_GAUGES : {},
      ...(options.finalRush === false ? {} : { finalRush: { spillAnchor: 'coffee_table' } }),
    }),
    seed: 3,
  });
}

const worldOf = (sim: Sim) => sim.world as World;
const propOf = (sim: Sim, id: string) => {
  const prop = sim.world.props.find((candidate) => candidate.id === id);
  if (prop === undefined) throw new Error(`no prop ${id}`);
  return prop;
};

function runTo(sim: Sim, untilMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilMs) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

function runUntil(sim: Sim, test: () => boolean, maxSteps = 1000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !test(); i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

const of = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

/** The mug leaves the table by its +z edge (away from the vase): it ends up on the floor, unbroken. */
function dropMug(sim: Sim): SimEvent[] {
  sim.enqueue({
    type: 'PushProp',
    t: asSimMs(sim.world.time.sim),
    propId: 'mug_01',
    impulseXNs: 0,
    impulseYNs: 0,
    impulseZNs: content.feel.gags.tableObjectFall.pushImpulseNs,
  });
  // Lets it land and stop bouncing, so that nothing moves in the next steps.
  return runUntil(sim, () => propOf(sim, 'mug_01').isMess && sim.world.time.sim >= 3000);
}

const tap = (sim: Sim, objectId: string) =>
  sim.enqueue({ type: 'TapObject', t: asSimMs(sim.world.time.sim), objectId });

describe('PropSlice.isMess (AC 9)', () => {
  it('is false at spawn and for a prop that started on the floor', async () => {
    const sim = await newSim();
    runTo(sim, 500);
    expect(sim.world.props.map((prop) => prop.isMess)).toEqual([false, false]);
    expect(sim.world.mess.propsOnFloor).toBe(0);
  });

  it('is true for a fallen, unbroken prop that spawned above the floor, and propsOnFloor counts it', async () => {
    const sim = await newSim();
    dropMug(sim);
    const mug = propOf(sim, 'mug_01');
    expect(mug.isOnFloor).toBe(true);
    expect(mug.isBroken).toBe(false);
    expect(mug.isMess).toBe(true);
    expect(sim.world.mess.propsOnFloor).toBe(1);
    expect(propOf(sim, 'vase_01').isMess).toBe(false);
  });

  it('is false for a broken prop, and propsOnFloor drops it', async () => {
    const sim = await newSim();
    dropMug(sim);
    worldOf(sim).props[0] = { ...propOf(sim, 'mug_01'), isBroken: true };
    sim.step();
    expect(propOf(sim, 'mug_01').isMess).toBe(false);
    expect(sim.world.mess.propsOnFloor).toBe(0);
    expect(sim.world.mess.propsBroken).toBe(1);
  });
});

describe('tidying (AC 10, 11)', () => {
  it('walks Papa to a prop that is a mess in the rush, says so, and tidies it on arrival', async () => {
    const sim = await newSim();
    dropMug(sim);
    runTo(sim, RUSH_AT);
    expect(sim.world.flow.state).toBe('finalRush');
    sim.drainEvents();
    const spawn = createTestGeometry().props[0]?.centerM as [number, number, number];
    tap(sim, 'mug_01');
    sim.step();
    expect(of(sim.drainEvents(), 'ObjectTapped')).toEqual([
      { type: 'ObjectTapped', t: sim.world.time.sim, objectId: 'mug_01' },
    ]);
    expect(sim.world.papa.objectId).toBe('mug_01');
    expect(sim.world.papa.state).toBe('walkPath');
    const events = runUntil(sim, () => sim.world.score.propsTidied > 0, 600);
    expect(of(events, 'PropTidied')).toEqual([
      { type: 'PropTidied', t: sim.world.time.sim, propId: 'mug_01' },
    ]);
    expect(sim.world.score.propsTidied).toBe(1);
    expect(sim.world.papa.state).toBe('idle');
    expect(sim.world.papa.objectId).toBeNull();
    const mug = propOf(sim, 'mug_01');
    // Back on its table, as at spawn (the engine has had a step to let it settle).
    expect(mug.xM).toBeCloseTo(spawn[0], 3);
    expect(mug.yM).toBeCloseTo(spawn[1], 3);
    expect(mug.zM).toBeCloseTo(spawn[2], 3);
    expect(mug.isMess).toBe(false);
    // Out of the mess in the very step it was tidied.
    expect(sim.world.mess.propsOnFloor).toBe(0);
  });

  it('does nothing outside the rush: no walk, no event', async () => {
    const sim = await newSim();
    dropMug(sim);
    expect(sim.world.flow.state).toBe('playing');
    sim.drainEvents();
    tap(sim, 'mug_01');
    sim.step();
    expect(sim.drainEvents().filter((event) => event.type !== 'TimeScaleChanged')).toEqual([]);
    expect(sim.world.papa.state).toBe('idle');
    expect(sim.world.papa.objectId).toBeNull();
  });

  it('does nothing in a level with no rush at all', async () => {
    const sim = await newSim({ finalRush: false });
    dropMug(sim);
    runTo(sim, RUSH_AT + 100);
    sim.drainEvents();
    tap(sim, 'mug_01');
    sim.step();
    expect(sim.drainEvents().filter((event) => event.type !== 'TimeScaleChanged')).toEqual([]);
    expect(sim.world.papa.state).toBe('idle');
  });

  it('does nothing for a prop that is not a mess (on its table, or on the floor from the start)', async () => {
    const sim = await newSim();
    runTo(sim, RUSH_AT);
    sim.drainEvents();
    for (const id of ['mug_01', 'vase_01']) {
      tap(sim, id);
      sim.step();
      expect(
        sim.drainEvents().filter((event) => event.type !== 'TimeScaleChanged'),
        id,
      ).toEqual([]);
      expect(sim.world.papa.state).toBe('idle');
    }
  });

  it('does nothing for an unknown id, and a real object works as before in the rush', async () => {
    const sim = await newSim();
    runTo(sim, RUSH_AT);
    sim.drainEvents();
    tap(sim, 'nowhere');
    sim.step();
    expect(sim.drainEvents().filter((event) => event.type !== 'TimeScaleChanged')).toEqual([]);
    tap(sim, 'phone');
    sim.step();
    expect(of(sim.drainEvents(), 'ObjectTapped')).toEqual([
      { type: 'ObjectTapped', t: sim.world.time.sim, objectId: 'phone' },
    ]);
    expect(sim.world.papa.objectId).toBe('phone');
  });

  it('leaves Papa simply idle at a prop that stopped being a mess on the way (broken)', async () => {
    const sim = await newSim();
    dropMug(sim);
    runTo(sim, RUSH_AT);
    sim.drainEvents();
    tap(sim, 'mug_01');
    sim.step();
    expect(sim.world.papa.objectId).toBe('mug_01');
    propOf(sim, 'mug_01').isBroken = true;
    const events = runUntil(sim, () => sim.world.papa.state === 'idle', 600);
    expect(of(events, 'PapaArrived')).toHaveLength(1);
    expect(of(events, 'PropTidied')).toEqual([]);
    expect(sim.world.score.propsTidied).toBe(0);
    expect(propOf(sim, 'mug_01').isBroken).toBe(true);
  });

  it('tidies a prop knocked over again, any number of times', async () => {
    const sim = await newSim();
    runTo(sim, RUSH_AT);
    for (let round = 1; round <= 2; round++) {
      dropMug(sim);
      tap(sim, 'mug_01');
      runUntil(sim, () => sim.world.score.propsTidied === round, 800);
      expect(sim.world.score.propsTidied).toBe(round);
      expect(propOf(sim, 'mug_01').isMess).toBe(false);
      expect(sim.world.papa.state).toBe('idle');
    }
  });
});

describe('re-settling (AC 11)', () => {
  it('emits no PropImpact and adds no noise when a tidied prop settles on its table again', async () => {
    const sim = await newSim({ noise: true });
    dropMug(sim);
    runTo(sim, RUSH_AT);
    tap(sim, 'mug_01');
    runUntil(sim, () => sim.world.score.propsTidied === 1, 800);
    const noisePct = sim.world.gauges.noisePct;
    sim.drainEvents();
    const events = runTo(sim, sim.world.time.sim + 3000);
    expect(of(events, 'PropImpact')).toEqual([]);
    expect(of(events, 'NoiseChanged').filter((event) => event.source === 'propImpact')).toEqual([]);
    expect(sim.world.gauges.noisePct).toBeLessThanOrEqual(noisePct);
    expect(propOf(sim, 'mug_01').isOnFloor).toBe(false);
  });
});

describe('the note (AC 12)', () => {
  it('lowers the sigh by feel.mama.sighPerPropOnFloorPoints for a prop tidied', async () => {
    const noteOf = async (isTidied: boolean) => {
      const sim = await newSim();
      dropMug(sim);
      runTo(sim, RUSH_AT);
      if (isTidied) {
        tap(sim, 'mug_01');
        runUntil(sim, () => sim.world.score.propsTidied === 1, 800);
      }
      runTo(sim, DURATION_MS);
      expect(sim.world.flow.state).toBe('photo');
      return sim.world.score.final;
    };
    const untidied = await noteOf(false);
    const tidied = await noteOf(true);
    expect(untidied?.sighPoints).toBe(SIGH_POINTS);
    expect(tidied?.sighPoints).toBe(0);
    expect((untidied?.sighPoints ?? 0) - (tidied?.sighPoints ?? 0)).toBe(SIGH_POINTS);
    expect((tidied?.scorePoints ?? 0) - (untidied?.scorePoints ?? 0)).toBe(SIGH_POINTS);
  });
});

describe('the id clash (AC 22)', () => {
  it('refuses a level where an object has the id of a prop', async () => {
    await expect(
      createSim({
        content,
        geometry: createTestGeometry(),
        level: createTestLevel({
          objects: [{ id: 'mug_01', kind: 'phone', anchor: 'phone' }],
        }),
        seed: 1,
      }),
    ).rejects.toThrow(/the prop "mug_01" has the id of an object/);
  });
});

describe('a snapshot in the middle of a rush walk (AC 23)', () => {
  const roundTrip = (sim: Sim) => JSON.parse(JSON.stringify(sim.snapshot()));

  it('round-trips with Papa walking to a prop, and tidies it after the restore', async () => {
    const sim = await newSim();
    dropMug(sim);
    runTo(sim, RUSH_AT);
    tap(sim, 'mug_01');
    runTo(sim, sim.world.time.sim + 3 * STEP_MS);
    expect(sim.world.papa.objectId).toBe('mug_01');
    const twin = await newSim();
    twin.restore(roundTrip(sim));
    expect(twin.world.papa.objectId).toBe('mug_01');
    runUntil(twin, () => twin.world.score.propsTidied === 1, 800);
    runUntil(sim, () => sim.world.score.propsTidied === 1, 800);
    expect(twin.world.score.propsTidied).toBe(1);
    expect(twin.world).toEqual(sim.world);
  });

  it('refuses a prop id for Papa outside the rush', async () => {
    const sim = await newSim();
    dropMug(sim);
    runTo(sim, RUSH_AT);
    tap(sim, 'mug_01');
    runTo(sim, sim.world.time.sim + 3 * STEP_MS);
    const snapshot = roundTrip(sim);
    snapshot.world.flow = { state: 'playing', enteredAt: 0, finalRushAt: null };
    expect(() => sim.restore(snapshot)).toThrow(/world\.papa\.objectId/);
  });

  it('refuses an isMess that disagrees with the prop, and a propsTidied that is not a count', async () => {
    const sim = await newSim();
    dropMug(sim);
    for (const change of [
      (snapshot: ReturnType<typeof roundTrip>) => {
        snapshot.world.props[0].isMess = false;
      },
      (snapshot: ReturnType<typeof roundTrip>) => {
        snapshot.world.props[1].isMess = true;
      },
      (snapshot: ReturnType<typeof roundTrip>) => {
        snapshot.world.props[0].isMess = 'yes';
      },
      (snapshot: ReturnType<typeof roundTrip>) => {
        snapshot.world.score.propsTidied = -1;
      },
      (snapshot: ReturnType<typeof roundTrip>) => {
        snapshot.world.score.propsTidied = 1.5;
      },
    ]) {
      const snapshot = roundTrip(sim);
      change(snapshot);
      expect(() => sim.restore(snapshot)).toThrow(/world\.(props|score)/);
    }
  });
});
