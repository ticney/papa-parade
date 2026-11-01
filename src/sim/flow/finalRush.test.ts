import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  stepN,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { sequenceRefusal } from '../sequences/sequenceStart.ts';
import type { World } from '../world.ts';
import { type FinalRushRoom, finalRushProblems, playableMsOf } from './finalRush.ts';
import { enterFlowState, isFlowLive } from './flowFsm.ts';

const DURATION_MS = 30_000;
const FEEL = createTestContent().feel;
const RUSH_MS = FEEL.endOfLevel.finalRushMs;
const RUSH_AT = DURATION_MS - RUSH_MS;
const FINAL_RUSH = { spillAnchor: 'coffee_table' };

interface Options {
  durationMs?: number;
  finalRush?: boolean;
  noise?: boolean;
  sequences?: readonly string[];
  carry?: boolean;
  phone?: boolean;
}

/** The frozen room, whose props are all breakable: the spill has nothing to knock over here (`doorSpillCount: 0`). */
async function newSim(options: Options = {}): Promise<Sim> {
  const content = createTestContent();
  content.feel.endOfLevel.doorSpillCount = 0;
  return createSim({
    content,
    geometry: createTestGeometry(),
    level: createTestLevel({
      durationMs: options.durationMs ?? DURATION_MS,
      objects: TEST_OBJECTS,
      gauges: {
        ...(options.noise === true ? NOISE_GAUGES : {}),
        ...(options.sequences?.includes('stay_awake') === true ? FATIGUE_GAUGES : {}),
      },
      waves: options.phone === true ? [testWave([], { disruptions: [testPhoneEntry(0)] })] : [],
      sequences: options.sequences ?? [],
      ...(options.carry === true ? { carry: CARRY } : {}),
      ...(options.finalRush === false ? {} : { finalRush: FINAL_RUSH }),
    }),
    seed: 3,
  });
}

const worldOf = (sim: Sim) => sim.world as World;

function runTo(sim: Sim, untilMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilMs) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

const of = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

describe('the final rush starts (AC 3)', () => {
  it('begins at the first step where the clock reaches durationMs - finalRushMs, once', async () => {
    const sim = await newSim();
    const before = runTo(sim, RUSH_AT - STEP_MS);
    expect(of(before, 'FinalRushStarted')).toEqual([]);
    expect(sim.world.flow).toEqual({ state: 'playing', enteredAt: 0, finalRushAt: null });
    const at = runTo(sim, RUSH_AT);
    expect(of(at, 'FinalRushStarted')).toEqual([{ type: 'FinalRushStarted', t: RUSH_AT }]);
    expect(sim.world.flow).toEqual({
      state: 'finalRush',
      enteredAt: RUSH_AT,
      finalRushAt: RUSH_AT,
    });
    expect(isFlowLive(worldOf(sim))).toBe(true);
    const after = runTo(sim, DURATION_MS - STEP_MS);
    expect(of(after, 'FinalRushStarted')).toEqual([]);
  });

  it('reads feel.endOfLevel.finalRushMs at each step (a SetFeel moves it)', async () => {
    const sim = await newSim();
    sim.enqueue({
      type: 'SetFeel',
      t: asSimMs(0),
      patch: { endOfLevel: { finalRushMs: 4000 } },
    });
    const events = runTo(sim, DURATION_MS - 4000);
    expect(of(events, 'FinalRushStarted')).toEqual([
      { type: 'FinalRushStarted', t: DURATION_MS - 4000 },
    ]);
  });

  it('never starts in a level without finalRush: it ends on `ended`, as before', async () => {
    const sim = await newSim({ finalRush: false });
    const events = runTo(sim, DURATION_MS);
    expect(of(events, 'FinalRushStarted')).toEqual([]);
    expect(sim.world.flow).toEqual({ state: 'ended', enteredAt: DURATION_MS, finalRushAt: null });
  });

  it('closes a running sequence first: SequenceEnded{levelEnded} before FinalRushStarted, no resume', async () => {
    const sim = await newSim({ sequences: ['stay_awake'], carry: true });
    runTo(sim, RUSH_AT - 2000);
    sim.enqueue({
      type: 'StartSequence',
      t: asSimMs(sim.world.time.sim),
      sequenceId: 'stay_awake',
    });
    sim.step();
    sim.drainEvents();
    expect(sim.world.flow.state).toBe('sequence');
    const nextAt = sim.world.director.nextAt;
    const events = runTo(sim, RUSH_AT);
    const types = events.map((event) => event.type);
    expect(of(events, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: RUSH_AT, id: 'stay_awake', outcome: 'levelEnded' },
    ]);
    expect(types.indexOf('SequenceEnded')).toBeLessThan(types.indexOf('FinalRushStarted'));
    expect(sim.world.flow.state).toBe('finalRush');
    expect(sim.world.sequence.id).toBeNull();
    expect(sim.world.director.nextAt).toBe(nextAt);
  });

  it('closes a duel sequence with the baby in the arms, too', async () => {
    const sim = await newSim({ sequences: ['bedtime_duel'], carry: true });
    runTo(sim, RUSH_AT - 2000);
    sim.enqueue({
      type: 'StartSequence',
      t: asSimMs(sim.world.time.sim),
      sequenceId: 'bedtime_duel',
    });
    sim.step();
    sim.drainEvents();
    expect(sim.world.flow.state).toBe('sequence');
    const events = runTo(sim, RUSH_AT);
    expect(of(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bedtime_duel', outcome: 'levelEnded' }),
    ]);
    expect(sim.world.flow.state).toBe('finalRush');
    expect(sim.world.baby.state).toBe('carried');
  });

  it('lets a phone that is already ringing go on ringing', async () => {
    const sim = await newSim({ phone: true });
    runTo(sim, 1000);
    expect(sim.world.disruptions[0]?.state).toBe('ringing');
    const events = runTo(sim, RUSH_AT);
    expect(of(events, 'PhoneRingEnded').every((event) => event.reason === 'timedOut')).toBe(true);
    expect(sim.world.flow.state).toBe('finalRush');
  });
});

