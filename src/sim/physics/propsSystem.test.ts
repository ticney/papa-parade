import type { Feel } from '@content/schemas/feel';
import { PROP_ON_FLOOR_TOLERANCE_M, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  stepN,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import type { SimPropSpec, StepContext } from '../context.ts';
import { createSim, createSimWithSystems } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { SYSTEMS } from '../step.ts';
import { createWorld, type World } from '../world.ts';
import type { PhysicsPort, PropPose } from './physicsPort.ts';
import { pushProp, runPhysics } from './propsSystem.ts';

const feel = createTestContent().feel;
const { physics } = feel;

/** A hit above the impact threshold and under every kind's break impulse (the tuning keeps room for one). */
const SOFT_HIT_NS =
  (physics.impactMinImpulseNs +
    Math.min(...Object.values(physics.kinds).map((kind) => kind.breakImpulseNs))) /
  2;

// ---- Logic against a scripted physics port: no engine, exact numbers ---------------------------

interface Hit {
  propIndex: number;
  otherIndex: number;
  impulseNs: number;
}

/** A port that does what the test says: poses to read, hits to report, bodies asleep or not. */
function createFakePort(poses: PropPose[]) {
  const sleeping = poses.map(() => false);
  let hits: Hit[] = [];
  const calls: string[] = [];
  const port: PhysicsPort = {
    fixedColliderCount: 0,
    propCount: poses.length,
    step: () => calls.push('step'),
    applyImpulse: (index, x, y, z) => calls.push(`impulse:${index}:${x}:${y}:${z}`),
    isSleeping: (index) => sleeping[index] as boolean,
    readPose(index, out) {
      calls.push(`read:${index}`);
      Object.assign(out, poses[index]);
    },
    forEachImpact(visit) {
      for (const hit of hits) visit(hit.propIndex, hit.otherIndex, hit.impulseNs);
    },
    snapshot: () => new Uint8Array(),
    restore: () => {},
    dispose: () => {},
  };
  return {
    port,
    poses,
    calls,
    sleeping,
    hitNext(...next: Hit[]) {
      hits = next;
    },
  };
}

const pose = (yM: number, xM = 0): PropPose => ({ xM, yM, zM: 0, qx: 0, qy: 0, qz: 0, qw: 1 });

function specOf(id: string, kind: string, centerYM: number, halfYM = 0.05): SimPropSpec {
  return {
    id,
    kind,
    halfExtentsM: [0.05, halfYM, 0.05],
    spawnedAboveFloor: centerYM - halfYM > PROP_ON_FLOOR_TOLERANCE_M,
    physics: physics.kinds[kind] as SimPropSpec['physics'],
  };
}

/** A world with `mug_01` on the table (0.5 m) and `vase_01` on the floor, over a scripted port. */
function scripted(overrides: Partial<Feel['physics']> = {}) {
  const specs = [specOf('mug_01', 'mug', 0.5), specOf('vase_01', 'vase', 0.15, 0.15)];
  const fake = createFakePort([pose(0.5, 0.7), pose(0.15, 1.3)]);
  const world = createWorld({
    seed: 1,
    feel: feel,
    papaSpawn: { xM: 0, zM: 0 },
    babySpawn: { xM: 0, zM: 0 },
    firstWanderAt: asSimMs(0),
    props: [
      { id: 'mug_01', kind: 'mug', centerM: [0.7, 0.5, 0] },
      { id: 'vase_01', kind: 'vase', centerM: [1.3, 0.15, 0] },
    ],
  });
  const events: SimEvent[] = [];
  const commands: SimCommand[] = [];
  const ctx = {
    strictInvariants: true,
    feel: { ...feel, physics: { ...physics, ...overrides } },
    events,
    commands,
    level: { threats: [], props: specs },
    physics: fake.port,
    get t() {
      return world.time.sim;
    },
  } as unknown as StepContext;
  return { world, ctx, events, commands, ...fake };
}

function runAt(setup: ReturnType<typeof scripted>, t: number): void {
  setup.world.time.sim = asSimMs(t);
  setup.events.length = 0;
  runPhysics(setup.world, setup.ctx);
}

describe('runPhysics (scripted port)', () => {
  it('does nothing in a level without props', () => {
    const calls: string[] = [];
    const world = createWorld({
      seed: 1,
      feel: feel,
      papaSpawn: { xM: 0, zM: 0 },
      babySpawn: { xM: 0, zM: 0 },
      firstWanderAt: asSimMs(0),
    });
    const ctx = {
      physics: { step: () => calls.push('step') },
      commands: [],
      level: { props: [] },
    } as unknown as StepContext;
    runPhysics(world, ctx);
    expect(calls).toEqual([]);
    expect(world.mess).toEqual({ propsOnFloor: 0, propsBroken: 0, mischiefs: 0 });
  });

  it('steps the engine once, after the pushes and before the impacts are read', () => {
    const s = scripted();
    s.commands.push({
      type: 'PushProp',
      t: asSimMs(0),
      propId: 'mug_01',
      impulseXNs: 0.4,
      impulseYNs: 0,
      impulseZNs: -0.1,
    });
    runAt(s, 10);
    expect(s.calls).toEqual(['impulse:0:0.4:0:-0.1', 'step', 'read:0', 'read:1']);
  });

  it('keeps the previous pose in prev*, and the new one in the slice', () => {
    const s = scripted();
    runAt(s, 10);
    s.poses[0] = { xM: 0.8, yM: 0.45, zM: 0.1, qx: 0.1, qy: 0, qz: 0, qw: Math.sqrt(0.99) };
    runAt(s, 20);
    const mug = s.world.props[0];
    expect(mug).toMatchObject({ prevXM: 0.7, prevYM: 0.5, prevZM: 0, prevQx: 0, prevQw: 1 });
    expect(mug).toMatchObject({ xM: 0.8, yM: 0.45, zM: 0.1, qx: 0.1 });
    runAt(s, 30);
    expect(s.world.props[0]).toMatchObject({ prevXM: 0.8, prevYM: 0.45, prevQx: 0.1 });
  });

  it('does not read a sleeping body, and its prev pose is its pose', () => {
    const s = scripted();
    s.sleeping[1] = true;
    runAt(s, 10);
    expect(s.calls).toContain('read:0');
    expect(s.calls).not.toContain('read:1');
    expect(s.world.props[1]).toMatchObject({ xM: 1.3, prevXM: 1.3, yM: 0.15, prevYM: 0.15 });
  });

  it('ignores a PushProp with an unknown id, and one on a broken prop', () => {
    const s = scripted();
    const push = (propId: string): SimCommand => ({
      type: 'PushProp',
      t: asSimMs(0),
      propId,
      impulseXNs: 1,
      impulseYNs: 0,
      impulseZNs: 0,
    });
    s.commands.push(push('teapot_09'));
    runAt(s, 10);
    expect(s.calls.filter((call) => call.startsWith('impulse'))).toEqual([]);
    expect(s.events).toEqual([]);

    s.hitNext({ propIndex: 1, otherIndex: 0, impulseNs: physics.kinds.vase?.breakImpulseNs ?? 0 });
    runAt(s, 20);
    expect(s.world.props[1]?.isBroken).toBe(true);
    s.hitNext();
    s.commands.length = 0;
    s.commands.push(push('vase_01'));
    runAt(s, 30);
    expect(s.calls.filter((call) => call.startsWith('impulse'))).toEqual([]);
  });

  it('pushProp helper pushes an unbroken prop and refuses an index that does not exist', () => {
    const s = scripted();
    pushProp(s.world, s.ctx, 0, 1, 2, 2);
    pushProp(s.world, s.ctx, 5, 1, 2, 2);
    pushProp(s.world, s.ctx, -1, 1, 2, 2);
    expect(s.calls).toEqual(['impulse:0:1:2:2']);
  });

  describe('pushProp bounds', () => {
    const maxNs = physics.maxPushImpulseNs;

    it('pushes with exactly the largest allowed impulse', () => {
      const s = scripted();
      pushProp(s.world, s.ctx, 0, maxNs, 0, 0);
      expect(s.calls).toEqual([`impulse:0:${maxNs}:0:0`]);
      expect(s.events).toEqual([]);
    });

    it('throws in strict mode on a push over the bound, a NaN or an infinite one, and pushes nothing', () => {
      const s = scripted();
      expect(() => pushProp(s.world, s.ctx, 0, maxNs * 2, 0, 0)).toThrow('prop.pushImpulseNs');
      expect(() => pushProp(s.world, s.ctx, 0, Number.NaN, 0, 1)).toThrow('prop.pushImpulseNs');
      expect(() => pushProp(s.world, s.ctx, 0, Number.POSITIVE_INFINITY, 0, 0)).toThrow(
        'prop.pushImpulseNs',
      );
      expect(() => pushProp(s.world, s.ctx, 0, 1e300, 1e300, 1e300)).toThrow('prop.pushImpulseNs');
      expect(s.calls).toEqual([]);
    });

    it('outside strict mode clamps a long push to the bound, keeping its direction, and reports it', () => {
      const s = scripted();
      Object.assign(s.ctx, { strictInvariants: false });
      pushProp(s.world, s.ctx, 0, 0, 5 * maxNs, 0);
      pushProp(s.world, s.ctx, 0, 3 * maxNs, 0, 4 * maxNs);
      expect(s.calls[0]).toBe(`impulse:0:0:${maxNs}:0`);
      const [x, y, z] = (s.calls[1] as string).split(':').slice(2).map(Number) as [
        number,
        number,
        number,
      ];
      expect(x).toBeCloseTo(0.6 * maxNs, 9);
      expect(y).toBe(0);
      expect(z).toBeCloseTo(0.8 * maxNs, 9);
      expect(s.events.map((event) => event.type)).toEqual([
        'InvariantViolated',
        'InvariantViolated',
      ]);
    });

    it('outside strict mode drops a push that is not a finite vector, and reports it', () => {
      const s = scripted();
      Object.assign(s.ctx, { strictInvariants: false });
      pushProp(s.world, s.ctx, 0, Number.NaN, 0, 0);
      pushProp(s.world, s.ctx, 0, Number.POSITIVE_INFINITY, 0, 0);
      pushProp(s.world, s.ctx, 0, 0, 0, 0);
      expect(s.calls).toEqual([]);
      expect(s.events.map((event) => event.type)).toEqual([
        'InvariantViolated',
        'InvariantViolated',
      ]);
    });
  });

  it('emits no event for a hit under the threshold, and one at the threshold', () => {
    const s = scripted();
    s.hitNext({ propIndex: 0, otherIndex: -1, impulseNs: physics.impactMinImpulseNs * 0.99 });
    runAt(s, 10);
    expect(s.events).toEqual([]);
    expect(s.world.props[0]?.lastImpactAt).toBeNull();

    s.hitNext({ propIndex: 0, otherIndex: -1, impulseNs: physics.impactMinImpulseNs });
    runAt(s, 20);
    expect(s.events).toEqual([
      {
        type: 'PropImpact',
        t: 20,
        propId: 'mug_01',
        impulseNs: physics.impactMinImpulseNs,
        otherPropId: null,
      },
    ]);
    expect(s.world.props[0]?.lastImpactAt).toBe(20);
  });

  it('names the other prop, and emits in prop index order', () => {
    const s = scripted();
    const impulseNs = SOFT_HIT_NS;
    // Reported in the "wrong" order on purpose: the events come out by prop index.
    s.hitNext(
      { propIndex: 1, otherIndex: 0, impulseNs },
      { propIndex: 0, otherIndex: 1, impulseNs },
    );
    runAt(s, 10);
    expect(s.events.map((event) => event.type === 'PropImpact' && event.propId)).toEqual([
      'vase_01',
      'mug_01',
    ]);
    expect(s.events).toContainEqual(
      expect.objectContaining({ propId: 'mug_01', otherPropId: 'vase_01' }),
    );
    expect(s.events).toContainEqual(
      expect.objectContaining({ propId: 'vase_01', otherPropId: 'mug_01' }),
    );
  });

  it('throttles PropImpact per prop by the cooldown: inside it nothing, at it an event again', () => {
    const s = scripted();
    const cooldownMs = physics.impactCooldownMs;
    // Above the threshold, under every kind's break impulse.
    const hit: Hit = { propIndex: 0, otherIndex: -1, impulseNs: SOFT_HIT_NS };
    s.hitNext(hit);
    runAt(s, 100);
    expect(s.events).toHaveLength(1);
    runAt(s, 100 + cooldownMs - STEP_MS);
    expect(s.events).toEqual([]);
    runAt(s, 100 + cooldownMs);
    expect(s.events).toHaveLength(1);
    // Another prop is not throttled by this one.
    s.hitNext({ ...hit, propIndex: 1 });
    runAt(s, 100 + cooldownMs + STEP_MS);
    expect(s.events).toHaveLength(1);
  });

  it('breaks a breakable prop once, at its break impulse, after its PropImpact', () => {
    const s = scripted();
    const vase = physics.kinds.vase as Feel['physics']['kinds'][string];
    s.hitNext({ propIndex: 1, otherIndex: -1, impulseNs: vase.breakImpulseNs * 0.99 });
    runAt(s, 10);
    expect(s.events.map((event) => event.type)).toEqual(['PropImpact']);
    expect(s.world.props[1]?.isBroken).toBe(false);

    s.hitNext({ propIndex: 1, otherIndex: 0, impulseNs: vase.breakImpulseNs });
    runAt(s, 10 + physics.impactCooldownMs);
    expect(s.events.map((event) => event.type)).toEqual(['PropImpact', 'PropBroken']);
    expect(s.events[1]).toEqual({
      type: 'PropBroken',
      t: 10 + physics.impactCooldownMs,
      propId: 'vase_01',
      impulseNs: vase.breakImpulseNs,
    });
    expect(s.world.props[1]?.isBroken).toBe(true);

    s.hitNext({ propIndex: 1, otherIndex: -1, impulseNs: vase.breakImpulseNs * 3 });
    runAt(s, 10 + 2 * physics.impactCooldownMs);
    expect(s.events.map((event) => event.type)).toEqual(['PropImpact']);
  });

  it('checks the breakage even inside the impact cooldown', () => {
    const s = scripted();
    const vase = physics.kinds.vase as Feel['physics']['kinds'][string];
    s.hitNext({ propIndex: 1, otherIndex: -1, impulseNs: physics.impactMinImpulseNs * 1.1 });
    runAt(s, 10);
    expect(s.events).toHaveLength(1);
    s.hitNext({ propIndex: 1, otherIndex: -1, impulseNs: vase.breakImpulseNs * 2 });
    runAt(s, 20); // inside the cooldown
    expect(s.events.map((event) => event.type)).toEqual(['PropBroken']);
  });

  it('never breaks a prop whose kind is not breakable', () => {
    const mug = physics.kinds.mug as Feel['physics']['kinds'][string];
    const s = scripted({
      kinds: { ...physics.kinds, mug: { ...mug, breakable: false } },
    });
    s.ctx = Object.assign(s.ctx, {
      level: {
        threats: [],
        props: [specOf('mug_01', 'mug', 0.5), specOf('vase_01', 'vase', 0.15, 0.15)].map(
          (spec, index) =>
            index === 0 ? { ...spec, physics: { ...mug, breakable: false } } : spec,
        ),
      },
    });
    s.hitNext({ propIndex: 0, otherIndex: -1, impulseNs: mug.breakImpulseNs * 10 });
    runAt(s, 10);
    expect(s.events.map((event) => event.type)).toEqual(['PropImpact']);
    expect(s.world.props[0]?.isBroken).toBe(false);
  });

  describe('mess', () => {
    it('does not count a prop that spawned on the floor', () => {
      const s = scripted();
      runAt(s, 10);
      expect(s.world.props[1]?.isOnFloor).toBe(true);
      expect(s.world.mess).toEqual({ propsOnFloor: 0, propsBroken: 0, mischiefs: 0 });
    });

    it('counts a prop that fell to the floor, and not one still on the table', () => {
      const s = scripted();
      runAt(s, 10);
      expect(s.world.props[0]?.isOnFloor).toBe(false);
      s.poses[0] = pose(0.05, 1.5);
      runAt(s, 20);
      expect(s.world.props[0]?.isOnFloor).toBe(true);
      expect(s.world.mess).toEqual({ propsOnFloor: 1, propsBroken: 0, mischiefs: 0 });
    });

    it('moves a broken prop from the floor count to the broken count', () => {
      const s = scripted();
      s.poses[0] = pose(0.05, 1.5);
      runAt(s, 10);
      expect(s.world.mess.propsOnFloor).toBe(1);
      s.hitNext({
        propIndex: 0,
        otherIndex: -1,
        impulseNs: (physics.kinds.mug?.breakImpulseNs ?? 0) + 1,
      });
      runAt(s, 20);
      expect(s.world.mess).toEqual({ propsOnFloor: 0, propsBroken: 1, mischiefs: 0 });
    });

    it('takes a tipped prop to lie on its largest half extent', () => {
      const s = scripted();
      // A flat prop (half extents 0.10, 0.03, 0.05), so that standing and lying differ: upright its
      // lowest point is its centre minus 0.03, tipped it is its centre minus the largest half extent, 0.10.
      Object.assign(s.ctx.level.props[0] as SimPropSpec, { halfExtentsM: [0.1, 0.03, 0.05] });
      const quarter = Math.SQRT1_2; // a 90° turn about x: its up axis points sideways
      const upright = { qx: 0, qy: 0, qz: 0, qw: 1 };
      const tipped = { qx: quarter, qy: 0, qz: 0, qw: quarter };
      s.poses[0] = { xM: 0.7, yM: 0.1, zM: 0, ...upright };
      runAt(s, 10);
      // Upright at 0.1 it would hover: lowest point 0.1 - 0.03 = 0.07, above the tolerance.
      expect(s.world.props[0]?.isOnFloor).toBe(false);
      s.poses[0] = { xM: 0.7, yM: 0.1, zM: 0, ...tipped };
      runAt(s, 20);
      // Tipped at the same height its lowest point is 0.1 - 0.10 = 0: on the floor.
      expect(s.world.props[0]?.isOnFloor).toBe(true);
      s.poses[0] = { xM: 0.7, yM: 0.15, zM: 0, ...tipped };
      runAt(s, 30);
      // Tipped but 5 cm up: 0.15 - 0.10 = 0.05, above the tolerance.
      expect(s.world.props[0]?.isOnFloor).toBe(false);
    });
  });
});

// ---- Behaviour with the real engine --------------------------------------------------------------

/** The salon with its own props replaced by `props`, as a sim; tests stand props where they like. */
async function salonWith(
  props: { id: string; kind: string; centerM: [number, number, number]; halfM?: number }[],
  tune: (feel: Feel) => void = () => {},
) {
  const content = createTestContent();
  tune(content.feel);
  const geometry = createTestGeometry();
  geometry.props = props.map(({ id, kind, centerM, halfM = 0.05 }) => ({
    id,
    kind,
    centerM,
    halfExtentsM: [halfM, halfM, halfM],
  }));
  const sim = await createSim({ content, geometry, level: createTestLevel(), seed: 1 });
  const events: SimEvent[] = [];
  const run = (steps: number): SimEvent[] => {
    const out: SimEvent[] = [];
    for (let i = 0; i < steps; i++) {
      sim.step();
      // The baby wanders in these rooms too: only the props' events are the subject here.
      for (const event of sim.drainEvents()) if (event.type.startsWith('Prop')) out.push(event);
    }
    events.push(...out);
    return out;
  };
  return { sim, run, events };
}

const FREE_SPOT: [number, number, number] = [2.5, 0, 1];
const at = (heightM: number, spot = FREE_SPOT): [number, number, number] => [
  spot[0],
  heightM,
  spot[2],
];

describe('runPhysics (real engine)', () => {
  it('a mug dropped from 1 m emits exactly one PropImpact on the floor, no break', async () => {
    const { run, sim } = await salonWith([{ id: 'mug_01', kind: 'mug', centerM: at(1.05) }]);
    const events = run(500);
    const impacts = events.filter((event) => event.type === 'PropImpact');
    expect(impacts).toHaveLength(1);
    expect(impacts[0]).toMatchObject({ propId: 'mug_01', otherPropId: null });
    expect((impacts[0] as { impulseNs: number }).impulseNs).toBeGreaterThanOrEqual(
      physics.impactMinImpulseNs,
    );
    expect(events.filter((event) => event.type === 'PropBroken')).toEqual([]);
    expect(sim.world.props[0]?.yM).toBeCloseTo(0.05, 1);
    sim.dispose();
  });

  it('counts a mug that fell to the floor as mess, and one that started there as none', async () => {
    const { run, sim } = await salonWith([
      { id: 'mug_01', kind: 'mug', centerM: at(0.6) },
      { id: 'mug_02', kind: 'mug', centerM: at(0.05, [3, 0, 2]) },
    ]);
    expect(sim.world.mess).toEqual({ propsOnFloor: 0, propsBroken: 0, mischiefs: 0 });
    run(300);
    expect(sim.world.props.map((prop) => prop.isOnFloor)).toEqual([true, true]);
    expect(sim.world.mess).toEqual({ propsOnFloor: 1, propsBroken: 0, mischiefs: 0 });
    sim.dispose();
  });

  it('emits nothing for 5 s in a room where every prop rests', async () => {
    const { run, sim } = await salonWith([
      { id: 'mug_01', kind: 'mug', centerM: at(0.05) },
      { id: 'vase_01', kind: 'vase', centerM: at(0.15, [1.3, 0, -0.6]), halfM: 0.15 },
    ]);
    expect(run(500)).toEqual([]);
    expect(sim.world.mess).toEqual({ propsOnFloor: 0, propsBroken: 0, mischiefs: 0 });
    sim.dispose();
  });

  it('a prop resting on the coffee table stays there and emits nothing', async () => {
    const { run, sim } = await salonWith([
      { id: 'mug_01', kind: 'mug', centerM: [0.7, 0.5, -0.6] },
    ]);
    expect(run(500)).toEqual([]);
    expect(sim.world.props[0]?.yM).toBeCloseTo(0.5, 2);
    sim.dispose();
  });

  describe('the cooldown', () => {
    // A rubber mug bounces many times; the impact threshold is low enough for every bounce to count.
    const bouncy = (cooldownMs: number) => (f: Feel) => {
      f.physics.impactCooldownMs = cooldownMs;
      f.physics.impactMinImpulseNs = 0.05;
      (f.physics.kinds.mug as Feel['physics']['kinds'][string]).restitution = 1;
    };

    async function impactTimes(cooldownMs: number): Promise<number[]> {
      const { run, sim } = await salonWith(
        [{ id: 'mug_01', kind: 'mug', centerM: at(1.05) }],
        bouncy(cooldownMs),
      );
      const events = run(400);
      sim.dispose();
      return events.filter((event) => event.type === 'PropImpact').map((event) => event.t);
    }

    it('lets a second impact through when it is over, not before', async () => {
      const quick = await impactTimes(physics.impactCooldownMs);
      const slow = await impactTimes(1000);
      expect(quick.length).toBeGreaterThanOrEqual(2);
      for (let i = 1; i < quick.length; i++) {
        expect((quick[i] as number) - (quick[i - 1] as number)).toBeGreaterThanOrEqual(
          physics.impactCooldownMs,
        );
      }
      // The first bounce comes back well inside a second: with a 1 s cooldown it is swallowed.
      expect(slow.length).toBeLessThan(quick.length);
      for (let i = 1; i < slow.length; i++) {
        expect((slow[i] as number) - (slow[i - 1] as number)).toBeGreaterThanOrEqual(1000);
      }
    });
  });

  describe('prop on prop', () => {
    async function mugOnVase() {
      return salonWith([
        { id: 'vase_01', kind: 'vase', centerM: at(0.15), halfM: 0.15 },
        { id: 'mug_01', kind: 'mug', centerM: at(0.9) },
      ]);
    }

    it('gives each prop a PropImpact that names the other', async () => {
      const { run, sim } = await mugOnVase();
      const events = run(300);
      const impacts = events.filter((event) => event.type === 'PropImpact');
      expect(impacts).toContainEqual(
        expect.objectContaining({ propId: 'mug_01', otherPropId: 'vase_01' }),
      );
      expect(impacts).toContainEqual(
        expect.objectContaining({ propId: 'vase_01', otherPropId: 'mug_01' }),
      );
      sim.dispose();
    });

    it('breaks the vase once, not the mug, and counts it in the mess', async () => {
      const { run, sim } = await mugOnVase();
      const events = run(600);
      const broken = events.filter((event) => event.type === 'PropBroken');
      expect(broken).toEqual([expect.objectContaining({ propId: 'vase_01' })]);
      expect(sim.world.props.map((prop) => prop.isBroken)).toEqual([true, false]);
      // The vase spawned on the floor and is broken: it counts as broken, not as floor mess. (The
      // mug may rest on top of its remains, so how many lie on the floor is not pinned here.)
      expect(sim.world.mess.propsBroken).toBe(1);
      expect(sim.world.mess.propsOnFloor).toBe(sim.world.props[1]?.isOnFloor ? 1 : 0);
      sim.dispose();
    });

    it('a PushProp on the broken vase changes nothing', async () => {
      const { run, sim } = await mugOnVase();
      run(600);
      const before = JSON.stringify(sim.world.props);
      sim.enqueue({
        type: 'PushProp',
        t: asSimMs(sim.world.time.sim),
        propId: 'vase_01',
        impulseXNs: 2,
        impulseYNs: 0,
        impulseZNs: 0,
      });
      expect(run(50)).toEqual([]);
      expect(JSON.stringify(sim.world.props)).toBe(before);
      sim.dispose();
    });
  });

  it('never breaks a kind that is not breakable, however hard it falls', async () => {
    const hard = (breakable: boolean) => (f: Feel) => {
      const mug = f.physics.kinds.mug as Feel['physics']['kinds'][string];
      mug.breakable = breakable;
      mug.breakImpulseNs = 0.4;
    };
    const fall = async (breakable: boolean) => {
      const { run, sim } = await salonWith(
        [{ id: 'mug_01', kind: 'mug', centerM: at(2.3) }],
        hard(breakable),
      );
      const events = run(300);
      sim.dispose();
      return events.filter((event) => event.type === 'PropBroken');
    };
    expect(await fall(true)).toHaveLength(1);
    expect(await fall(false)).toEqual([]);
  });

  it('PushProp moves a resting prop, wakes it, and an unknown id changes nothing', async () => {
    const { run, sim } = await salonWith([{ id: 'mug_01', kind: 'mug', centerM: at(0.05) }]);
    run(300); // asleep
    const rest = JSON.stringify(sim.world.props);
    sim.enqueue({
      type: 'PushProp',
      t: asSimMs(sim.world.time.sim),
      propId: 'teapot_09',
      impulseXNs: 1,
      impulseYNs: 0,
      impulseZNs: 0,
    });
    run(20);
    expect(JSON.stringify(sim.world.props)).toBe(rest);

    sim.enqueue({
      type: 'PushProp',
      t: asSimMs(sim.world.time.sim),
      propId: 'mug_01',
      impulseXNs: 0.3,
      impulseYNs: 0,
      impulseZNs: 0,
    });
    run(20);
    expect(sim.world.props[0]?.xM).toBeGreaterThan(FREE_SPOT[0]);
    sim.dispose();
  });

  it('keeps World plain JSON with props moving, and prev* one step behind', async () => {
    const { sim } = await salonWith([{ id: 'mug_01', kind: 'mug', centerM: at(1.05) }]);
    stepN(sim, 5);
    const before = structuredClone(sim.world.props[0]);
    sim.step();
    const mug = sim.world.props[0];
    expect(mug).toMatchObject({
      prevXM: before?.xM,
      prevYM: before?.yM,
      prevZM: before?.zM,
      prevQw: before?.qw,
    });
    expect(mug?.yM).toBeLessThan(before?.yM as number);
    expect(JSON.parse(JSON.stringify(sim.world))).toEqual(sim.world);
    sim.dispose();
  });
});

describe('the system order', () => {
  it('puts runPhysics after runPapa and before nothing yet (the gauges come later)', () => {
    const names = SYSTEMS.map((system) => system.name);
    expect(names.indexOf('runPhysics')).toBe(names.indexOf('runPapa') + 1);
  });

  it('skips the physics when the systems do not include it', async () => {
    const geometry = createTestGeometry();
    const sim = await createSimWithSystems(
      { content: createTestContent(), geometry, level: createTestLevel(), seed: 1 },
      SYSTEMS.filter((system) => system.name !== 'runPhysics'),
    );
    stepN(sim, 10);
    expect((sim.world as World).props[0]?.yM).toBe(geometry.props[0]?.centerM[1]);
    sim.dispose();
  });
});
