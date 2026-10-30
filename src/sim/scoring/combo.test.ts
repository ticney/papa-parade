import type { Feel } from '@content/schemas/feel';
import { STEP_MS } from '@shared/constants';
import type { RngState } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  SILENCE,
  stepN,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { ThreatInstance, World } from '../world.ts';
import {
  addCarryTickToCombo,
  addResponseToCombo,
  cashInCombo,
  resetCombo,
  startCarryTick,
  stopCarryTick,
} from './combo.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const comboFeel = content.feel.combo;

interface Options {
  /** `true`: a level with `carry` and no cry in the arms; `'cry'`: with the cry in the arms; `false`: no `carry`. */
  carry?: boolean | 'cry';
  waves?: ReturnType<typeof testWave>[];
  /** The level's objects (the phone needs its `phone` object). */
  objects?: typeof TEST_OBJECTS;
  feel?: (feel: Feel) => Feel;
  durationMs?: number;
  fatigue?: boolean;
}

async function newSim({
  carry = true,
  waves = [],
  objects,
  feel,
  durationMs,
  fatigue = false,
}: Options = {}): Promise<Sim> {
  return createSim({
    content: feel === undefined ? content : { ...content, feel: feel(content.feel) },
    geometry,
    level: createTestLevel({
      waves,
      ...(objects === undefined ? {} : { objects }),
      ...(carry === false ? {} : { carry: carry === 'cry' ? CARRY : {} }),
      ...(durationMs === undefined ? {} : { durationMs }),
      ...(fatigue ? { gauges: FATIGUE_GAUGES } : {}),
    }),
    seed: 1,
  });
}

const withCombo = (patch: Partial<Feel['combo']>) => (feel: Feel) => ({
  ...feel,
  combo: { ...feel.combo, ...patch },
});

const worldOf = (sim: Sim) => sim.world as World;

function stepEvents(sim: Sim, n = 1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

function runUntil(sim: Sim, isDone: () => boolean, maxSteps = 3000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !isDone(); i++) events.push(...stepEvents(sim));
  return events;
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

const comboEvents = (events: readonly SimEvent[]) =>
  events.filter((event) => event.type === 'ComboChanged' || event.type === 'ComboCashedIn');

/** A context for the helpers alone: the world's own feel, a `carry` level or not, and the events pushed. */
function helperCtx(world: World, hasCarry = true): { ctx: StepContext; events: SimEvent[] } {
  const events: SimEvent[] = [];
  const ctx = {
    feel: world.feel,
    events,
    strictInvariants: true,
    t: world.time.sim,
    level: { hasCarry },
  } as unknown as StepContext;
  return { ctx, events };
}

const tapBaby = (sim: Sim) => sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });

function carriedWorldSim(options: Options = {}): Promise<Sim> {
  return newSim(options).then((sim) => {
    const world = worldOf(sim);
    world.baby.xM = world.papa.xM - 0.5;
    world.baby.zM = world.papa.zM;
    world.baby.wanderAt = asSimMs(1_000_000);
    tapBaby(sim);
    stepEvents(sim);
    expect(world.baby.state).toBe('carried');
    return sim;
  });
}

/** Presses the first threat `afterMs` into its window with a Parry, and steps until it is resolved. */
function answer(sim: Sim, threat: ThreatInstance, afterMs: number | 'middle'): SimEvent[] {
  const events = runUntil(sim, () => threat.state === 'windowOpen');
  const window = threat.responseWindow;
  if (window === null) throw new Error('no window');
  const t = threat.windowOpenAt + (afterMs === 'middle' ? window.windowMs / 2 : afterMs);
  sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: threat.id });
  sim.enqueue({ type: 'Release', t: asSimMs(t + 50) });
  events.push(...runUntil(sim, () => threat.state === 'resolved'));
  return events;
}

