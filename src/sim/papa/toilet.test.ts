import type { Feel } from '@content/schemas/feel';
import { MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NEED_GAUGES,
  OUTLET,
  TEST_OBJECTS,
  TEST_TOILET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

const base = createTestContent();
const geometry = createTestGeometry();
const { toiletDurationMs, perSec } = base.feel.bladder;
const gainPerStepPct = (perSec * STEP_MS) / MS_PER_S;

interface Options {
  bladder?: Partial<Feel['bladder']>;
  waves?: ReturnType<typeof testWave>[];
  fatigue?: boolean;
  carry?: boolean;
}

async function newSim({
  bladder = {},
  waves = [],
  fatigue = false,
  carry = false,
}: Options = {}): Promise<Sim> {
  const feel = { ...base.feel, bladder: { ...base.feel.bladder, ...bladder } };
  return createSim({
    content: { ...base, feel },
    geometry,
    level: createTestLevel({
      waves,
      objects: [...TEST_OBJECTS, TEST_TOILET],
      gauges: fatigue ? { ...NEED_GAUGES, ...FATIGUE_GAUGES } : NEED_GAUGES,
      ...(carry ? { carry: CARRY } : {}),
    }),
    seed: 1,
  });
}

const worldOf = (sim: Sim) => sim.world as World;
const types = (events: readonly SimEvent[]) => events.map((event) => event.type);
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

/** Steps until `untilSimMs` and returns the events they emitted. */
function runUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

/** Steps until an event of `type` appears; returns every event so far. */
function runUntilEvent(sim: Sim, type: SimEvent['type'], limitMs = 60_000): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < limitMs) {
    sim.step();
    const stepEvents = [...sim.drainEvents()];
    events.push(...stepEvents);
    if (stepEvents.some((event) => event.type === type)) return events;
  }
  throw new Error(`no ${type} within ${limitMs} ms`);
}

const tapToilet = (sim: Sim) =>
  sim.enqueue({ type: 'TapObject', t: asSimMs(sim.world.time.sim), objectId: 'toilet' });
const tapBaby = (sim: Sim) => sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });

/** Taps the toilet and steps to the arrival; returns the events up to `ToiletStarted`. */
function walkIn(sim: Sim): SimEvent[] {
  tapToilet(sim);
  return runUntilEvent(sim, 'ToiletStarted');
}

