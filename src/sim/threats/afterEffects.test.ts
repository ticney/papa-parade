import type { Feel } from '@content/schemas/feel';
import type { ThreatDef } from '@content/schemas/threat';
import { AFTER_EFFECT_BUSY_MAX_MS, MICRO_SLEEP_BUSY_MAX_MS, STEP_MS } from '@shared/constants';
import { createRng, nextFloat, nextInt } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  COFFEE_TABLE,
  createTestCoffeeTableObject,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestOutlet,
  createTestStairs,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  SILENCE,
  STAIRS,
  TEST_OBJECTS,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';
import { occupyPapa } from './afterEffects.ts';

const content = createTestContent();
const geometry = createTestGeometry();

/** The salon's séquelles, as the frozen defs say them (the test fails with the JSON, not with a number here). */
function effectOf<K extends ThreatDef['afterEffect']['kind']>(def: ThreatDef, kind: K) {
  const effect = def.afterEffect;
  if (effect.kind !== kind) throw new Error(`${def.id} is not ${kind}`);
  return effect as Extract<ThreatDef['afterEffect'], { kind: K }>;
}
const ELECTRIFIED = effectOf(createTestOutlet(), 'electrified');
const DOWNSTAIRS = effectOf(createTestStairs(), 'babyDownstairs');
const DEBRIS = effectOf(createTestCoffeeTableObject(), 'debris');

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);
const types = (events: readonly SimEvent[]) => events.map((event) => event.type);
const kindsOf = (events: readonly SimEvent[], type: 'AfterEffectStarted' | 'AfterEffectEnded') =>
  only(events, type).map((event) => event.kind);

/** No wave ever draws on its own (it starts 8 minutes in): the tests force the threats they want. */
const FAR_MS = 500_000;

interface Options {
  noise?: boolean;
  feel?: Feel;
  durationMs?: number;
}

async function newSim(options: Options = {}): Promise<Sim> {
  return createSim({
    content: { ...content, feel: options.feel ?? content.feel },
    geometry,
    level: createTestLevel({
      waves: [testWave([OUTLET, STAIRS, COFFEE_TABLE, SILENCE], { fromMs: FAR_MS })],
      objects: TEST_OBJECTS,
      gauges: { ...FATIGUE_GAUGES, ...(options.noise === true ? NOISE_GAUGES : {}) },
      carry: CARRY,
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    }),
    seed: 5,
  });
}

const worldOf = (sim: Sim) => sim.world as World;

