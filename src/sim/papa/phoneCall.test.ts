import type { ContentBundle } from '@content/contentBundle';
import type { DisruptionDef } from '@content/schemas/disruption';
import type { Feel } from '@content/schemas/feel';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestPhone,
  FATIGUE_GAUGES,
  OUTLET,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

const base = createTestContent();
const geometry = createTestGeometry();
const { answerBusyMs, answerFatiguePoints } = createTestPhone();

interface Options {
  fatigue?: Partial<Feel['fatigue']>;
  hasFatigue?: boolean;
  /** Replaces fields of the frozen phone def. */
  phone?: Partial<DisruptionDef>;
  waves?: ReturnType<typeof testWave>[];
}

async function newSim(options: Options = {}): Promise<Sim> {
  const content: ContentBundle = {
    ...base,
    feel: { ...base.feel, fatigue: { ...base.feel.fatigue, ...options.fatigue } },
  };
  const level = createTestLevel({
    waves: options.waves ?? [testWave([], { disruptions: [testPhoneEntry(100_000)] })],
    objects: TEST_OBJECTS,
    gauges: options.hasFatigue === false ? {} : FATIGUE_GAUGES,
  });
  const def = level.disruptions.phone as DisruptionDef;
  return createSim({
    content,
    geometry,
    level: { ...level, disruptions: { phone: { ...def, ...options.phone } } },
    seed: 1,
  });
}

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;
const command = (sim: Sim, cmd: DistributiveOmit<SimCommand, 't'>): void =>
  sim.enqueue({ ...cmd, t: asSimMs(sim.world.time.sim) } as SimCommand);

function runUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

/** The events up to the step that emits one of `type`, and the fatigue just before that step. */
function runUntilEventWithFatigue(sim: Sim, type: SimEvent['type'], limitMs = 30_000) {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < limitMs) {
    const fatigueBefore = sim.world.gauges.fatigue;
    sim.step();
    const stepEvents = [...sim.drainEvents()];
    events.push(...stepEvents);
    if (stepEvents.some((event) => event.type === type)) return { events, fatigueBefore };
  }
  throw new Error(`no ${type} within ${limitMs} ms`);
}

function runUntilEvent(sim: Sim, type: SimEvent['type'], limitMs = 30_000): SimEvent[] {
  return runUntilEventWithFatigue(sim, type, limitMs).events;
}

const types = (events: readonly SimEvent[]) => events.map((event) => event.type);
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

/** A sim where the phone rings from the first step and Papa has been told to go and answer it. */
async function ringingAndTapped(options: Options = {}): Promise<Sim> {
  const sim = await newSim(options);
  command(sim, { type: 'StartDisruption', index: 0 });
  command(sim, { type: 'TapObject', objectId: 'phone' });
  return sim;
}