describe('a response raises the combo (story 4.2, rule 5)', () => {
  const outletWave = [testWave([OUTLET])];

  it('adds one multiplier step and the base points of a perfect', async () => {
    const sim = await newSim({ waves: outletWave });
    const world = worldOf(sim);
    expect(world.combo).toEqual({
      multiplier: comboFeel.minMultiplier,
      basePoints: 0,
      carryTickAt: null,
    });
    const events = answer(sim, world.threats[0] as ThreatInstance, 'middle');
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'perfect' }),
    ]);
    expect(ofType(events, 'ComboChanged')).toEqual([
      {
        type: 'ComboChanged',
        t: world.time.sim,
        multiplier: comboFeel.minMultiplier + 1,
        reason: 'response',
      },
    ]);
    expect(world.combo.multiplier).toBe(comboFeel.minMultiplier + 1);
    expect(world.combo.basePoints).toBe(comboFeel.basePerResponsePoints);
  });

  it('adds the same for a plain success', async () => {
    const sim = await newSim({ waves: outletWave });
    const world = worldOf(sim);
    const events = answer(sim, world.threats[0] as ThreatInstance, 20);
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'success' }),
    ]);
    expect(ofType(events, 'ComboChanged')).toHaveLength(1);
    expect(world.combo).toMatchObject({
      multiplier: comboFeel.minMultiplier + 1,
      basePoints: comboFeel.basePerResponsePoints,
    });
  });

  it('climbs with the baby in the arms too: the cry in the arms, answered, is a response', async () => {
    const sim = await carriedWorldSim({ carry: 'cry' });
    const world = worldOf(sim);
    const armsCry = world.threats.at(-1) as ThreatInstance;
    const events = answer(sim, armsCry, 'middle');
    expect(ofType(events, 'ComboChanged').map((event) => event.reason)).toEqual(['response']);
    expect(world.combo.multiplier).toBe(comboFeel.minMultiplier + 1);
  });

  it('is reset by a missed threat, with nothing cashed', async () => {
    const sim = await newSim({ waves: outletWave });
    const world = worldOf(sim);
    world.combo.multiplier = 4;
    world.combo.basePoints = 1.5;
    const events = runUntil(sim, () => (world.threats[0] as ThreatInstance).state === 'gag');
    expect(ofType(events, 'ComboChanged')).toEqual([
      {
        type: 'ComboChanged',
        t: world.time.sim,
        multiplier: comboFeel.minMultiplier,
        reason: 'gag',
      },
    ]);
    expect(ofType(events, 'ComboCashedIn')).toEqual([]);
    expect(world.combo).toMatchObject({ multiplier: comboFeel.minMultiplier, basePoints: 0 });
    expect(world.score.comboPoints).toBe(0);
  });

  it('is reset by the cry in the arms missed, and the baby stays carried', async () => {
    const sim = await carriedWorldSim({ carry: 'cry' });
    const world = worldOf(sim);
    world.combo.multiplier = 3;
    world.combo.basePoints = 1;
    const armsCry = world.threats.at(-1) as ThreatInstance;
    const events = runUntil(sim, () => armsCry.state === 'gag');
    expect(ofType(events, 'ComboChanged').map((event) => event.reason)).toEqual(['gag']);
    expect(world.combo).toMatchObject({ multiplier: comboFeel.minMultiplier, basePoints: 0 });
    expect(world.baby.state).toBe('carried');
  });

  describe('with the micro-sleep (a threat on Papa)', () => {
    const asleepSoon = (feel: Feel): Feel => ({
      ...feel,
      fatigue: { ...feel.fatigue, startPoints: 100, microSleepMinMs: 0, microSleepMaxMs: 0 },
    });

    it('climbs when it is answered', async () => {
      const sim = await newSim({ fatigue: true, feel: asleepSoon });
      const world = worldOf(sim);
      const events = answer(sim, world.threats[0] as ThreatInstance, 'middle');
      expect(ofType(events, 'ComboChanged').map((event) => event.reason)).toEqual(['response']);
      expect(world.combo.multiplier).toBe(comboFeel.minMultiplier + 1);
    });

    it('is reset when it is missed', async () => {
      const sim = await newSim({ fatigue: true, feel: asleepSoon });
      const world = worldOf(sim);
      world.combo.multiplier = 3;
      world.combo.basePoints = 1;
      const microSleep = world.threats[0] as ThreatInstance;
      const events = runUntil(sim, () => microSleep.state === 'gag');
      expect(ofType(events, 'ComboChanged').map((event) => event.reason)).toEqual(['gag']);
      expect(world.combo).toMatchObject({ multiplier: comboFeel.minMultiplier, basePoints: 0 });
    });
  });

  it('is left alone by a threat that is cancelled: it was never answered nor missed', async () => {
    const sim = await newSim({
      waves: [testWave([OUTLET])],
      feel: (feel) => ({ ...feel, carry: { ...feel.carry, reachM: 100 } }),
    });
    const world = worldOf(sim);
    world.baby.wanderAt = asSimMs(1_000_000);
    world.combo.multiplier = 3;
    world.combo.basePoints = 1;
    stepEvents(sim);
    expect((world.threats[0] as ThreatInstance).state).toBe('telegraph');
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'ThreatCancelled')).toHaveLength(1);
    expect(comboEvents(events)).toEqual([]);
    expect(world.combo).toMatchObject({ multiplier: 3, basePoints: 1 });
  });
});

