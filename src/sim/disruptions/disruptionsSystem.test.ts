import type { ContentBundle } from '@content/contentBundle';
import type { DisruptionDef } from '@content/schemas/disruption';
import { PHONE_RINGING_EVERY_MS, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  STAIRS,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { DISRUPTION_STATES, DISRUPTION_STATES_ARE_COMPLETE } from './disruptionFsm.ts';

const content: ContentBundle = createTestContent();
const geometry = createTestGeometry();

interface Options {
  atMs?: number | null;
  phone?: Partial<DisruptionDef>;
  durationMs?: number;
  threats?: Parameters<typeof testWave>[0];
  waveOverrides?: Parameters<typeof testWave>[1];
  seed?: number;
}

/** A level whose single wave plans the phone at `atMs` (null: none). */
async function newSim(options: Options = {}): Promise<Sim> {
  const {
    atMs = 1000,
    phone = {},
    durationMs,
    threats = [],
    waveOverrides = {},
    seed = 1,
  } = options;
  const level = createTestLevel({
    waves: [
      testWave(threats, {
        ...waveOverrides,
        disruptions: atMs === null ? [] : [testPhoneEntry(atMs)],
      }),
    ],
    objects: TEST_OBJECTS,
    ...(durationMs === undefined ? {} : { durationMs }),
  });
  const def = level.disruptions.phone;
  return createSim({
    content,
    geometry,
    level: def === undefined ? level : { ...level, disruptions: { phone: { ...def, ...phone } } },
    seed,
  });
}

/** Steps until `untilSimMs`, returning the events. */
function runUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const phoneEvents = (events: readonly SimEvent[]) =>
  events.filter((event) => event.type.startsWith('Phone'));
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

const { ringMaxMs } = createTestLevel({
  waves: [testWave([], { disruptions: [testPhoneEntry(0)] })],
}).disruptions.phone as DisruptionDef;

describe('the disruption states', () => {
  it('lists every state, and is proved complete at compile time', () => {
    expect([...DISRUPTION_STATES]).toEqual(['pending', 'ringing', 'answered', 'timedOut']);
    expect(DISRUPTION_STATES_ARE_COMPLETE).toBe(true);
  });
});

describe('runDisruptions (story 1.20)', () => {
  it('keeps a planned disruption pending until atMs, then rings at the first step at or after it', async () => {
    const sim = await newSim({ atMs: 1235 });
    expect(sim.world.disruptions).toEqual([
      { state: 'pending', enteredAt: 0, untilAt: 0, nextRingingAt: 0 },
    ]);
    // 1230 is the last step before atMs (1235): the next one, 1240, is the first at or after it.
    const before = runUntil(sim, 1230);
    expect(phoneEvents(before)).toEqual([]);
    expect(sim.world.disruptions[0]?.state).toBe('pending');
    const events = runUntil(sim, 1240);
    expect(phoneEvents(events)).toEqual([
      { type: 'PhoneRingStarted', t: 1240, objectId: 'phone', untilAt: 1240 + ringMaxMs },
    ]);
    expect(sim.world.disruptions[0]).toEqual({
      state: 'ringing',
      enteredAt: 1240,
      untilAt: 1240 + ringMaxMs,
      nextRingingAt: 1240 + PHONE_RINGING_EVERY_MS,
    });
  });

  it('emits floor(ringMaxMs / PHONE_RINGING_EVERY_MS) PhoneRinging, each one period after the previous, and the timeout at the end', async () => {
    const sim = await newSim({ atMs: 500 });
    const events = phoneEvents(runUntil(sim, 500 + ringMaxMs + 1000));
    const started = ofType(events, 'PhoneRingStarted')[0] as { t: number };
    const ringing = ofType(events, 'PhoneRinging');
    expect(ringing).toHaveLength(Math.floor(ringMaxMs / PHONE_RINGING_EVERY_MS));
    ringing.forEach((event, index) => {
      expect(event.t).toBe(started.t + (index + 1) * PHONE_RINGING_EVERY_MS);
      expect(event.objectId).toBe('phone');
    });
    expect(ofType(events, 'PhoneRingEnded')).toEqual([
      { type: 'PhoneRingEnded', t: started.t + ringMaxMs, objectId: 'phone', reason: 'timedOut' },
    ]);
    expect(sim.world.disruptions[0]).toEqual({
      state: 'timedOut',
      enteredAt: started.t + ringMaxMs,
      untilAt: 0,
      nextRingingAt: 0,
    });
  });

  it('emits a tick and the timeout due in the same step in that order: the tick first', async () => {
    // 15 s is a whole number of periods, so the last tick falls in the step of the timeout.
    expect(ringMaxMs % PHONE_RINGING_EVERY_MS).toBe(0);
    const sim = await newSim({ atMs: 0 });
    const events = runUntil(sim, ringMaxMs + STEP_MS);
    const ended = ofType(events, 'PhoneRingEnded')[0] as { t: number };
    const sameStep = events.filter((event) => 't' in event && event.t === ended.t);
    expect(sameStep.map((event) => event.type)).toEqual(['PhoneRinging', 'PhoneRingEnded']);
  });

  it('counts floor(ringMaxMs / period) ticks when the ring does not end on a period, never one after the end', async () => {
    const sim = await newSim({ atMs: 0, phone: { ringMaxMs: 2500 } });
    const events = phoneEvents(runUntil(sim, 6000));
    expect(ofType(events, 'PhoneRinging').map((event) => event.t)).toEqual([1010, 2010]);
    // The first step at or after 2500 + start (10) = 2510.
    expect(ofType(events, 'PhoneRingEnded').map((event) => event.t)).toEqual([2510]);
  });

  it('gives up at the first step at or after untilAt when untilAt is off the step grid', async () => {
    const sim = await newSim({ atMs: 0, phone: { ringMaxMs: 1005 } });
    const events = phoneEvents(runUntil(sim, 3000));
    const started = ofType(events, 'PhoneRingStarted')[0] as { t: number; untilAt: number };
    expect(started.untilAt).toBe(started.t + 1005);
    expect(ofType(events, 'PhoneRinging').map((event) => event.t)).toEqual([started.t + 1000]);
    expect(ofType(events, 'PhoneRingEnded').map((event) => event.t)).toEqual([started.t + 1010]);
  });

  it('never drifts: the ticks are due from the start, not from the step that emitted the last one', async () => {
    // A period that is not a multiple of the step would drift if each tick were counted from the
    // step of the last one. The constant is a multiple, so check the due instants directly.
    const sim = await newSim({ atMs: 5, phone: { ringMaxMs: 9000 } });
    const events = phoneEvents(runUntil(sim, 12_000));
    const started = ofType(events, 'PhoneRingStarted')[0] as { t: number };
    const ticks = ofType(events, 'PhoneRinging').map((event) => event.t - started.t);
    expect(ticks).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => k * PHONE_RINGING_EVERY_MS));
  });

  it('fires at most once per level: nothing follows the timeout', async () => {
    const sim = await newSim({ atMs: 0, phone: { ringMaxMs: 500 } });
    const first = phoneEvents(runUntil(sim, 1000));
    expect(first.map((event) => event.type)).toEqual(['PhoneRingStarted', 'PhoneRingEnded']);
    const later = phoneEvents(runUntil(sim, 30_000));
    expect(later).toEqual([]);
    expect(sim.world.disruptions[0]?.state).toBe('timedOut');
  });

  it('plans nothing, and emits nothing, in a level with no disruption', async () => {
    const sim = await newSim({ atMs: null });
    expect(sim.world.disruptions).toEqual([]);
    expect(phoneEvents(runUntil(sim, 5000))).toEqual([]);
  });

  it('draws nothing from world.rng: the stream after 20000 steps is the same with and without the phone', async () => {
    const withPhone = await newSim({ atMs: 1000, seed: 7 });
    const without = await newSim({ atMs: null, seed: 7 });
    for (let i = 0; i < 20_000; i++) {
      withPhone.step();
      without.step();
    }
    expect(withPhone.world.rng).toEqual(without.world.rng);
    expect(withPhone.world.nextId).toBe(without.world.nextId);
  });

  it('is not a threat: the director neither counts nor draws it, and telegraphs the same threats', async () => {
    const threats = [OUTLET, STAIRS, COFFEE_TABLE];
    const wave = { maxSimultaneous: 3, gapMinMs: 100, gapMaxMs: 400 };
    const telegraphs = async (atMs: number | null) => {
      const sim = await newSim({
        atMs,
        threats,
        waveOverrides: wave,
        phone: { ringMaxMs: 60_000 },
      });
      const events = runUntil(sim, 3000);
      return { sim, telegraphs: ofType(events, 'ThreatTelegraphed') };
    };
    const quiet = await telegraphs(null);
    const ringing = await telegraphs(0);
    expect(ringing.sim.world.disruptions[0]?.state).toBe('ringing');
    expect(ringing.telegraphs).toHaveLength(3);
    expect(ringing.telegraphs).toEqual(quiet.telegraphs);
    expect(ringing.sim.world.threats.map((threat) => threat.waveIndex)).toEqual(
      quiet.sim.world.threats.map((threat) => threat.waveIndex),
    );
  });

  it('freezes with the level: nothing rings once it has ended, and a late StartDisruption is ignored', async () => {
    const sim = await newSim({ atMs: null, durationMs: 1000 });
    runUntil(sim, 1500);
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.disruptions).toEqual([]);

    const ringing = await newSim({ atMs: 500, durationMs: 2000 });
    const events = runUntil(ringing, 2500);
    expect(ringing.world.flow.state).toBe('ended');
    expect(ofType(events, 'LevelEnded')).toHaveLength(1);
    const lastTick = ofType(events, 'PhoneRinging').at(-1);
    expect(lastTick?.t ?? 0).toBeLessThanOrEqual(2000);
    // Frozen mid-ring: no timeout, no more ticks, whatever the clock does.
    expect(ofType(events, 'PhoneRingEnded')).toEqual([]);
    expect(phoneEvents(runUntil(ringing, 5000))).toEqual([]);
    expect(ringing.world.disruptions[0]?.state).toBe('ringing');
  });
});