describe('the rush ends on the photo (AC 4)', () => {
  it('goes to photo at durationMs with LevelEnded{timer} and LevelScored in that same step', async () => {
    const sim = await newSim();
    runTo(sim, DURATION_MS - STEP_MS);
    sim.drainEvents();
    sim.step();
    const events = sim.drainEvents();
    expect(sim.world.flow).toEqual({
      state: 'photo',
      enteredAt: DURATION_MS,
      finalRushAt: RUSH_AT,
    });
    expect(events.map((event) => event.type)).toEqual(['LevelEnded', 'LevelScored']);
    expect(events[0]).toEqual({ type: 'LevelEnded', t: DURATION_MS, reason: 'timer' });
    expect(isFlowLive(worldOf(sim))).toBe(false);
    expect(sim.world.score.final).not.toBeNull();
  });

  it('is frozen like ended: the clock goes on, commands are dropped, nothing else moves', async () => {
    const sim = await newSim();
    runTo(sim, DURATION_MS);
    sim.drainEvents();
    const frozen = JSON.stringify({ ...sim.world, time: null });
    sim.enqueue({ type: 'TapFloor', t: asSimMs(sim.world.time.sim), xM: 0, zM: 0 });
    stepN(sim, 100);
    expect(sim.drainEvents().filter((event) => event.type !== 'TimeScaleChanged')).toEqual([]);
    expect(JSON.stringify({ ...sim.world, time: null })).toBe(frozen);
    expect(sim.world.time.sim).toBeGreaterThan(DURATION_MS);
  });
});