function run(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

function runUntil(sim: Sim, test: () => boolean, maxSteps = 2000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !test(); i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

const threatOf = (sim: Sim, defId: string) => {
  const threat = sim.world.threats.find((candidate) => candidate.defId === defId);
  if (threat === undefined) throw new Error(`no ${defId}`);
  return threat;
};

/** Forces `defId` and lets nobody answer it: returns the events up to the step it gags. */
function gag(sim: Sim, defId: string): SimEvent[] {
  const threat = threatOf(sim, defId);
  sim.enqueue({ type: 'ForceThreat', t: asSimMs(sim.world.time.sim), threatId: threat.id });
  const events = runUntil(sim, () => threat.state === 'gag');
  if (threat.state !== 'gag') throw new Error(`${defId} never gagged`);
  return events;
}

const command = (sim: Sim, cmd: Record<string, unknown>) =>
  sim.enqueue({ ...cmd, t: asSimMs(sim.world.time.sim) } as never);

/** A hand-built context for the rules that need no whole level (events and the feel). */
function stub(feel: Feel = content.feel) {
  const events: SimEvent[] = [];
  const ctx = {
    feel,
    events,
    strictInvariants: true,
    level: { microSleepIndex: -1 },
  } as unknown as StepContext;
  return { events, ctx };
}

describe('occupyPapa: a séquelle that occupies Papa (D2, AC 9)', () => {
  async function setup() {
    const sim = await newSim();
    const world = worldOf(sim);
    world.time.sim = asSimMs(1000);
    const { events, ctx } = stub();
    return { world, events, ctx };
  }

  it('busies Papa for busyMs and says so: PapaStateChanged, then AfterEffectStarted with the end', async () => {
    const { world, events, ctx } = await setup();
    occupyPapa(world, ctx, 'electrified', 1500);
    expect(world.papa.state).toBe('electrified');
    expect(world.papa.busyUntil).toBe(2500);
    expect(events).toEqual([
      { type: 'PapaStateChanged', t: 1000, from: 'idle', to: 'electrified' },
      { type: 'AfterEffectStarted', t: 1000, kind: 'electrified', until: 2500, propId: null },
    ]);
  });

  it('drops the path, the glide, the direction, the object and the intent he had', async () => {
    const { world, ctx } = await setup();
    world.papa.state = 'walkPath';
    world.papa.path = [1, 1, 2, 2];
    world.papa.objectId = 'phone';
    world.papa.intent = 'takeBaby';
    occupyPapa(world, ctx, 'asleep', 3000);
    expect(world.papa).toMatchObject({ path: [], pathIndex: 0, glide: null, objectId: null });
    expect(world.papa.intent).toBe('none');
  });

  it('replaces the séquelle under way without extending it: the new state, the old end', async () => {
    const { world, events, ctx } = await setup();
    occupyPapa(world, ctx, 'electrified', 1500); // until 2500
    events.length = 0;
    world.time.sim = asSimMs(1200);
    occupyPapa(world, ctx, 'asleep', 3000);
    expect(world.papa.state).toBe('asleep');
    // Not 1200 + 3000: the chain of misses never keeps Papa busy past the first one's end.
    expect(world.papa.busyUntil).toBe(2500);
    expect(types(events)).toEqual(['AfterEffectEnded', 'PapaStateChanged', 'AfterEffectStarted']);
    expect(events[0]).toMatchObject({ kind: 'electrified', t: 1200 });
    expect(events[2]).toMatchObject({ kind: 'asleep', until: 2500, t: 1200 });
  });

  it('changes nothing when the same séquelle comes again: the end, the state and the events stay', async () => {
    const { world, events, ctx } = await setup();
    occupyPapa(world, ctx, 'asleep', 3000); // until 4000
    events.length = 0;
    const enteredAt = world.papa.enteredAt;
    world.time.sim = asSimMs(2000);
    occupyPapa(world, ctx, 'asleep', 3000);
    expect(world.papa.busyUntil).toBe(4000);
    expect(world.papa.enteredAt).toBe(enteredAt);
    expect(events).toEqual([]);
  });

  it('cancels a chosen occupation (a coffee): no CoffeeDrunk, no reduction', async () => {
    const { world, events, ctx } = await setup();
    world.papa.state = 'drink';
    world.papa.busyUntil = asSimMs(5000);
    const fatigue = world.gauges.fatigue;
    occupyPapa(world, ctx, 'electrified', 1500);
    expect(world.papa.state).toBe('electrified');
    expect(world.papa.busyUntil).toBe(2500);
    expect(types(events)).not.toContain('CoffeeDrunk');
    expect(world.gauges.fatigue).toBe(fatigue);
  });

  it('finishes a coffee that ends this very step first (runThreats runs before runPapa)', async () => {
    const { world, events, ctx } = await setup();
    world.papa.state = 'drink';
    world.papa.busyUntil = asSimMs(1000);
    occupyPapa(world, ctx, 'asleep', 3000);
    expect(types(events).indexOf('CoffeeDrunk')).toBeGreaterThanOrEqual(0);
    expect(types(events).indexOf('CoffeeDrunk')).toBeLessThan(
      types(events).indexOf('AfterEffectStarted'),
    );
    expect(world.papa.busyUntil).toBe(4000);
  });

  it('starts afresh when the séquelle under way ends this very step: the stale end is not kept', async () => {
    const { world, events, ctx } = await setup();
    occupyPapa(world, ctx, 'electrified', 1500); // until 2500
    events.length = 0;
    world.time.sim = asSimMs(2500);
    occupyPapa(world, ctx, 'asleep', 3000);
    expect(world.papa.busyUntil).toBe(5500);
    expect(kindsOf(events, 'AfterEffectEnded')).toEqual(['electrified']);
    expect(kindsOf(events, 'AfterEffectStarted')).toEqual(['asleep']);
  });

  it('puts the baby back up when it replaces a carry (carriedUp has no one to carry him)', async () => {
    const { world, events, ctx } = await setup();
    world.papa.state = 'carryingUp';
    world.papa.busyUntil = asSimMs(2000);
    world.baby.state = 'carriedUp';
    occupyPapa(world, ctx, 'electrified', 1500);
    expect(world.baby.state).toBe('babble');
    expect(world.papa.busyUntil).toBe(2000);
    expect(kindsOf(events, 'AfterEffectEnded')).toEqual(['carryUp']);
  });
});

describe('the outlet: electrified and dim (AC 4)', () => {
  it('electrifies Papa for busyMs and dims the room for dimMs, then ends each with its event', async () => {
    const sim = await newSim();
    const events = gag(sim, 'outlet');
    const world = worldOf(sim);
    const t = world.time.sim;
    expect(world.papa.state).toBe('electrified');
    expect(world.papa.busyUntil).toBe(t + ELECTRIFIED.busyMs);
    expect(world.afterEffects.dimUntil).toBe(t + ELECTRIFIED.dimMs);
    expect(only(events, 'AfterEffectStarted')).toEqual([
      {
        type: 'AfterEffectStarted',
        t,
        kind: 'electrified',
        until: t + ELECTRIFIED.busyMs,
        propId: null,
      },
      { type: 'AfterEffectStarted', t, kind: 'dim', until: t + ELECTRIFIED.dimMs, propId: null },
    ]);
    const later = run(sim, ELECTRIFIED.dimMs / STEP_MS + 1);
    expect(only(later, 'AfterEffectEnded')).toEqual([
      { type: 'AfterEffectEnded', t: t + ELECTRIFIED.busyMs, kind: 'electrified', propId: null },
      { type: 'AfterEffectEnded', t: t + ELECTRIFIED.dimMs, kind: 'dim', propId: null },
    ]);
    expect(world.papa.state).toBe('idle');
    expect(world.afterEffects.dimUntil).toBe(0);
  });

  it('cannot answer meanwhile: a press is refused, a floor tap ignored', async () => {
    const sim = await newSim();
    gag(sim, 'outlet');
    const world = worldOf(sim);
    // A second threat telegraphs while Papa is electrified: a press on it is refused.
    const stairs = threatOf(sim, 'stairs');
    command(sim, { type: 'ForceThreat', threatId: stairs.id });
    run(sim, 2);
    command(sim, { type: 'PressThreat', threatId: stairs.id });
    command(sim, { type: 'TapFloor', xM: 0, zM: 0 });
    const events = run(sim, 2);
    expect(only(events, 'TapRefused')).toHaveLength(1);
    expect(types(events)).not.toContain('PapaPathPlanned');
    expect(world.papa.state).toBe('electrified');
  });

  it('stacks the pénombre as the later end of the two', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    // A longer pénombre is already under way: the outlet's does not shorten it.
    const longer = asSimMs(world.time.sim + 50_000);
    world.afterEffects.dimUntil = longer;
    gag(sim, 'outlet');
    expect(world.afterEffects.dimUntil).toBe(longer);
    // A shorter one is extended to the outlet's end.
    const sim2 = await newSim();
    const world2 = worldOf(sim2);
    world2.afterEffects.dimUntil = asSimMs(world2.time.sim + 100);
    gag(sim2, 'outlet');
    expect(world2.afterEffects.dimUntil).toBe(world2.time.sim + ELECTRIFIED.dimMs);
  });
});

describe('the stairs: the baby at the bottom (AC 5)', () => {
  it('sends the baby downstairs until selfReturnMs, not free, with the near miss kept', async () => {
    const sim = await newSim();
    const events = gag(sim, 'stairs');
    const world = worldOf(sim);
    const t = world.time.sim;
    expect(world.baby.state).toBe('downstairs');
    expect(world.baby.downstairsUntil).toBe(t + DOWNSTAIRS.selfReturnMs);
    expect(world.baby.targetThreatId).toBeNull();
    expect(types(events)).toContain('NearMiss');
    expect(world.score.nearMisses).toBe(1);
    expect(only(events, 'AfterEffectStarted')).toEqual([
      {
        type: 'AfterEffectStarted',
        t,
        kind: 'babyDownstairs',
        until: t + DOWNSTAIRS.selfReturnMs,
        propId: null,
      },
    ]);
    // He stays where he was (the post-gag « act » does not take him back, nor any wander).
    const place = [world.baby.xM, world.baby.zM];
    run(sim, 200);
    expect(world.baby.state).toBe('downstairs');
    expect([world.baby.xM, world.baby.zM]).toEqual(place);
  });

  it('is not taken into the 4.1 carry by a tap: Papa fetches him instead', async () => {
    const sim = await newSim();
    gag(sim, 'stairs');
    const world = worldOf(sim);
    runUntil(sim, () => world.papa.state === 'idle');
    command(sim, { type: 'TapBaby' });
    const events = run(sim, 1);
    expect(types(events)).not.toContain('BabyPickedUp');
    expect(world.baby.state).toBe('downstairs');
    expect(world.papa.state).toBe('walkPath');
    expect(world.papa.intent).toBe('fetchBaby');
  });

  it('is fetched: Papa walks to him, carries him up for carryUpMs, and he is back, babbling, where he was', async () => {
    const sim = await newSim();
    gag(sim, 'stairs');
    const world = worldOf(sim);
    command(sim, { type: 'TapBaby' });
    const walk = runUntil(sim, () => world.papa.state === 'carryingUp');
    expect(world.papa.state).toBe('carryingUp');
    const t = world.time.sim;
    expect(world.papa.busyUntil).toBe(t + DOWNSTAIRS.carryUpMs);
    expect(world.baby.state).toBe('carriedUp');
    expect(world.baby.downstairsUntil).toBeNull();
    expect(kindsOf(walk, 'AfterEffectEnded')).toEqual(['babyDownstairs']);
    expect(only(walk, 'AfterEffectStarted').at(-1)).toEqual({
      type: 'AfterEffectStarted',
      t,
      kind: 'carryUp',
      until: t + DOWNSTAIRS.carryUpMs,
      propId: null,
    });
    const place = [world.baby.xM, world.baby.zM];
    const done = run(sim, DOWNSTAIRS.carryUpMs / STEP_MS + 1);
    expect(only(done, 'AfterEffectEnded')).toEqual([
      { type: 'AfterEffectEnded', t: t + DOWNSTAIRS.carryUpMs, kind: 'carryUp', propId: null },
    ]);
    expect(world.papa.state).toBe('idle');
    expect(world.papa.busyUntil).toBe(0);
    expect(world.baby.state).toBe('babble');
    expect([world.baby.xM, world.baby.zM]).toEqual(place);
  });

  it('is fetched at once when he is within reach: no walk', async () => {
    const sim = await newSim();
    gag(sim, 'stairs');
    const world = worldOf(sim);
    world.papa.xM = world.baby.xM - 0.5;
    world.papa.zM = world.baby.zM;
    command(sim, { type: 'TapBaby' });
    run(sim, 1);
    expect(world.papa.state).toBe('carryingUp');
    expect(world.baby.state).toBe('carriedUp');
  });

  it('climbs back by himself at selfReturnMs when nobody comes', async () => {
    const sim = await newSim();
    gag(sim, 'stairs');
    const world = worldOf(sim);
    const until = world.baby.downstairsUntil as number;
    const events = runUntil(sim, () => world.baby.state !== 'downstairs');
    expect(world.time.sim).toBe(until);
    expect(world.baby.state).toBe('babble');
    expect(world.baby.downstairsUntil).toBeNull();
    expect(kindsOf(events, 'AfterEffectEnded')).toEqual(['babyDownstairs']);
  });

  it('loses the fetch race without harm: Papa walks to a baby who climbed back, and stays idle', async () => {
    const sim = await newSim();
    gag(sim, 'stairs');
    const world = worldOf(sim);
    command(sim, { type: 'TapBaby' });
    run(sim, 1);
    expect(world.papa.intent).toBe('fetchBaby');
    world.baby.downstairsUntil = asSimMs(world.time.sim + STEP_MS);
    const events = runUntil(sim, () => world.papa.state === 'idle');
    expect(world.baby.state).not.toBe('downstairs');
    expect(world.papa.state).toBe('idle');
    expect(types(events)).not.toContain('BabyPickedUp');
    expect(kindsOf(events, 'AfterEffectStarted')).toEqual([]);
    expect(world.papa.intent).toBe('none');
  });

  it('keeps the director from drawing anything that needs him while he is downstairs', async () => {
    const sim = await newSim();
    gag(sim, 'stairs');
    const world = worldOf(sim);
    // The silence is drawn only while the baby is free: a downstairs baby is not.
    const silence = threatOf(sim, 'silence_mischief');
    expect(silence.state).toBe('idle');
    expect(world.baby.state).toBe('downstairs');
  });
});

describe('the coffee table: the debris (AC 6)', () => {
  const mug = (sim: Sim) =>
    sim.world.props.find((prop) => prop.id === 'mug_01') as World['props'][number];

  it('marks the pushed prop as a debris, with the pick-up time, and says so', async () => {
    const sim = await newSim();
    const events = gag(sim, 'coffee_table_object');
    const started = only(events, 'AfterEffectStarted');
    expect(started).toEqual([
      expect.objectContaining({ kind: 'debris', until: null, propId: 'mug_01' }),
    ]);
    expect(mug(sim).debrisPickUpMs).toBe(DEBRIS.pickUpMs);
  });

  it('marks nothing when no prop is within reach (nothing pushed, nothing to pick up)', async () => {
    const reach = content.feel.gags.tableObjectFall;
    const sim = await newSim({
      feel: {
        ...content.feel,
        gags: { ...content.feel.gags, tableObjectFall: { ...reach, propReachDistM: 0.01 } },
      },
    });
    const events = gag(sim, 'coffee_table_object');
    expect(kindsOf(events, 'AfterEffectStarted')).toEqual([]);
    expect(sim.world.props.every((prop) => prop.debrisPickUpMs === 0)).toBe(true);
  });

  async function withDebris() {
    const sim = await newSim({ noise: true });
    gag(sim, 'coffee_table_object');
    runUntil(sim, () => mug(sim).isMess && sim.world.time.sim > 3000, 3000);
    runUntil(sim, () => sim.world.papa.state === 'idle');
    return sim;
  }

  it('counts in the Sigh as any prop on the floor (it is a mess)', async () => {
    const sim = await withDebris();
    expect(mug(sim).isMess).toBe(true);
    expect(sim.world.mess.propsOnFloor).toBe(1);
  });

  it('is picked up by a tap on it: Papa walks there, is busy for pickUpMs, then it is tidied', async () => {
    const sim = await withDebris();
    const world = worldOf(sim);
    command(sim, { type: 'TapObject', objectId: 'mug_01' });
    const walk = runUntil(sim, () => world.papa.state === 'pickingUp');
    expect(types(walk)).toContain('ObjectTapped');
    expect(world.papa.state).toBe('pickingUp');
    const t = world.time.sim;
    expect(world.papa.busyUntil).toBe(t + DEBRIS.pickUpMs);
    expect(mug(sim).isMess).toBe(true);
    const done = run(sim, DEBRIS.pickUpMs / STEP_MS + 1);
    expect(types(done)).toContain('PropTidied');
    expect(only(done, 'AfterEffectEnded')).toEqual([
      { type: 'AfterEffectEnded', t: t + DEBRIS.pickUpMs, kind: 'debris', propId: 'mug_01' },
    ]);
    expect(mug(sim).isMess).toBe(false);
    expect(mug(sim).debrisPickUpMs).toBe(0);
    expect(world.mess.propsOnFloor).toBe(0);
    expect(world.papa.state).toBe('idle');
    expect(world.papa.objectId).toBeNull();
  });

  it('is refused for a prop that is not a debris: a tap on the vase does nothing outside the rush', async () => {
    const sim = await withDebris();
    command(sim, { type: 'TapObject', objectId: 'vase_01' });
    const events = run(sim, 2);
    expect(types(events)).not.toContain('ObjectTapped');
  });

  it('is no debris any more once it breaks: the mark goes, with its end', async () => {
    const sim = await withDebris();
    mug(sim).isBroken = true;
    mug(sim).isMess = false;
    const events = run(sim, 1);
    expect(mug(sim).debrisPickUpMs).toBe(0);
    expect(only(events, 'AfterEffectEnded')).toEqual([
      expect.objectContaining({ kind: 'debris', propId: 'mug_01' }),
    ]);
  });

  /** Papa stands exactly on the debris for two steps, then away from it for one. */
  function stepOnAndOff(sim: Sim): SimEvent[] {
    const world = worldOf(sim);
    const prop = mug(sim);
    const events: SimEvent[] = [];
    for (const dx of [0, 0, 3]) {
      world.papa.xM = prop.xM + dx;
      world.papa.zM = prop.zM;
      events.push(...run(sim, 1));
    }
    return events;
  }

  it('makes a noise when walked on, once per entry (not once per step on it)', async () => {
    const sim = await withDebris();
    const world = worldOf(sim);
    const { debrisStep } = content.feel.noise.sources;
    const before = world.gauges.noisePct;
    const first = stepOnAndOff(sim);
    expect(only(first, 'DebrisSteppedOn')).toEqual([
      { type: 'DebrisSteppedOn', t: expect.any(Number), propId: 'mug_01' },
    ]);
    const noise = only(first, 'NoiseChanged').filter((event) => event.source === 'debrisStep');
    expect(noise).toHaveLength(1);
    expect(noise[0]?.deltaPct).toBeCloseTo(debrisStep.noisePct, 9);
    expect(world.gauges.noisePct).toBeGreaterThan(before);
    // Off it, then on it again: a new entry, a new step.
    expect(only(stepOnAndOff(sim), 'DebrisSteppedOn')).toHaveLength(1);
  });

  it('makes no noise for the debris he walks to pick up', async () => {
    const sim = await withDebris();
    const world = worldOf(sim);
    world.papa.xM = mug(sim).xM - 2;
    world.papa.zM = mug(sim).zM;
    command(sim, { type: 'TapObject', objectId: 'mug_01' });
    const events = run(sim, 1);
    events.push(...runUntil(sim, () => world.papa.state === 'idle'));
    expect(types(events)).toContain('PropTidied');
    expect(types(events)).not.toContain('DebrisSteppedOn');
  });

  it('adds no noise in a level with no noise gauge, and emits the step all the same', async () => {
    const sim = await newSim();
    gag(sim, 'coffee_table_object');
    runUntil(sim, () => mug(sim).isMess && sim.world.time.sim > 3000, 3000);
    runUntil(sim, () => sim.world.papa.state === 'idle');
    const events = stepOnAndOff(sim);
    expect(only(events, 'DebrisSteppedOn')).toHaveLength(1);
    expect(only(events, 'NoiseChanged')).toEqual([]);
    expect(sim.world.gauges.noisePct).toBe(0);
  });
});

describe('the silence: the mess that stays (AC 7)', () => {
  it('appends a mark at the baby with the gag, once per mischief, and never removes it', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    sim.enqueue({
      type: 'ForceThreat',
      t: asSimMs(0),
      threatId: threatOf(sim, 'silence_mischief').id,
    });
    const events = runUntil(sim, () => world.mess.mischiefs === 1, 4000);
    expect(world.mess.mischiefs).toBe(1);
    expect(world.afterEffects.mischiefMarks).toHaveLength(1);
    const [mark] = world.afterEffects.mischiefMarks;
    expect(['tissues_everywhere', 'crayon_scribbles']).toContain(mark?.gag);
    expect([mark?.xM, mark?.zM]).toEqual([world.baby.xM, world.baby.zM]);
    expect(only(events, 'AfterEffectStarted')).toEqual([
      expect.objectContaining({ kind: 'mess', until: null, propId: null }),
    ]);
    run(sim, 2000);
    expect(world.afterEffects.mischiefMarks).toHaveLength(1);
  });
});