describe('StartDisruption (story 1.20)', () => {
  const start = (sim: Sim, index: number): void =>
    sim.enqueue({ type: 'StartDisruption', t: asSimMs(sim.world.time.sim), index } as SimCommand);

  it('starts a pending disruption now, long before its atMs', async () => {
    const sim = await newSim({ atMs: 100_000 });
    runUntil(sim, 200);
    start(sim, 0);
    const events = phoneEvents(runUntil(sim, 300));
    expect(events).toEqual([
      expect.objectContaining({ type: 'PhoneRingStarted', objectId: 'phone' }),
    ]);
    expect(sim.world.disruptions[0]?.state).toBe('ringing');
  });

  it('is ignored with no event once the disruption is ringing, answered or timed out', async () => {
    const sim = await newSim({ atMs: 0, phone: { ringMaxMs: 500 } });
    runUntil(sim, 100);
    expect(sim.world.disruptions[0]?.state).toBe('ringing');
    start(sim, 0);
    // Ringing: no second start, so no second PhoneRingStarted and the untilAt does not move.
    const untilAt = sim.world.disruptions[0]?.untilAt;
    expect(phoneEvents(runUntil(sim, 200))).toEqual([]);
    expect(sim.world.disruptions[0]?.untilAt).toBe(untilAt);
    runUntil(sim, 1000);
    expect(sim.world.disruptions[0]?.state).toBe('timedOut');
    start(sim, 0);
    expect(phoneEvents(runUntil(sim, 1200))).toEqual([]);
    expect(sim.world.disruptions[0]?.state).toBe('timedOut');
  });

  it('is ignored for an index the level does not have', async () => {
    const sim = await newSim({ atMs: 100_000 });
    start(sim, 3);
    expect(phoneEvents(runUntil(sim, 100))).toEqual([]);
    expect(sim.world.disruptions[0]?.state).toBe('pending');
    const quiet = await newSim({ atMs: null });
    start(quiet, 0);
    expect(phoneEvents(runUntil(quiet, 100))).toEqual([]);
  });

  it('is journaled, so a replay rings the same phone at the same step', async () => {
    const sim = await newSim({ atMs: 100_000 });
    runUntil(sim, 250);
    start(sim, 0);
    runUntil(sim, 600);
    const journal = sim.journal();
    expect(journal.entries.map((entry) => entry.command.type)).toEqual(['StartDisruption']);
    const replay = await createSim({
      content,
      geometry,
      level: createTestLevel({
        waves: [testWave([], { disruptions: [testPhoneEntry(100_000)] })],
        objects: TEST_OBJECTS,
      }),
      seed: 1,
      journal,
    });
    runUntil(replay, 600);
    expect(replay.world.disruptions).toEqual(sim.world.disruptions);
  });
});