describe('every kind of gag resets the combo; what is not a miss leaves it alone (AC 5)', () => {
  const { timing, input } = content.feel;
  const outletWave = [testWave([OUTLET])];
  const AT_RISK = { multiplier: 4, basePoints: 1.5 };

  /** A sim with a combo at risk, stopped on the step that telegraphed the outlet. */
  async function telegraphedOutlet(feel?: (feel: Feel) => Feel) {
    const sim = await newSim({ waves: outletWave, ...(feel === undefined ? {} : { feel }) });
    const world = worldOf(sim);
    Object.assign(world.combo, AT_RISK);
    const outlet = world.threats[0] as ThreatInstance;
    runUntil(sim, () => outlet.state === 'telegraph');
    return { sim, world, outlet };
  }

  function expectResetByGag(events: readonly SimEvent[], world: World): void {
    expect(ofType(events, 'GagTriggered')).toHaveLength(1);
    expect(ofType(events, 'ComboChanged')).toEqual([
      {
        type: 'ComboChanged',
        t: expect.any(Number),
        multiplier: comboFeel.minMultiplier,
        reason: 'gag',
      },
    ]);
    expect(ofType(events, 'ComboCashedIn')).toEqual([]);
    expect(world.combo).toMatchObject({ multiplier: comboFeel.minMultiplier, basePoints: 0 });
    expect(world.score.comboPoints).toBe(0);
  }

  it('is reset by an early press', async () => {
    const { sim, world, outlet } = await telegraphedOutlet();
    sim.enqueue({
      type: 'PressThreat',
      t: asSimMs(outlet.windowOpenAt - timing.toleranceMs - timing.bufferMs - 1),
      threatId: outlet.id,
    });
    const events = runUntil(sim, () => outlet.state === 'gag');
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'early' }),
    ]);
    expectResetByGag(events, world);
  });

  it('is reset by the wrong kind of response: a press held is not a Parry', async () => {
    const { sim, world, outlet } = await telegraphedOutlet();
    const window = outlet.responseWindow;
    if (window === null) throw new Error('no window');
    const center = outlet.windowOpenAt + window.windowMs / 2;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: outlet.id });
    const events = runUntil(sim, () => outlet.state === 'gag');
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'wrongResponse' }),
    ]);
    expect(world.time.sim).toBeGreaterThanOrEqual(center + input.holdMinMs);
    expectResetByGag(events, world);
  });

  it('is reset by the silence that nobody found: the surprise mischief', async () => {
    const sim = await newSim({ waves: [testWave([SILENCE])] });
    const world = worldOf(sim);
    Object.assign(world.combo, AT_RISK);
    const silence = world.threats[0] as ThreatInstance;
    const events = runUntil(sim, () => silence.state === 'gag', 6000);
    expect(silence.state).toBe('gag');
    expect(ofType(events, 'SilenceEnded')).toEqual([
      expect.objectContaining({ reason: 'timedOut' }),
    ]);
    expectResetByGag(events, world);
  });

  it('is left alone by an early press under earlyPress: guard', async () => {
    const { sim, world, outlet } = await telegraphedOutlet((feel) => ({
      ...feel,
      input: { ...feel.input, earlyPress: 'guard' },
    }));
    sim.enqueue({
      type: 'PressThreat',
      t: asSimMs(outlet.windowOpenAt - 400),
      threatId: outlet.id,
    });
    const events = stepEvents(sim, 30);
    expect(ofType(events, 'GagTriggered')).toEqual([]);
    expect(comboEvents(events)).toEqual([]);
    expect(world.combo).toMatchObject(AT_RISK);
  });

  it('is left alone by a phone that rings out: it is not a missed threat', async () => {
    const sim = await newSim({
      waves: [testWave([], { disruptions: [testPhoneEntry(0)] })],
      objects: TEST_OBJECTS,
    });
    const world = worldOf(sim);
    Object.assign(world.combo, AT_RISK);
    const events = runUntil(sim, () => world.disruptions[0]?.state === 'timedOut', 6000);
    expect(ofType(events, 'PhoneRingEnded')).toEqual([
      expect.objectContaining({ reason: 'timedOut' }),
    ]);
    expect(comboEvents(events)).toEqual([]);
    expect(world.combo).toMatchObject(AT_RISK);
  });

  it('is left alone by the cry in the arms cancelled at the put-down: never answered nor missed', async () => {
    const sim = await carriedWorldSim({ carry: 'cry' });
    const world = worldOf(sim);
    Object.assign(world.combo, { multiplier: 3, basePoints: 1 });
    const armsCry = world.threats.at(-1) as ThreatInstance;
    runUntil(sim, () => armsCry.state === 'telegraph');
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'BabyPutDown')).toHaveLength(1);
    expect(ofType(events, 'ThreatCancelled')).toEqual([
      expect.objectContaining({ reason: 'putDown' }),
    ]);
    expect(ofType(events, 'GagTriggered')).toEqual([]);
    expect(ofType(events, 'ComboChanged')).toEqual([]);
    expect(world.combo.multiplier).toBe(3);
    expect(world.combo.basePoints).toBe(1);
  });
});