describe('the other ends in the rush (AC 5)', () => {
  it('lets the noise wake Mama in the rush: MamaWoke, LevelEnded{mamaWoke}, ended, finalRushAt kept', async () => {
    const sim = await newSim({ noise: true });
    runTo(sim, RUSH_AT + 1000);
    expect(sim.world.flow.state).toBe('finalRush');
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: 100 });
    sim.step();
    const events = sim.drainEvents();
    const t = sim.world.time.sim;
    expect(events.map((event) => event.type)).toEqual([
      'NoiseChanged',
      'MamaWoke',
      'LevelEnded',
      'LevelScored',
    ]);
    expect(sim.world.flow).toEqual({ state: 'ended', enteredAt: t, finalRushAt: RUSH_AT });
    expect(of(events, 'LevelEnded')[0]).toEqual({ type: 'LevelEnded', t, reason: 'mamaWoke' });
  });

  it('refuses to start a sequence in the rush, with its own reason', async () => {
    const sim = await newSim({ sequences: ['stay_awake'], carry: true });
    runTo(sim, RUSH_AT);
    expect(sequenceRefusal(worldOf(sim))).toBe('finalRush');
    sim.enqueue({
      type: 'StartSequence',
      t: asSimMs(sim.world.time.sim),
      sequenceId: 'stay_awake',
    });
    sim.step();
    expect(sim.world.flow.state).toBe('finalRush');
    expect(of(sim.drainEvents(), 'SequenceStarted')).toEqual([]);
  });
});

describe('what stops in the rush (AC 6)', () => {
  it('keeps the flow states apart: the `=== playing` rules do not see the rush', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    enterFlowState(world, 'finalRush');
    expect(isFlowLive(world)).toBe(true);
    enterFlowState(world, 'photo');
    expect(isFlowLive(world)).toBe(false);
  });
});

describe('the playable time (AC 21)', () => {
  it('takes the rush off a level that has one, and nothing off the others', () => {
    const feel = FEEL.endOfLevel;
    expect(playableMsOf(DURATION_MS, FINAL_RUSH, feel)).toBe(DURATION_MS - feel.finalRushMs);
    expect(playableMsOf(DURATION_MS, undefined, feel)).toBe(DURATION_MS);
  });
});

describe('the rush in a snapshot (AC 23)', () => {
  const roundTrip = (sim: Sim) => JSON.parse(JSON.stringify(sim.snapshot()));
  const damaged = async (flow: Record<string, unknown>, options: Options = {}) => {
    const sim = await newSim(options);
    runTo(sim, RUSH_AT + 500);
    const snapshot = roundTrip(sim);
    Object.assign(snapshot.world.flow, flow);
    return { sim: await newSim(options), snapshot };
  };

  it('round-trips in the middle of a rush, and goes on to the same photo', async () => {
    const sim = await newSim();
    runTo(sim, RUSH_AT + 500);
    const twin = await newSim();
    twin.restore(roundTrip(sim));
    expect(twin.world.flow).toEqual(sim.world.flow);
    runTo(sim, DURATION_MS);
    runTo(twin, DURATION_MS);
    expect(twin.world.flow).toEqual({
      state: 'photo',
      enteredAt: DURATION_MS,
      finalRushAt: RUSH_AT,
    });
    expect(twin.world).toEqual(sim.world);
  });

  it('refuses a rush state in a level with no rush', async () => {
    const plain = await newSim({ finalRush: false });
    runTo(plain, 1000);
    for (const flow of [
      { state: 'finalRush', finalRushAt: 500 },
      { state: 'playing', finalRushAt: 500 },
    ]) {
      const snapshot = roundTrip(plain);
      Object.assign(snapshot.world.flow, flow);
      expect(() => plain.restore(snapshot), JSON.stringify(flow)).toThrow(/world\.flow/);
    }
  });

  it('refuses finalRushAt in the future, negative, or set while playing', async () => {
    for (const change of [
      { finalRushAt: 1e9 },
      { finalRushAt: -1 },
      { finalRushAt: 'now' },
      { state: 'playing' as const },
      { finalRushAt: null },
    ]) {
      const { sim, snapshot } = await damaged(change);
      expect(() => sim.restore(snapshot), JSON.stringify(change)).toThrow(/world\.flow/);
    }
  });

  it('refuses a photo before the time is up', async () => {
    const { sim, snapshot } = await damaged({ state: 'photo' });
    expect(() => sim.restore(snapshot)).toThrow(/world\.flow\.state/);
  });

  it('accepts a photo at the end, and an ended Mama in the rush', async () => {
    const sim = await newSim();
    runTo(sim, DURATION_MS);
    const twin = await newSim();
    expect(() => twin.restore(roundTrip(sim))).not.toThrow();
    const noisy = await newSim({ noise: true });
    runTo(noisy, RUSH_AT + 500);
    noisy.enqueue({ type: 'SetNoise', t: asSimMs(noisy.world.time.sim), pct: 100 });
    noisy.step();
    expect(noisy.world.flow.state).toBe('ended');
    const other = await newSim({ noise: true });
    expect(() => other.restore(roundTrip(noisy))).not.toThrow();
    expect(other.world.flow.finalRushAt).toBe(RUSH_AT);
  });
});