describe('a séquelle never keeps Papa busy past its cap (AC 10)', () => {
  const SEEDS = 30;
  const STEPS = 2500;

  it('frees Papa within AFTER_EFFECT_BUSY_MAX_MS of the first séquelle of a chain (3 s for the nap), over random misses and fetches', async () => {
    let chains = 0;
    let replaced = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sim = await createSim({
        content,
        geometry,
        level: createTestLevel({
          waves: [
            testWave([OUTLET, STAIRS, COFFEE_TABLE], {
              gapMinMs: 100,
              gapMaxMs: 400,
              lullMs: 0,
              maxSimultaneous: 3,
            }),
          ],
          objects: TEST_OBJECTS,
          gauges: { fatigue: { microSleepDef: 'papa_microsleep' } },
          carry: CARRY,
        }),
        seed,
      });
      const rng = createRng(seed * 7919);
      let chainStartedAt: number | null = null;
      let deadline = 0;
      let wasInChain = false;
      for (let step = 0; step < STEPS; step++) {
        if (nextFloat(rng) < 0.04) {
          const pick = nextInt(rng, 0, 4);
          const t = asSimMs(sim.world.time.sim);
          if (pick === 0) sim.enqueue({ type: 'TapBaby', t });
          else if (pick === 1) sim.enqueue({ type: 'TapObject', t, objectId: 'mug_01' });
          else if (pick === 2) sim.enqueue({ type: 'TapObject', t, objectId: 'coffee_machine' });
          else sim.enqueue({ type: 'SetFatigue', t, points: 95 });
        }
        sim.step();
        for (const event of sim.drainEvents()) {
          if (event.type !== 'AfterEffectStarted') continue;
          if (event.kind !== 'electrified' && event.kind !== 'carryUp' && event.kind !== 'asleep')
            continue;
          if (chainStartedAt === null) {
            chainStartedAt = event.t;
            deadline =
              event.t +
              (event.kind === 'asleep' ? MICRO_SLEEP_BUSY_MAX_MS : AFTER_EFFECT_BUSY_MAX_MS);
            chains++;
          } else {
            replaced++;
          }
        }
        const state = sim.world.papa.state;
        const inChain = state === 'electrified' || state === 'carryingUp' || state === 'asleep';
        if (chainStartedAt !== null && !inChain && wasInChain) {
          expect(sim.world.time.sim, `seed ${seed} step ${step}`).toBeLessThanOrEqual(deadline);
          chainStartedAt = null;
        }
        // A chain cut by another busy state is not measured past that point (he is no longer in a séquelle).
        if (chainStartedAt !== null && !inChain && !wasInChain) chainStartedAt = null;
        wasInChain = inChain;
        if (chainStartedAt !== null) {
          expect(sim.world.time.sim, `seed ${seed} step ${step}: still busy`).toBeLessThanOrEqual(
            deadline + STEP_MS,
          );
        }
      }
    }
    // The run exercised séquelles, and chains of them.
    expect(chains).toBeGreaterThan(SEEDS);
    expect(replaced).toBeGreaterThan(0);
  }, 120_000);
});