describe('the toilet (story 4.3)', () => {
  it('walks Papa to the door, starts on arrival, and finishes exactly toiletDurationMs later with the need at 0', async () => {
    const sim = await newSim({ bladder: { startPct: 60 } });
    const events = walkIn(sim);
    const started = ofType(events, 'ToiletStarted')[0] as Extract<
      SimEvent,
      { type: 'ToiletStarted' }
    >;
    const arrived = ofType(events, 'PapaArrived')[0];
    expect(types(events)).toContain('ObjectTapped');
    expect(started.t).toBe(arrived?.t);
    expect(started).toMatchObject({ objectId: 'toilet', untilAt: started.t + toiletDurationMs });
    expect(sim.world.papa.state).toBe('onToilet');
    expect(sim.world.papa.objectId).toBeNull();
    expect(sim.world.papa.intent).toBe('none');
    const { xM, zM } = sim.world.papa;
    // Nothing finishes before the time is up, and the need does not move meanwhile.
    const frozen = sim.world.gauges.bladderPct;
    const midway = runUntil(sim, started.untilAt - STEP_MS);
    expect(types(midway)).not.toContain('ToiletFinished');
    expect(sim.world.papa.state).toBe('onToilet');
    expect(sim.world.gauges.bladderPct).toBe(frozen);
    // The first step at or after `untilAt` ends it.
    const finished = runUntilEvent(sim, 'ToiletFinished');
    expect(ofType(finished, 'ToiletFinished')[0]?.t).toBe(started.untilAt);
    // `runBladder` runs after the reset in that very step: the gauge ends it on one step's gain.
    expect(sim.world.gauges.bladderPct).toBeCloseTo(gainPerStepPct, 9);
    expect(sim.world.papa).toMatchObject({ state: 'idle', busyUntil: 0, xM, zM });
  });

  it('makes BladderFilled fire again after a visit (the flag falls with the gauge)', async () => {
    const sim = await newSim({ bladder: { toiletDurationMs: 500 } });
    sim.enqueue({ type: 'SetBladder', t: asSimMs(0), pct: 100 });
    const filled = runUntil(sim, 20);
    expect(ofType(filled, 'BladderFilled')).toHaveLength(1);
    walkIn(sim);
    runUntilEvent(sim, 'ToiletFinished');
    expect(sim.world.gauges.isBladderFull).toBe(false);
    sim.enqueue({ type: 'SetBladder', t: asSimMs(sim.world.time.sim), pct: 100 });
    expect(ofType(runUntil(sim, sim.world.time.sim + 20), 'BladderFilled')).toHaveLength(1);
  });

  it('is cancelled by a TapFloor or a Move before arrival', async () => {
    const cancel: Record<string, (sim: Sim) => void> = {
      TapFloor: (sim) => sim.enqueue({ type: 'TapFloor', t: asSimMs(0), xM: 0, zM: 0 }),
      Move: (sim) => sim.enqueue({ type: 'Move', t: asSimMs(0), dirX: 0, dirZ: 1 }),
    };
    for (const [name, issue] of Object.entries(cancel)) {
      const sim = await newSim();
      tapToilet(sim);
      runUntil(sim, 30);
      expect(sim.world.papa.objectId, name).toBe('toilet');
      issue(sim);
      const events = runUntil(sim, 20_000);
      expect(types(events), name).not.toContain('ToiletStarted');
    }
  });

  it('answers nothing while Papa is on the toilet: taps, moves and presses are ignored', async () => {
    const sim = await newSim({ bladder: { toiletDurationMs: 60_000 } });
    walkIn(sim);
    const { xM, zM } = sim.world.papa;
    sim.enqueue({ type: 'TapFloor', t: asSimMs(sim.world.time.sim), xM: 0, zM: 0 });
    sim.enqueue({ type: 'TapObject', t: asSimMs(sim.world.time.sim), objectId: 'phone' });
    sim.enqueue({ type: 'Move', t: asSimMs(sim.world.time.sim), dirX: 1, dirZ: 0 });
    sim.enqueue({ type: 'MoveStop', t: asSimMs(sim.world.time.sim) });
    sim.enqueue({ type: 'PressThreat', t: asSimMs(sim.world.time.sim), threatId: 1 });
    sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });
    const events = runUntil(sim, sim.world.time.sim + 300);
    expect(types(events)).not.toContain('PapaPathPlanned');
    expect(types(events)).not.toContain('ObjectTapped');
    expect(types(events)).not.toContain('PapaGlideStarted');
    expect(types(events)).not.toContain('BabyPickedUp');
    expect(sim.world.papa).toMatchObject({ state: 'onToilet', xM, zM });
    expect(sim.world.baby.state).not.toBe('carried');
  });

  it('lets the room go on: a threat that opens gags late and resets the combo; the baby wanders; fatigue rises', async () => {
    const sim = await newSim({
      bladder: { toiletDurationMs: 60_000 },
      waves: [testWave([OUTLET], { gapMinMs: 15_000, gapMaxMs: 15_000 })],
      fatigue: true,
      carry: true,
    });
    walkIn(sim);
    expect(sim.world.time.sim).toBeLessThan(15_000);
    const world = worldOf(sim);
    // A combo is running: the gag must break it.
    world.combo.multiplier = 4;
    const fatigueBefore = world.gauges.fatigue;
    const babyBefore = { xM: world.baby.xM, zM: world.baby.zM };
    const outlet = world.threats.find((threat) => threat.defId === 'outlet');
    for (let i = 0; i < 3000 && outlet?.state !== 'windowOpen'; i++)
      runUntil(sim, world.time.sim + 10);
    if (outlet?.state !== 'windowOpen') throw new Error('the outlet never opened');
    const center = outlet.windowOpenAt + (outlet.responseWindow?.windowMs ?? 0) / 2;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: outlet.id });
    sim.enqueue({ type: 'Release', t: asSimMs(center + 100) });
    const events = runUntil(sim, center + 1500);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', quality: 'fail', reason: 'late' }),
    );
    expect(events).toContainEqual(expect.objectContaining({ type: 'ComboChanged', reason: 'gag' }));
    expect(world.combo.multiplier).toBe(base.feel.combo.minMultiplier);
    expect(types(events)).not.toContain('PapaGlideStarted');
    expect(world.papa.state).toBe('onToilet');
    expect(world.gauges.fatigue).toBeGreaterThan(fatigueBefore);
    expect(world.baby.xM !== babyBefore.xM || world.baby.zM !== babyBefore.zM).toBe(true);
  });

  it('judges a press at the step the visit ends, and glides him (the busy test uses busyUntil)', async () => {
    const sim = await newSim({
      waves: [testWave([OUTLET], { gapMinMs: 0, gapMaxMs: 0 })],
    });
    sim.step();
    sim.drainEvents();
    const outlet = sim.world.threats.find((threat) => threat.defId === 'outlet');
    if (outlet === undefined) throw new Error('no outlet');
    const endsAt = asSimMs(outlet.windowOpenAt + 50);
    sim.world.papa.state = 'onToilet';
    sim.world.papa.busyUntil = endsAt;
    runUntil(sim, endsAt - STEP_MS);
    expect(sim.world.papa.state).toBe('onToilet');
    sim.enqueue({ type: 'PressThreat', t: endsAt, threatId: outlet.id });
    sim.enqueue({ type: 'Release', t: asSimMs(endsAt + 50) });
    const events = runUntil(sim, endsAt + 300);
    expect(types(events)).toContain('ToiletFinished');
    expect(types(events)).toContain('PapaGlideStarted');
    expect(events).not.toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', reason: 'late' }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', response: 'parry' }),
    );
  });

  describe('a nap while he is in there (D5)', () => {
    /** An unanswered micro-sleep that gags `late` at `gagsAt`. */
    async function sleepySim(
      toiletMs: number,
    ): Promise<{ sim: Sim; arm: (gagsAt: number) => void }> {
      const sim = await newSim({
        bladder: { startPct: 50, toiletDurationMs: toiletMs },
        fatigue: true,
      });
      const arm = (gagsAt: number) => {
        const microSleep = sim.world.threats[0];
        if (microSleep === undefined) throw new Error('no micro-sleep instance');
        const { toleranceMs } = base.feel.timing;
        microSleep.state = 'windowOpen';
        microSleep.press = null;
        microSleep.responseWindow = { windowMs: 100, perfectMs: 50, toleranceMs, bufferMs: 0 };
        microSleep.windowOpenAt = asSimMs(gagsAt - 100 - toleranceMs - 1);
        sim.world.gauges.microSleepAt = null;
      };
      return { sim, arm };
    }

    it('replaces the visit: no ToiletFinished, no reset, Papa is back in the room, asleep', async () => {
      const { sim, arm } = await sleepySim(20_000);
      walkIn(sim);
      const bladderBefore = sim.world.gauges.bladderPct;
      arm(sim.world.time.sim + 300);
      const events = runUntil(sim, sim.world.time.sim + 600);
      expect(events).toContainEqual(
        expect.objectContaining({ type: 'GagTriggered', gag: 'papa_asleep' }),
      );
      expect(types(events)).not.toContain('ToiletFinished');
      expect(sim.world.papa.state).toBe('asleep');
      expect(sim.world.papa.objectId).toBeNull();
      // Not reset; and it rises again now that he is no longer on the toilet.
      expect(sim.world.gauges.bladderPct).toBeGreaterThanOrEqual(bladderBefore);
      expect(sim.world.gauges.bladderPct).toBeLessThan(bladderBefore + 1);
    });

    it('finishes the visit first when it ends in the very step he falls asleep', async () => {
      const { sim, arm } = await sleepySim(1000);
      walkIn(sim);
      const endsAt = sim.world.papa.busyUntil;
      arm(endsAt);
      const events = runUntil(sim, endsAt);
      expect(types(events)).toContain('ToiletFinished');
      expect(types(events)).toContain('GagTriggered');
      expect(sim.world.papa.state).toBe('asleep');
      expect(sim.world.gauges.bladderPct).toBeLessThan(1);
    });
  });

  describe('with the baby in the arms (D4)', () => {
    /** The baby sits 0.5 m from Papa, still, and is taken. */
    function takeBaby(sim: Sim): void {
      const world = worldOf(sim);
      world.baby.xM = world.papa.xM - 0.5;
      world.baby.zM = world.papa.zM;
      world.baby.prevXM = world.baby.xM;
      world.baby.prevZM = world.baby.zM;
      world.baby.wanderAt = asSimMs(1_000_000);
      tapBaby(sim);
      runUntil(sim, sim.world.time.sim + STEP_MS);
      expect(world.baby.state).toBe('carried');
    }

    it('refuses the tap: no path, the walk he is on goes on, one ToiletRefused and no ObjectTapped', async () => {
      const sim = await newSim({ carry: true });
      takeBaby(sim);
      sim.enqueue({ type: 'TapFloor', t: asSimMs(sim.world.time.sim), xM: 1, zM: 0 });
      runUntil(sim, sim.world.time.sim + 3 * STEP_MS);
      const path = [...sim.world.papa.path];
      expect(sim.world.papa.state).toBe('walkPath');
      tapToilet(sim);
      const events = runUntil(sim, sim.world.time.sim + STEP_MS);
      expect(ofType(events, 'ToiletRefused')).toEqual([
        expect.objectContaining({ objectId: 'toilet' }),
      ]);
      expect(types(events)).not.toContain('ObjectTapped');
      expect(types(events)).not.toContain('PapaPathPlanned');
      expect(sim.world.papa.path).toEqual(path);
      expect(sim.world.papa.objectId).toBeNull();
      expect(sim.world.papa.state).toBe('walkPath');
      // He walks on to where he was going and never goes in.
      const rest = runUntil(sim, sim.world.time.sim + 20_000);
      expect(types(rest)).not.toContain('ToiletStarted');
    });

    it('accepts the same tap once the baby is put down', async () => {
      const sim = await newSim({ carry: true });
      takeBaby(sim);
      tapToilet(sim);
      expect(ofType(runUntil(sim, sim.world.time.sim + STEP_MS), 'ToiletRefused')).toHaveLength(1);
      tapBaby(sim);
      runUntil(sim, sim.world.time.sim + STEP_MS);
      expect(worldOf(sim).baby.state).not.toBe('carried');
      tapToilet(sim);
      const events = runUntilEvent(sim, 'ToiletStarted');
      expect(ofType(events, 'ToiletRefused')).toEqual([]);
      expect(sim.world.papa.state).toBe('onToilet');
    });

    it('cancels the walk to the door when the baby is taken on the way: he never arrives carried', async () => {
      const sim = await newSim({ carry: true, bladder: { toiletDurationMs: 60_000 } });
      tapToilet(sim);
      runUntil(sim, 30);
      expect(sim.world.papa.objectId).toBe('toilet');
      takeBaby(sim);
      expect(sim.world.papa.objectId).toBeNull();
      const events = runUntil(sim, sim.world.time.sim + 20_000);
      expect(types(events)).not.toContain('ToiletStarted');
      expect(sim.world.papa.state).not.toBe('onToilet');
    });
  });

  it('walks to a toilet at the same pace as before when the need is below the slow threshold', async () => {
    const sim = await newSim({ bladder: { startPct: 90 } });
    const without = await newSim({ bladder: { startPct: 0 } });
    const a = ofType(walkIn(sim), 'ToiletStarted')[0];
    const b = ofType(walkIn(without), 'ToiletStarted')[0];
    expect(a?.t).toBe(b?.t);
  });
});