describe('finalRushProblems (AC 2, AC 30)', () => {
  const feel = FEEL.endOfLevel;
  const room = (patch: Partial<FinalRushRoom> = {}): FinalRushRoom => ({
    anchors: [
      { id: 'coffee_table', positionM: [0.5, 0.45, -0.6] },
      { id: 'door', positionM: [2.9, 0, -2.8] },
    ],
    props: [
      { id: 'toy_01', kind: 'toy', centerM: [0.5, 0.5, -0.38] },
      { id: 'book_01', kind: 'book', centerM: [0.25, 0.47, -0.6] },
      { id: 'mug_01', kind: 'mug', centerM: [0.7, 0.5, -0.6] },
    ],
    kinds: { toy: { breakable: false }, book: { breakable: false }, mug: { breakable: true } },
    propReachDistM: 0.5,
    ...patch,
  });

  it('accepts a level that outlasts the rush, names one of its anchors and holds enough props to spill', () => {
    expect(finalRushProblems(FINAL_RUSH, DURATION_MS, feel, room())).toEqual([]);
  });

  it('refuses a level that does not outlast the rush, at the limit included', () => {
    const [problem] = finalRushProblems(FINAL_RUSH, feel.finalRushMs, feel, room());
    expect(problem).toContain(`${feel.finalRushMs} ms`);
    expect(finalRushProblems(FINAL_RUSH, feel.finalRushMs + 1, feel, room())).toEqual([]);
  });

  it('refuses a spill anchor that is not an anchor of the level', () => {
    expect(finalRushProblems({ spillAnchor: 'nowhere' }, DURATION_MS, feel, room())).toEqual([
      'the spill anchor "nowhere" is not an anchor of the level',
    ]);
  });

  it('refuses a room with fewer props that can spill than doorSpillCount: breakable, or out of reach', () => {
    const noBook = room({ props: room().props.filter((prop) => prop.id !== 'book_01') });
    expect(finalRushProblems(FINAL_RUSH, DURATION_MS, feel, noBook)).toEqual([
      expect.stringContaining('only 1 unbreakable prop(s) stand within 0.5 m of "coffee_table"'),
    ]);
    const far = room({ propReachDistM: 0.1 });
    expect(finalRushProblems(FINAL_RUSH, DURATION_MS, feel, far)).toEqual([
      expect.stringContaining('only 0 unbreakable prop(s)'),
    ]);
    // A kind the feel does not know cannot be told breakable: it does not count.
    const unknown = room({ kinds: { toy: { breakable: false } } });
    expect(finalRushProblems(FINAL_RUSH, DURATION_MS, feel, unknown)).toHaveLength(1);
  });

  it('asks nothing of the room when the door spills nothing (doorSpillCount 0)', () => {
    const none = { ...feel, doorSpillCount: 0 };
    expect(finalRushProblems(FINAL_RUSH, DURATION_MS, none, room({ props: [] }))).toEqual([]);
  });

  it('is what createSim throws on, with the same words', async () => {
    const content = createTestContent();
    content.feel.endOfLevel.doorSpillCount = 0;
    const level = createTestLevel({ durationMs: feel.finalRushMs, finalRush: FINAL_RUSH });
    await expect(
      createSim({ content, geometry: createTestGeometry(), level, seed: 1 }),
    ).rejects.toThrow(/finalRush: the level lasts/);
    // The frozen room's props are all breakable: the door has nothing to spill.
    const spilling = createTestContent();
    await expect(
      createSim({
        content: spilling,
        geometry: createTestGeometry(),
        level: createTestLevel({ durationMs: DURATION_MS, finalRush: FINAL_RUSH }),
        seed: 1,
      }),
    ).rejects.toThrow(/the door spills 2 props .* but only 0 unbreakable prop\(s\)/);
  });
});
