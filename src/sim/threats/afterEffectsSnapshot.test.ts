import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  SILENCE,
  STAIRS,
  TEST_OBJECTS,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { SimSnapshot } from '../snapshot.ts';

// The séquelles in the snapshot (story 3.15, snapshot version 30): a game stopped in the middle of each one
// restores to the hash of the game that was not stopped, and a damaged field of the new slices is refused.

const content = createTestContent();
const geometry = createTestGeometry();

async function newSim(): Promise<Sim> {
  return createSim({
    content,
    geometry,
    level: createTestLevel({
      waves: [testWave([OUTLET, STAIRS, COFFEE_TABLE, SILENCE], { fromMs: 500_000 })],
      objects: TEST_OBJECTS,
      gauges: FATIGUE_GAUGES,
      carry: CARRY,
    }),
    seed: 9,
  });
}

function run(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

function runUntil(sim: Sim, test: () => boolean, maxSteps = 3000): void {
  for (let i = 0; i < maxSteps && !test(); i++) {
    sim.step();
    sim.drainEvents();
  }
  if (!test()) throw new Error('never reached');
}

function force(sim: Sim, defId: string): void {
  const threat = sim.world.threats.find((candidate) => candidate.defId === defId);
  if (threat === undefined) throw new Error(`no ${defId}`);
  sim.enqueue({ type: 'ForceThreat', t: asSimMs(sim.world.time.sim), threatId: threat.id });
  runUntil(sim, () => threat.state === 'gag');
}

/** The sim brought to the middle of each séquelle, by the real flow. */
const SCENES: Record<string, (sim: Sim) => void> = {
  electrified: (sim) => force(sim, 'outlet'),
  downstairs: (sim) => force(sim, 'stairs'),
  carryingUp: (sim) => {
    force(sim, 'stairs');
    runUntil(sim, () => sim.world.papa.state === 'idle');
    sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });
    runUntil(sim, () => sim.world.papa.state === 'carryingUp');
  },
  pickingUp: (sim) => {
    force(sim, 'coffee_table_object');
    runUntil(sim, () => sim.world.props.some((prop) => prop.isMess));
    runUntil(sim, () => sim.world.papa.state === 'idle');
    sim.enqueue({ type: 'TapObject', t: asSimMs(sim.world.time.sim), objectId: 'mug_01' });
    runUntil(sim, () => sim.world.papa.state === 'pickingUp');
  },
  mess: (sim) => {
    const silence = sim.world.threats.find((candidate) => candidate.defId === 'silence_mischief');
    sim.enqueue({ type: 'ForceThreat', t: asSimMs(0), threatId: silence?.id ?? -1 });
    runUntil(sim, () => sim.world.afterEffects.mischiefMarks.length === 1);
  },
};

describe('a game stopped in the middle of a séquelle', () => {
  it.each(Object.keys(SCENES))(
    'restores to the hash of the game that went on: %s',
    async (name) => {
      const live = await newSim();
      (SCENES[name] as (sim: Sim) => void)(live);
      const snapshot = live.snapshot();
      const resumed = await newSim();
      resumed.restore(snapshot);
      expect(hashJson(resumed.world)).toBe(hashJson(live.world));
      // And both go on to the same events and the same end, through the end of the séquelle.
      const liveEvents = run(live, 700);
      const resumedEvents = run(resumed, 700);
      expect(resumedEvents).toEqual(liveEvents);
      expect(hashJson(resumed.world)).toBe(hashJson(live.world));
    },
  );

  it('is at version 32, and refuses a version 30 snapshot', async () => {
    const sim = await newSim();
    const snapshot = sim.snapshot();
    expect(snapshot.version).toBe(32);
    expect(() => sim.restore({ ...snapshot, version: 30 as 32 })).toThrow(/version 30/);
  });
});

