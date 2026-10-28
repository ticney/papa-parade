import type { ContentBundle } from '@content/contentBundle';
import type { Feel } from '@content/schemas/feel';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  TEST_OBJECTS,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

const base = createTestContent();
const geometry = createTestGeometry();
const { coffeeDurationMs, coffeeReductionPoints } = base.feel.fatigue;

function contentWith(fatigue: Partial<Feel['fatigue']> = {}): ContentBundle {
  return { ...base, feel: { ...base.feel, fatigue: { ...base.feel.fatigue, ...fatigue } } };
}

async function newSim(
  options: {
    fatigue?: Partial<Feel['fatigue']>;
    waves?: ReturnType<typeof testWave>[];
    hasFatigue?: boolean;
  } = {},
): Promise<Sim> {
  return createSim({
    content: contentWith(options.fatigue),
    geometry,
    level: createTestLevel({
      waves: options.waves ?? [],
      objects: TEST_OBJECTS,
      gauges: options.hasFatigue === false ? {} : FATIGUE_GAUGES,
    }),
    seed: 1,
  });
}

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;

/** Enqueues `cmd` stamped with the sim's current time. */
const command = (sim: Sim, cmd: DistributiveOmit<SimCommand, 't'>): void =>
  sim.enqueue({ ...cmd, t: asSimMs(sim.world.time.sim) } as SimCommand);

/** Steps until `untilSimMs` and returns the events they emitted. */
function runUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

/** Steps until an event of `type` appears; returns every event so far and the step's fatigue before it. */
function runUntilEvent(sim: Sim, type: SimEvent['type'], limitMs = 30_000) {
  const events: SimEvent[] = [];
  let fatigueBefore = sim.world.gauges.fatigue;
  while (sim.world.time.sim < limitMs) {
    fatigueBefore = sim.world.gauges.fatigue;
    sim.step();
    const stepEvents = [...sim.drainEvents()];
    events.push(...stepEvents);
    if (stepEvents.some((event) => event.type === type)) return { events, fatigueBefore };
  }
  throw new Error(`no ${type} within ${limitMs} ms`);
}

const types = (events: readonly SimEvent[]) => events.map((event) => event.type);