describe('answering the phone (story 1.20)', () => {
  it('answers on arrival: PhoneRingEnded, onPhone for exactly answerBusyMs, +fatigue, PhoneAnswered, then idle', async () => {
    const sim = await ringingAndTapped();
    command(sim, { type: 'SetFatigue', points: 40 });
    const { events, fatigueBefore } = runUntilEventWithFatigue(sim, 'PhoneAnswered');
    const arrived = ofType(events, 'PapaArrived')[0] as { t: number };
    const ended = ofType(events, 'PhoneRingEnded');
    const answered = ofType(events, 'PhoneAnswered')[0] as Extract<
      SimEvent,
      { type: 'PhoneAnswered' }
    >;
    // The ring ends and the call starts at the arrival, in this order.
    expect(ended).toEqual([
      { type: 'PhoneRingEnded', t: arrived.t, objectId: 'phone', reason: 'answered' },
    ]);
    const tail = types(events).slice(types(events).indexOf('PapaArrived'));
    expect(tail).toEqual(['PapaArrived', 'PhoneRingEnded', 'PapaStateChanged', 'PhoneAnswered']);
    expect(answered).toEqual({
      type: 'PhoneAnswered',
      t: arrived.t,
      objectId: 'phone',
      untilAt: arrived.t + answerBusyMs,
      fatigue: fatigueBefore + answerFatiguePoints,
    });
    expect(sim.world.papa).toMatchObject({
      state: 'onPhone',
      busyUntil: arrived.t + answerBusyMs,
      objectId: null,
    });
    // The gauge shows the cost at once (the step's own gain follows in `runGauges`).
    expect(sim.world.gauges.fatigue).toBeGreaterThanOrEqual(answered.fatigue);
    expect(sim.world.disruptions[0]).toMatchObject({
      state: 'answered',
      untilAt: 0,
      nextRingingAt: 0,
    });

    // Still on the phone the step before the end...
    const midway = runUntil(sim, answered.untilAt - 10);
    expect(sim.world.papa.state).toBe('onPhone');
    expect(types(midway)).not.toContain('PapaStateChanged');
    // ...and idle at the first step at or after it, with nothing but the state change emitted.
    const end = runUntil(sim, answered.untilAt + 10);
    expect(end).toEqual([
      { type: 'PapaStateChanged', t: answered.untilAt, from: 'onPhone', to: 'idle' },
    ]);
    expect(sim.world.papa).toMatchObject({ state: 'idle', busyUntil: 0 });
    // Nothing takes the points back when the call ends.
    expect(sim.world.gauges.fatigue).toBeGreaterThanOrEqual(answered.fatigue);
  });

  it('holds fatigue at 100, and PhoneAnswered says the value after the add', async () => {
    const sim = await ringingAndTapped();
    command(sim, { type: 'SetFatigue', points: 100 - answerFatiguePoints / 2 });
    const events = runUntilEvent(sim, 'PhoneAnswered');
    expect(ofType(events, 'PhoneAnswered')[0]?.fatigue).toBe(100);
    expect(sim.world.gauges.fatigue).toBe(100);
  });

  it('crosses the fatigue threshold upwards when the call takes Papa over it', async () => {
    const sim = await ringingAndTapped();
    const { thresholdPoints } = base.feel.fatigue;
    command(sim, { type: 'SetFatigue', points: thresholdPoints });
    const events = runUntilEvent(sim, 'PhoneAnswered');
    const crossed = ofType(events, 'FatigueThresholdCrossed');
    expect(crossed.at(-1)).toMatchObject({ isAbove: true });
    // The crossing comes before the announcement of the answer, in the step of the answer.
    expect(types(events).indexOf('FatigueThresholdCrossed')).toBeLessThan(
      types(events).indexOf('PhoneAnswered'),
    );
    expect(sim.world.gauges.isFatigueAbove).toBe(answerFatiguePoints > 0);
  });

  it('keeps the def numbers out of the code: another def, another call', async () => {
    const sim = await ringingAndTapped({ phone: { answerBusyMs: 1230, answerFatiguePoints: 3 } });
    command(sim, { type: 'SetFatigue', points: 10 });
    const { events, fatigueBefore } = runUntilEventWithFatigue(sim, 'PhoneAnswered');
    const answered = ofType(events, 'PhoneAnswered')[0] as {
      t: number;
      untilAt: number;
      fatigue: number;
    };
    expect(answered.untilAt - answered.t).toBe(1230);
    expect(answered.fatigue).toBeCloseTo(fatigueBefore + 3, 9);
  });

  it('busies Papa and ends the call in a level with no fatigue gauge, whose fatigue stays 0', async () => {
    const sim = await ringingAndTapped({ hasFatigue: false });
    const events = runUntilEvent(sim, 'PhoneAnswered');
    expect(ofType(events, 'PhoneAnswered')[0]?.fatigue).toBe(0);
    expect(sim.world.gauges.fatigue).toBe(0);
    expect(sim.world.papa.state).toBe('onPhone');
    runUntil(sim, sim.world.time.sim + answerBusyMs + 10);
    expect(sim.world.papa.state).toBe('idle');
  });

  it('only walks to a phone that is not ringing yet: idle on arrival, no phone event, and it rings on later', async () => {
    const sim = await newSim();
    command(sim, { type: 'TapObject', objectId: 'phone' });
    const events = runUntil(sim, 20_000);
    expect(types(events)).toContain('PapaArrived');
    expect(types(events).filter((type) => type.startsWith('Phone'))).toEqual([]);
    expect(sim.world.papa.state).toBe('idle');
    expect(sim.world.disruptions[0]?.state).toBe('pending');
  });

  it('finds a silent phone when it timed out during the walk: Papa is simply idle there', async () => {
    const sim = await ringingAndTapped({ phone: { ringMaxMs: 200 } });
    const events = runUntil(sim, 20_000);
    const ended = ofType(events, 'PhoneRingEnded');
    const arrived = ofType(events, 'PapaArrived')[0] as { t: number };
    // The premise: the ring gave up before Papa got there.
    expect(ended).toEqual([expect.objectContaining({ reason: 'timedOut', t: expect.any(Number) })]);
    expect((ended[0] as { t: number }).t).toBeLessThan(arrived.t);
    expect(types(events)).not.toContain('PhoneAnswered');
    expect(sim.world.papa.state).toBe('idle');
    expect(sim.world.disruptions[0]?.state).toBe('timedOut');
  });

  it('is decided on arrival, not on the tap: a phone that starts ringing during the walk is answered', async () => {
    const sim = await newSim();
    command(sim, { type: 'TapObject', objectId: 'phone' });
    runUntil(sim, 100);
    expect(sim.world.papa.state).toBe('walkPath');
    command(sim, { type: 'StartDisruption', index: 0 });
    const events = runUntilEvent(sim, 'PhoneAnswered');
    expect(types(events)).toContain('PhoneRingStarted');
  });

  it('is cancelled by a TapFloor or a Move before arrival: the phone keeps ringing', async () => {
    const cancel: Record<string, (sim: Sim) => void> = {
      TapFloor: (sim) => command(sim, { type: 'TapFloor', xM: 0, zM: 0 }),
      Move: (sim) => command(sim, { type: 'Move', dirX: 0, dirZ: 1 }),
    };
    for (const [name, issue] of Object.entries(cancel)) {
      const sim = await ringingAndTapped();
      runUntil(sim, 100);
      expect(sim.world.papa.objectId, name).toBe('phone');
      issue(sim);
      const events = runUntil(sim, 3000);
      expect(types(events), name).not.toContain('PhoneAnswered');
      expect(sim.world.papa.objectId, name).toBeNull();
      expect(sim.world.disruptions[0]?.state, name).toBe('ringing');
    }
  });

  it('cannot be answered twice: a second visit finds a phone that has been answered', async () => {
    const sim = await ringingAndTapped();
    runUntilEvent(sim, 'PhoneAnswered');
    runUntil(sim, sim.world.time.sim + answerBusyMs + 10);
    command(sim, { type: 'TapObject', objectId: 'phone' });
    const events = runUntil(sim, sim.world.time.sim + 500);
    expect(types(events)).toContain('PapaArrived');
    expect(types(events)).not.toContain('PhoneAnswered');
    expect(sim.world.papa.state).toBe('idle');
  });

  it('answers nothing while Papa is on the phone: taps, moves and presses are ignored', async () => {
    const sim = await ringingAndTapped({ phone: { answerBusyMs: 60_000 } });
    runUntilEvent(sim, 'PhoneAnswered');
    const { xM, zM } = sim.world.papa;
    command(sim, { type: 'TapFloor', xM: 0, zM: 0 });
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    command(sim, { type: 'Move', dirX: 1, dirZ: 0 });
    command(sim, { type: 'MoveStop' });
    command(sim, { type: 'PressThreat', threatId: 1 });
    const events = runUntil(sim, sim.world.time.sim + 300);
    expect(types(events)).not.toContain('PapaPathPlanned');
    expect(types(events)).not.toContain('ObjectTapped');
    expect(sim.world.papa).toMatchObject({ state: 'onPhone', xM, zM });
  });

  it('gags a threat that opens during the call late: that is the price of answering', async () => {
    const sim = await newSim({
      phone: { answerBusyMs: 60_000 },
      waves: [
        testWave([OUTLET], {
          gapMinMs: 15_000,
          gapMaxMs: 15_000,
          disruptions: [testPhoneEntry(100_000)],
        }),
      ],
    });
    command(sim, { type: 'StartDisruption', index: 0 });
    command(sim, { type: 'TapObject', objectId: 'phone' });
    runUntilEvent(sim, 'PhoneAnswered');
    expect(sim.world.time.sim).toBeLessThan(15_000);
    const outlet = sim.world.threats.find((threat) => threat.defId === 'outlet');
    for (let i = 0; i < 3000 && outlet?.state !== 'windowOpen'; i++) {
      runUntil(sim, sim.world.time.sim + 10);
    }
    if (outlet?.state !== 'windowOpen') throw new Error('the outlet never opened');
    const center = outlet.windowOpenAt + (outlet.responseWindow?.windowMs ?? 0) / 2;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: outlet.id });
    sim.enqueue({ type: 'Release', t: asSimMs(center + 100) });
    const late = runUntil(sim, center + 1000);
    expect(late).toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', quality: 'fail', reason: 'late' }),
    );
    expect(types(late)).not.toContain('PapaGlideStarted');
    expect(sim.world.papa.state).toBe('onPhone');
  });

  it('is cut short when a micro-sleep gags during the call: Papa falls asleep, and the fatigue added stays', async () => {
    // Above the threshold from the start, with a micro-sleep due 1.5 s in: it is telegraphed
    // while Papa walks, he is on the phone before it gags, and nobody answers it.
    const sim = await ringingAndTapped({
      fatigue: { startPoints: 80, microSleepMinMs: 1500, microSleepMaxMs: 1500 },
      phone: { answerBusyMs: 60_000 },
    });
    const events = runUntil(sim, 15_000);
    const answered = ofType(events, 'PhoneAnswered')[0];
    const asleep = events.find(
      (event) => event.type === 'PapaStateChanged' && event.to === 'asleep',
    );
    expect(answered, 'he answers').toBeDefined();
    expect(asleep, 'the unanswered micro-sleep puts him to sleep').toBeDefined();
    // It was during the call: the sleep ends it long before the 60 s were up.
    expect((asleep as { t: number }).t).toBeGreaterThan((answered as { t: number }).t);
    expect((asleep as { t: number }).t).toBeLessThan((answered as { untilAt: number }).untilAt);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'PapaStateChanged', from: 'onPhone', to: 'asleep' }),
    );
    // The nap does not take the call's points back.
    expect(sim.world.gauges.fatigue).toBeGreaterThanOrEqual(
      (answered as { fatigue: number }).fatigue,
    );
    expect(ofType(events, 'CoffeeDrunk')).toEqual([]);
  });

  it('lets a micro-sleep wait while Papa is on the phone, and telegraphs it once he is free', async () => {
    const sim = await newSim({
      fatigue: { microSleepMinMs: 0, microSleepMaxMs: 0 },
      phone: { answerBusyMs: 4000 },
    });
    // Under the threshold: nothing is due yet. Answer first, then tire him during the call.
    command(sim, { type: 'StartDisruption', index: 0 });
    command(sim, { type: 'TapObject', objectId: 'phone' });
    runUntilEvent(sim, 'PhoneAnswered');
    command(sim, { type: 'SetFatigue', points: 95 });
    const during = runUntil(sim, sim.world.time.sim + 3000);
    expect(types(during)).not.toContain('ThreatTelegraphed');
    expect(sim.world.papa.state).toBe('onPhone');
    const after = runUntil(sim, sim.world.time.sim + 2000);
    expect(types(after)).toContain('ThreatTelegraphed');
  });

  it('still takes a Release during the call (it names no threat)', async () => {
    const sim = await ringingAndTapped({ phone: { answerBusyMs: 60_000 } });
    runUntilEvent(sim, 'PhoneAnswered');
    command(sim, { type: 'Release' });
    expect(() => runUntil(sim, sim.world.time.sim + 50)).not.toThrow();
    expect(sim.world.papa.state).toBe('onPhone');
  });
});