describe('the snapshot refuses a damaged séquelle (story 3.15)', () => {
  /** The parts of a snapshot's world a test damages: loosely typed, since it writes what the validators refuse. */
  interface Damageable {
    afterEffects: {
      dimUntil: unknown;
      steppedDebrisIndex: unknown;
      mischiefMarks: Record<string, unknown>[];
    };
    props: Record<string, unknown>[];
    papa: Record<string, unknown>;
    baby: Record<string, unknown>;
  }
  type Damage = (world: Damageable) => void;
  const refusals: [string, string, Damage, RegExp][] = [
    [
      'electrified',
      'a negative dimUntil',
      (w) => (w.afterEffects.dimUntil = -1),
      /afterEffects\.dimUntil/,
    ],
    [
      'electrified',
      'a missing afterEffects slice',
      (w) => Reflect.deleteProperty(w, 'afterEffects'),
      /afterEffects is missing/,
    ],
    [
      'electrified',
      'a stepped index past the props',
      (w) => (w.afterEffects.steppedDebrisIndex = 99),
      /steppedDebrisIndex/,
    ],
    [
      'electrified',
      'a stepped index below -1',
      (w) => (w.afterEffects.steppedDebrisIndex = -2),
      /steppedDebrisIndex/,
    ],
    [
      'mess',
      'a mark with an unknown gag',
      (w) => (w.afterEffects.mischiefMarks[0].gag = 'burp'),
      /mischiefMarks\[0\]\.gag/,
    ],
    [
      'mess',
      'a mark with no position',
      (w) => (w.afterEffects.mischiefMarks[0].xM = 'x'),
      /mischiefMarks\[0\]\.xM/,
    ],
    [
      'mess',
      'marks that are not a list',
      (w) => Reflect.set(w.afterEffects, 'mischiefMarks', {}),
      /mischiefMarks/,
    ],
    [
      'pickingUp',
      'a fractional pick-up time on a prop',
      (w) => (w.props[0].debrisPickUpMs = 1.5),
      /debrisPickUpMs/,
    ],
    [
      'pickingUp',
      'a pick-up that names no prop',
      (w) => (w.papa.objectId = null),
      /papa\.objectId/,
    ],
    [
      'downstairs',
      'a baby downstairs with no end',
      (w) => (w.baby.downstairsUntil = null),
      /downstairsUntil/,
    ],
    [
      'downstairs',
      'a downstairs end on a baby who is not downstairs',
      (w) => (w.baby.state = 'babble'),
      /downstairsUntil/,
    ],
    [
      'carryingUp',
      'a carry up with no baby carried up',
      (w) => (w.baby.state = 'babble'),
      /world\.baby\.state/,
    ],
    [
      'carryingUp',
      'a baby carried up with no Papa carrying',
      (w) => (w.papa.state = 'idle'),
      /world\.papa\.busyUntil|world\.baby\.state/,
    ],
    ['electrified', 'a busy Papa with no end', (w) => (w.papa.busyUntil = 0), /busyUntil/],
  ];

  it.each(refusals)('%s: %s', async (scene, _what, damage, message) => {
    const sim = await newSim();
    (SCENES[scene] as (sim: Sim) => void)(sim);
    const snapshot = JSON.parse(JSON.stringify(sim.snapshot())) as SimSnapshot;
    damage(snapshot.world as unknown as Damageable);
    expect(() => sim.restore(snapshot)).toThrow(message);
  });

  it('refuses a prop id as Papa’s walk outside the rush when the prop is no debris', async () => {
    const sim = await newSim();
    SCENES.pickingUp?.(sim);
    runUntil(sim, () => sim.world.papa.state === 'idle');
    // Papa walks to the vase, which is no debris: the snapshot would not know why.
    sim.enqueue({ type: 'TapFloor', t: asSimMs(sim.world.time.sim), xM: 0, zM: 1 });
    run(sim, 2);
    const snapshot = JSON.parse(JSON.stringify(sim.snapshot())) as SimSnapshot & {
      world: Damageable;
    };
    expect(snapshot.world.papa.state).toBe('walkPath');
    snapshot.world.papa.objectId = 'vase_01';
    expect(() => sim.restore(snapshot)).toThrow(/papa\.objectId/);
  });
});