describe('the coffee', () => {
  it('walks Papa to the machine, starts on arrival, and drinks for exactly coffeeDurationMs', async () => {
    const sim = await newSim();
    command(sim, { type: 'SetFatigue', points: 80 });
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    const { events } = runUntilEvent(sim, 'CoffeeStarted');
    const started = events.find((event) => event.type === 'CoffeeStarted') as Extract<
      SimEvent,
      { type: 'CoffeeStarted' }
    >;
    const arrived = events.find((event) => event.type === 'PapaArrived') as { t: number };
    expect(types(events)).toContain('ObjectTapped');
    expect(started.t).toBe(arrived.t);
    expect(started).toMatchObject({
      objectId: 'coffee_machine',
      untilAt: arrived.t + coffeeDurationMs,
    });
    expect(sim.world.papa.state).toBe('drink');
    expect(sim.world.papa.objectId).toBeNull();
    // Nothing is drunk before the time is up...
    const midway = runUntil(sim, started.untilAt - 10);
    expect(types(midway)).not.toContain('CoffeeDrunk');
    expect(sim.world.papa.state).toBe('drink');
    // ...and the first step at or after `untilAt` drinks it.
    const drunk = runUntilEvent(sim, 'CoffeeDrunk');
    const event = drunk.events.find((candidate) => candidate.type === 'CoffeeDrunk') as {
      t: number;
      fatigue: number;
    };
    expect(event.t).toBe(started.untilAt);
    expect(event.fatigue).toBeCloseTo(drunk.fatigueBefore - coffeeReductionPoints, 9);
    expect(sim.world.papa).toMatchObject({ state: 'idle', busyUntil: 0 });
  });

  it('drops fatigue by coffeeReductionPoints and crosses the threshold downwards when it takes it under', async () => {
    const sim = await newSim();
    command(sim, { type: 'SetFatigue', points: 90 });
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    const { events } = runUntilEvent(sim, 'CoffeeDrunk');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'FatigueThresholdCrossed', isAbove: false }),
    );
    expect(sim.world.gauges.microSleepAt).toBeNull();
  });

  it('holds fatigue at 0 when the coffee takes more than there is', async () => {
    const sim = await newSim();
    command(sim, { type: 'SetFatigue', points: 10 });
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    const { events } = runUntilEvent(sim, 'CoffeeDrunk');
    expect(events.find((event) => event.type === 'CoffeeDrunk')).toMatchObject({ fatigue: 0 });
  });

  it('is cancelled by a TapFloor or a Move before arrival', async () => {
    const cancel: Record<string, (sim: Sim) => void> = {
      TapFloor: (sim) => command(sim, { type: 'TapFloor', xM: 0, zM: 0 }),
      Move: (sim) => command(sim, { type: 'Move', dirX: 0, dirZ: 1 }),
    };
    for (const [name, issue] of Object.entries(cancel)) {
      const sim = await newSim();
      command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
      runUntil(sim, 30);
      expect(sim.world.papa.objectId, name).toBe('coffee_machine');
      issue(sim);
      const events = runUntil(sim, 20_000);
      expect(types(events), name).not.toContain('CoffeeStarted');
      expect(sim.world.papa.objectId, name).toBeNull();
    }
  });

  it('is cancelled by a press on a threat, which glides Papa away', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET])] });
    runUntil(sim, 20); // the outlet is telegraphed at the first step
    const outlet = sim.world.threats.find((threat) => threat.defId === 'outlet');
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    runUntil(sim, 40);
    command(sim, { type: 'PressThreat', threatId: outlet?.id ?? 0 });
    const events = runUntil(sim, 20_000);
    expect(types(events)).toContain('PapaGlideStarted');
    expect(types(events)).not.toContain('CoffeeStarted');
  });

  it('keeps walking to the machine through a press on the micro-sleep (nowhere to glide)', async () => {
    // Slow enough that Papa is still on his way when the micro-sleep's window opens.
    const slow: ContentBundle = {
      ...contentWith({ startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 }),
    };
    slow.feel = { ...slow.feel, movement: { ...slow.feel.movement, walkSpeedMps: 0.5 } };
    const sim = await createSim({
      content: slow,
      geometry,
      level: createTestLevel({ objects: TEST_OBJECTS, gauges: FATIGUE_GAUGES }),
      seed: 1,
    });
    runUntil(sim, 20);
    const microSleep = sim.world.threats[0];
    expect(microSleep?.state).toBe('telegraph');
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    const pressAt =
      (microSleep?.windowOpenAt ?? 0) + (microSleep?.responseWindow?.windowMs ?? 0) / 2;
    runUntil(sim, pressAt - 20);
    expect(sim.world.papa.state).toBe('walkPath');
    sim.enqueue({ type: 'PressThreat', t: asSimMs(pressAt), threatId: microSleep?.id ?? 0 });
    sim.enqueue({ type: 'Release', t: asSimMs(pressAt + 100) });
    // Judged on its press, then still on his way to the machine (a second micro-sleep is due at
    // once, so the end of the walk is not followed here).
    const events = runUntil(sim, pressAt + 200);
    expect(types(events)).not.toContain('PapaGlideStarted');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', quality: 'perfect' }),
    );
    expect(sim.world.papa).toMatchObject({
      state: 'walkPath',
      objectId: 'coffee_machine',
      glide: null,
    });
  });

  it('answers nothing while Papa drinks: taps, moves and presses are ignored, and a threat that opens gags late', async () => {
    const sim = await newSim({
      fatigue: { coffeeDurationMs: 60_000 },
      waves: [testWave([OUTLET], { gapMinMs: 15_000, gapMaxMs: 15_000 })],
    });
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    runUntilEvent(sim, 'CoffeeStarted');
    expect(sim.world.papa.state).toBe('drink');
    expect(sim.world.time.sim).toBeLessThan(15_000);
    const outlet = sim.world.threats.find((threat) => threat.defId === 'outlet');
    const { xM, zM } = sim.world.papa;
    command(sim, { type: 'TapFloor', xM: 0, zM: 0 });
    command(sim, { type: 'TapObject', objectId: 'phone' });
    command(sim, { type: 'Move', dirX: 1, dirZ: 0 });
    command(sim, { type: 'MoveStop' });
    const events = runUntil(sim, sim.world.time.sim + 200);
    expect(types(events)).not.toContain('PapaPathPlanned');
    expect(types(events)).not.toContain('ObjectTapped');
    expect(sim.world.papa).toMatchObject({ state: 'drink', xM, zM });
    // The outlet opens meanwhile; a press on it is ignored, so it ends in its gag.
    for (let i = 0; i < 3000 && outlet?.state !== 'windowOpen'; i++)
      runUntil(sim, sim.world.time.sim + 10);
    if (outlet?.state !== 'windowOpen') throw new Error('the outlet never opened');
    const center = outlet.windowOpenAt + (outlet.responseWindow?.windowMs ?? 0) / 2;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: outlet.id });
    sim.enqueue({ type: 'Release', t: asSimMs(center + 100) });
    const late = runUntil(sim, center + 1000);
    expect(late).toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', quality: 'fail', reason: 'late' }),
    );
    expect(types(late)).not.toContain('PapaGlideStarted');
    expect(sim.world.papa.state).toBe('drink');
  });

  it('is cancelled when Papa falls asleep meanwhile: no CoffeeDrunk, no reduction', async () => {
    const sim = await newSim({
      fatigue: {
        startPoints: 90,
        microSleepMinMs: 0,
        microSleepMaxMs: 0,
        coffeeDurationMs: 20_000,
      },
    });
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    // The micro-sleep is due at once and nobody answers it: Papa falls asleep on the way or at the machine.
    const events = runUntil(sim, 12_000);
    const fell = events.find((event) => event.type === 'PapaStateChanged' && event.to === 'asleep');
    expect(fell, 'the unanswered micro-sleep puts him to sleep').toBeDefined();
    expect(types(events).filter((type) => type === 'CoffeeDrunk')).toEqual([]);
    expect(sim.world.papa.objectId).toBeNull();
  });

  it('only walks to a phone that is not ringing (a ringing one is answered: see the phone call tests)', async () => {
    const sim = await newSim();
    command(sim, { type: 'TapObject', objectId: 'phone' });
    const events = runUntil(sim, 20_000);
    expect(types(events)).toContain('PapaArrived');
    expect(types(events)).not.toContain('CoffeeStarted');
    expect(sim.world.papa.state).toBe('idle');
  });

  it('leaves fatigue at 0 in a level with no fatigue gauge, and says so in CoffeeDrunk', async () => {
    const sim = await newSim({ hasFatigue: false, fatigue: { startPoints: 60 } });
    command(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    const { events } = runUntilEvent(sim, 'CoffeeDrunk');
    expect(events.find((event) => event.type === 'CoffeeDrunk')).toMatchObject({ fatigue: 0 });
  });
});