describe('the base points and the cap', () => {
  it('stops the multiplier at maxMultiplier with no event, but the base points still grow', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    const { ctx, events } = helperCtx(world);
    const { maxMultiplier, basePerResponsePoints } = comboFeel;
    for (let i = 0; i < maxMultiplier + 3; i++) addResponseToCombo(world, ctx);
    expect(world.combo.multiplier).toBe(maxMultiplier);
    expect(events).toHaveLength(maxMultiplier - comboFeel.minMultiplier);
    expect(world.combo.basePoints).toBeCloseTo((maxMultiplier + 3) * basePerResponsePoints, 9);
    addCarryTickToCombo(world, ctx);
    expect(events).toHaveLength(maxMultiplier - comboFeel.minMultiplier);
    expect(world.combo.basePoints).toBeCloseTo(
      (maxMultiplier + 3) * basePerResponsePoints + comboFeel.basePerCarryTickPoints,
      9,
    );
  });

  it('never lowers a running multiplier when a SetFeel lowers the maximum', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    world.combo.multiplier = 6;
    world.combo.basePoints = 2;
    sim.enqueue({
      type: 'SetFeel',
      t: asSimMs(world.time.sim),
      patch: { combo: { maxMultiplier: 3 } },
    });
    stepEvents(sim);
    expect(world.feel.combo.maxMultiplier).toBe(3);
    const { ctx, events } = helperCtx(world);
    addResponseToCombo(world, ctx);
    expect(world.combo.multiplier).toBe(6);
    expect(world.combo.basePoints).toBeCloseTo(2 + comboFeel.basePerResponsePoints, 9);
    expect(events).toEqual([]);
  });

  it('resets to the minimum with no base points, and says so only if the multiplier moved', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    const { ctx, events } = helperCtx(world);
    resetCombo(world, ctx, 'gag');
    expect(events).toEqual([]);
    world.combo.multiplier = 5;
    world.combo.basePoints = 2.5;
    resetCombo(world, ctx, 'gag');
    expect(events).toEqual([
      {
        type: 'ComboChanged',
        t: world.time.sim,
        multiplier: comboFeel.minMultiplier,
        reason: 'gag',
      },
    ]);
    expect(world.combo.basePoints).toBe(0);
  });

  it('consumes no random number anywhere', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    const before: RngState = structuredClone(world.rng);
    const { ctx } = helperCtx(world);
    addResponseToCombo(world, ctx);
    addCarryTickToCombo(world, ctx);
    startCarryTick(world, ctx);
    cashInCombo(world, ctx, true);
    resetCombo(world, ctx, 'gag');
    stopCarryTick(world);
    expect(world.rng).toEqual(before);
  });
});

describe('the carry tick (rule 6)', () => {
  it('fires at exactly carryTickMs after the take, and once', async () => {
    const sim = await carriedWorldSim();
    const world = worldOf(sim);
    const takenAt = world.time.sim;
    expect(world.combo.carryTickAt).toBe(takenAt + comboFeel.carryTickMs);
    const before = stepEvents(sim, comboFeel.carryTickMs / STEP_MS - 1);
    expect(comboEvents(before)).toEqual([]);
    const events = stepEvents(sim);
    expect(world.time.sim).toBe(takenAt + comboFeel.carryTickMs);
    expect(ofType(events, 'ComboChanged')).toEqual([
      {
        type: 'ComboChanged',
        t: takenAt + comboFeel.carryTickMs,
        multiplier: comboFeel.minMultiplier + 1,
        reason: 'carryTick',
      },
    ]);
    expect(world.combo.basePoints).toBe(comboFeel.basePerCarryTickPoints);
    expect(world.combo.carryTickAt).toBe(takenAt + 2 * comboFeel.carryTickMs);
  });

  it('does not drift: a period that is not a multiple of the step keeps its own rhythm', async () => {
    const sim = await carriedWorldSim({ feel: withCombo({ carryTickMs: 25, maxMultiplier: 8 }) });
    const world = worldOf(sim);
    const takenAt = world.time.sim;
    const events = stepEvents(sim, 17);
    // Due at +25, +50, +75, +100, +125, +150, each run at the first step at or after it: a drift
    // (rescheduling from the step that ran) would give 30, 60, 90...
    expect(ofType(events, 'ComboChanged').map((event) => event.t - takenAt)).toEqual([
      30, 50, 80, 100, 130, 150,
    ]);
    expect(world.combo.carryTickAt).toBe(takenAt + 175);
  });

  it('is pushed back by a gag while carried: the ten seconds are without incident', async () => {
    const sim = await carriedWorldSim({ carry: 'cry' });
    const world = worldOf(sim);
    const armsCry = world.threats.at(-1) as ThreatInstance;
    const takenAt = world.time.sim;
    expect(world.combo.carryTickAt).toBe(takenAt + comboFeel.carryTickMs);
    const events = runUntil(sim, () => armsCry.state === 'gag');
    const gagAt = ofType(events, 'GagTriggered')[0]?.t ?? -1;
    expect(gagAt).toBeGreaterThan(takenAt);
    expect(world.combo.carryTickAt).toBe(gagAt + comboFeel.carryTickMs);
  });

  it('stops at the put-down, and runs on while Papa is busy', async () => {
    const sim = await carriedWorldSim();
    const world = worldOf(sim);
    world.papa.state = 'asleep';
    world.papa.busyUntil = asSimMs(world.time.sim + 100_000);
    const events = stepEvents(sim, comboFeel.carryTickMs / STEP_MS);
    expect(ofType(events, 'ComboChanged')).toHaveLength(1);
    world.papa.state = 'idle';
    tapBaby(sim);
    stepEvents(sim);
    expect(world.baby.state).toBe('babble');
    expect(world.combo.carryTickAt).toBeNull();
    const later = stepEvents(sim, (3 * comboFeel.carryTickMs) / STEP_MS);
    expect(comboEvents(later)).toEqual([]);
  });

  it('does not run while the baby is not carried', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    expect(world.combo.carryTickAt).toBeNull();
    const events = stepEvents(sim, (2 * comboFeel.carryTickMs) / STEP_MS);
    expect(comboEvents(events)).toEqual([]);
    expect(world.combo.multiplier).toBe(comboFeel.minMultiplier);
  });
});

describe('a level without carry (D3)', () => {
  it('emits no combo event and keeps world.combo at rest, whatever the player does', async () => {
    const sim = await newSim({ carry: false, waves: [testWave([OUTLET])] });
    const world = worldOf(sim);
    const rest = structuredClone(world.combo);
    const answered = answer(sim, world.threats[0] as ThreatInstance, 'middle');
    const missed = runUntil(sim, () => (world.threats[0] as ThreatInstance).state === 'gag', 6000);
    const events = [...answered, ...missed];
    expect(ofType(events, 'ResponseResolved').length).toBeGreaterThan(0);
    expect(comboEvents(events)).toEqual([]);
    expect(world.combo).toEqual(rest);
    expect(world.score.comboPoints).toBe(0);
  });

  it('makes every helper a no-op', async () => {
    const sim = await newSim({ carry: false });
    const world = worldOf(sim);
    const rest = structuredClone(world.combo);
    const { ctx, events } = helperCtx(world, false);
    addResponseToCombo(world, ctx);
    addCarryTickToCombo(world, ctx);
    startCarryTick(world, ctx);
    world.combo.multiplier = 4;
    world.combo.basePoints = 1;
    cashInCombo(world, ctx, true);
    resetCombo(world, ctx, 'gag');
    expect(events).toEqual([]);
    expect(world.combo).toEqual({ ...rest, multiplier: 4, basePoints: 1 });
    expect(world.score.comboPoints).toBe(0);
    expect(world.time.slowMos).toEqual([]);
  });
});

describe('the whole level keeps the combo within its bounds', () => {
  it('stays between the minimum and the maximum while carrying through a level', async () => {
    const sim = await newSim({
      carry: 'cry',
      waves: [testWave([OUTLET], { gapMinMs: 500, gapMaxMs: 500 })],
      feel: withCombo({ carryTickMs: 300 }),
    });
    const world = worldOf(sim);
    world.baby.wanderAt = asSimMs(1_000_000);
    world.baby.xM = world.papa.xM - 0.5;
    world.baby.zM = world.papa.zM;
    tapBaby(sim);
    for (let i = 0; i < 2000; i++) {
      sim.step();
      sim.drainEvents();
      expect(world.combo.multiplier).toBeGreaterThanOrEqual(comboFeel.minMultiplier);
      expect(world.combo.multiplier).toBeLessThanOrEqual(comboFeel.maxMultiplier);
    }
    stepN(sim, 1);
  });
});
