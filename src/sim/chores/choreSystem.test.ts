import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  COFFEE_TABLE,
  createTestContent,
  createTestCooking,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  TEST_COOKING,
  TEST_OBJECTS,
  TEST_STOVE,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { CHORE_BEAT_STATES, CHORE_STATES, CHORE_STATES_ARE_COMPLETE } from './choreFsm.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const { windowMs, toleranceMs, perfectMs, bufferMs } = content.feel.timing;
const HALF_MS = windowMs / 2;

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;
type OfType<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

interface Options {
  durationMs?: number;
  waves?: ReturnType<typeof testWave>[];
  carry?: boolean;
  chores?: boolean;
  lagMs?: number;
}

async function newSim(options: Options = {}): Promise<Sim> {
  const sim = await createSim({
    content,
    geometry,
    level: createTestLevel({
      waves: options.waves ?? [],
      objects: options.chores === false ? TEST_OBJECTS : [...TEST_OBJECTS, TEST_STOVE],
      ...(options.chores === false ? {} : { chores: [TEST_COOKING] }),
      ...(options.carry === true ? { carry: CARRY } : {}),
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    }),
    seed: 1,
  });
  if (options.lagMs !== undefined) tell(sim, { type: 'SetInputLag', lagMs: options.lagMs });
  return sim;
}

/** Enqueues `cmd` at `t` (the sim's current time by default). */
function tell(sim: Sim, cmd: DistributiveOmit<SimCommand, 't'>, t?: number): void {
  sim.enqueue({ ...cmd, t: asSimMs(t ?? sim.world.time.sim) } as SimCommand);
}

/** Steps `n` times and returns the events, in order. */
function stepEvents(sim: Sim, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Steps until an event of `type` is emitted (included), or fails after `limitMs`. */
function runUntilEvent(sim: Sim, type: SimEvent['type'], limitMs = 40_000): SimEvent[] {
  const events: SimEvent[] = [];
  const startMs = sim.world.time.sim;
  while (sim.world.time.sim - startMs < limitMs) {
    sim.step();
    const stepped = [...sim.drainEvents()];
    events.push(...stepped);
    if (stepped.some((event) => event.type === type)) return events;
  }
  throw new Error(`no ${type} within ${limitMs} ms`);
}

const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): OfType<T>[] =>
  events.filter((event): event is OfType<T> => event.type === type);

/** Taps the stove and steps until Papa works there; returns the events. */
function startCooking(sim: Sim): SimEvent[] {
  tell(sim, { type: 'TapObject', objectId: 'stove' });
  return runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
}

/** The window's centre of the beat announced now. */
const centreOf = (sim: Sim): number =>
  sim.world.chores[0]!.beatWindowOpenAt + sim.world.chores[0]!.responseWindow.windowMs / 2;

/** Taps the stove with the sim's clock at `t` and steps once past it. Returns the events. */
function tapStoveAt(sim: Sim, t: number): SimEvent[] {
  tell(sim, { type: 'TapObject', objectId: 'stove' }, t);
  const events: SimEvent[] = [];
  const untilMs = Math.ceil(t / 10) * 10 + 10;
  while (sim.world.time.sim < untilMs) events.push(...stepEvents(sim, 1));
  return events;
}

describe('the chore states', () => {
  it('lists every state, proved complete at compile time', () => {
    expect([...CHORE_STATES]).toEqual(['untouched', 'working', 'paused', 'done']);
    expect([...CHORE_BEAT_STATES]).toEqual(['none', 'telegraph', 'held']);
    expect(CHORE_STATES_ARE_COMPLETE).toBe(true);
  });
});

describe('starting a chore (story 9.4, AC 3)', () => {
  it('gives a level without station no chore and runs nothing', async () => {
    const sim = await newSim({ chores: false });
    expect(sim.world.chores).toEqual([]);
    expect(sim.chores).toEqual([]);
  });

  it('plans one untouched chore per entry, index-aligned with the level', async () => {
    const sim = await newSim();
    expect(sim.chores.map((chore) => chore.objectId)).toEqual(['stove']);
    expect(sim.world.chores).toEqual([
      {
        state: 'untouched',
        enteredAt: 0,
        beatsDone: 0,
        beatState: 'none',
        beatTelegraphAt: 0,
        beatWindowOpenAt: 0,
        responseWindow: { windowMs: 0, perfectMs: 0, toleranceMs: 0, bufferMs: 0 },
        beatsMissed: 0,
        isOpen: false,
      },
    ]);
  });

  it('glides Papa to the station, then works there and announces the first beat on arrival', async () => {
    const sim = await newSim();
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    const events = runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
    const [tapped] = only(events, 'ObjectTapped');
    expect(tapped).toMatchObject({ objectId: 'stove' });
    const [glide] = only(events, 'PapaGlideStarted');
    expect(glide?.threatId).toBeNull();
    const arrived = only(events, 'PapaArrived')[0]!;
    const [announced] = only(events, 'ChoreBeatTelegraphed');
    // The chore starts at the step Papa arrives, and the window opens a full `telegraphDelayMs` later.
    expect(announced).toMatchObject({ t: arrived.t, choreIndex: 0, beatIndex: 0 });
    expect(announced?.windowOpenAt).toBe(arrived.t + 2000);
    expect(sim.world.papa.state).toBe('chore');
    expect(sim.world.papa.busyUntil).toBe(0);
    expect(sim.world.papa.objectId).toBeNull();
    expect(sim.world.chores[0]).toMatchObject({
      state: 'working',
      beatsDone: 0,
      beatState: 'telegraph',
      beatTelegraphAt: arrived.t,
      beatWindowOpenAt: arrived.t + 2000,
      responseWindow: { windowMs, perfectMs, toleranceMs, bufferMs },
    });
  });

  it('refuses the tap at once while the baby is carried: Papa goes nowhere', async () => {
    const sim = await newSim({ carry: true });
    tell(sim, { type: 'TapBaby' });
    runUntilEvent(sim, 'BabyPickedUp', 10_000);
    sim.drainEvents();
    const { xM, zM } = sim.world.papa;
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    const events = stepEvents(sim, 3);
    expect(only(events, 'ChoreRefused')).toEqual([
      { type: 'ChoreRefused', t: expect.any(Number), objectId: 'stove', reason: 'carrying' },
    ]);
    expect(only(events, 'PapaGlideStarted')).toEqual([]);
    expect(only(events, 'ObjectTapped')).toEqual([]);
    expect(sim.world.papa).toMatchObject({ xM, zM, state: 'idle' });
    expect(sim.world.chores[0]?.state).toBe('untouched');
  });
});

describe('judging a beat (AC 4)', () => {
  /** A sim at the first beat of a started cooking, and the instant of its window's centre. */
  async function atFirstBeat(options: Options = {}) {
    const sim = await newSim(options);
    startCooking(sim);
    return { sim, centre: centreOf(sim) };
  }

  it.each([
    ['at the centre', 0, 'perfect'],
    ['at the edge of the perfect zone', perfectMs / 2, 'perfect'],
    ['just past the perfect zone', perfectMs / 2 + 10, 'success'],
    ['at the end of the window plus its tolerance', HALF_MS + toleranceMs - 10, 'success'],
    ['before the window, inside the buffer', -(HALF_MS + toleranceMs + bufferMs) + 10, 'success'],
  ] as const)(
    'catches the beat %s (%i ms from the centre) as %s',
    async (_label, offset, quality) => {
      const { sim, centre } = await atFirstBeat();
      const events = tapStoveAt(sim, centre + offset);
      const [judged] = only(events, 'ChoreBeatJudged');
      expect(judged).toMatchObject({ choreIndex: 0, beatIndex: 0, quality, reason: null });
      expect(judged?.offsetMs).toBe(offset);
      expect(sim.world.chores[0]?.beatsDone).toBe(1);
      // The next beat is announced in the same step.
      expect(only(events, 'ChoreBeatTelegraphed')[0]).toMatchObject({ beatIndex: 1 });
    },
  );

  it('misses a tap after the window and its tolerance (late): the same beat is announced again', async () => {
    const { sim, centre } = await atFirstBeat();
    const events = tapStoveAt(sim, centre + HALF_MS + toleranceMs + 10);
    expect(only(events, 'ChoreBeatJudged')).toEqual([
      {
        type: 'ChoreBeatJudged',
        t: expect.any(Number),
        choreIndex: 0,
        beatIndex: 0,
        quality: 'fail',
        reason: 'late',
        offsetMs: HALF_MS + toleranceMs + 10,
      },
    ]);
    expect(sim.world.chores[0]?.beatsDone).toBe(0);
    expect(only(events, 'ChoreBeatTelegraphed')[0]).toMatchObject({ beatIndex: 0 });
    // A full `telegraphDelayMs` again: the beat did not advance.
    const again = sim.world.chores[0]!;
    expect(again.beatWindowOpenAt - again.beatTelegraphAt).toBe(2000);
  });

  it('misses a tap far too early under earlyPress "fail"', async () => {
    const { sim, centre } = await atFirstBeat();
    const early = centre - (HALF_MS + toleranceMs + bufferMs) - 10;
    const events = tapStoveAt(sim, early);
    expect(only(events, 'ChoreBeatJudged')[0]).toMatchObject({ quality: 'fail', reason: 'early' });
    expect(sim.world.chores[0]?.beatsDone).toBe(0);
  });

  it('ignores a tap far too early under earlyPress "guard": the beat stays announced', async () => {
    const guarded = {
      ...content,
      feel: { ...content.feel, input: { ...content.feel.input, earlyPress: 'guard' as const } },
    };
    const sim = await createSim({
      content: guarded,
      geometry,
      level: createTestLevel({ objects: [...TEST_OBJECTS, TEST_STOVE], chores: [TEST_COOKING] }),
      seed: 1,
    });
    startCooking(sim);
    const announcedAt = sim.world.chores[0]!.beatTelegraphAt;
    const early = centreOf(sim) - (HALF_MS + toleranceMs + bufferMs) - 10;
    const events = tapStoveAt(sim, early);
    expect(only(events, 'ChoreBeatJudged')).toEqual([]);
    expect(sim.world.chores[0]).toMatchObject({
      beatState: 'telegraph',
      beatTelegraphAt: announcedAt,
    });
    // The tap was the beat's, not a walk: Papa still works.
    expect(sim.world.papa.state).toBe('chore');
    // And a new press in the window counts.
    const caught = tapStoveAt(sim, centreOf(sim));
    expect(only(caught, 'ChoreBeatJudged')[0]).toMatchObject({ quality: 'perfect' });
  });

  it('judges on the command’s own t, whatever step it reaches the sim in', async () => {
    const { sim, centre } = await atFirstBeat();
    // Enqueued well after its `t`: it is applied at the next step, judged at `centre`.
    while (sim.world.time.sim < centre + 100) stepEvents(sim, 1);
    tell(sim, { type: 'TapObject', objectId: 'stove' }, centre);
    const events = stepEvents(sim, 2);
    expect(only(events, 'ChoreBeatJudged')[0]).toMatchObject({ quality: 'perfect', offsetMs: 0 });
  });

  it('drops a tap stamped before the beat was announced: neither a catch nor an early miss', async () => {
    const { sim } = await atFirstBeat();
    const announcedAt = sim.world.chores[0]!.beatTelegraphAt;
    const windowOpenAt = sim.world.chores[0]!.beatWindowOpenAt;
    // Made while Papa still glided, reaches the sim after the beat was announced.
    tell(sim, { type: 'TapObject', objectId: 'stove' }, announcedAt - 5);
    const events = stepEvents(sim, 2);
    expect(only(events, 'ChoreBeatJudged')).toEqual([]);
    expect(only(events, 'CatastropheChanged')).toEqual([]);
    expect(sim.world.chores[0]).toMatchObject({
      beatsDone: 0,
      beatState: 'telegraph',
      beatTelegraphAt: announcedAt,
      beatWindowOpenAt: windowOpenAt,
    });
    // The tap is gone, not queued for later: Papa does not walk to the stove he works at either.
    expect(sim.world.papa.state).toBe('chore');
  });

  it('judges a tap stamped at the very instant of the announcement', async () => {
    const { sim } = await atFirstBeat();
    const announcedAt = sim.world.chores[0]!.beatTelegraphAt;
    const events = tapStoveAt(sim, announcedAt);
    expect(only(events, 'ChoreBeatJudged')).toMatchObject([{ quality: 'fail', reason: 'early' }]);
  });

  it('judges at most one beat per step: two taps in the same step catch one beat, not two', async () => {
    const { sim, centre } = await atFirstBeat();
    tell(sim, { type: 'TapObject', objectId: 'stove' }, centre);
    tell(sim, { type: 'TapObject', objectId: 'stove' }, centre);
    const events: SimEvent[] = [];
    while (sim.world.time.sim < centre + 30) events.push(...stepEvents(sim, 1));
    expect(only(events, 'ChoreBeatJudged')).toHaveLength(1);
    expect(sim.world.chores[0]?.beatsDone).toBe(1);
    // The extra tap did not walk Papa anywhere.
    expect(only(events, 'ObjectTapped')).toEqual([]);
    expect(sim.world.papa.state).toBe('chore');
  });

  it('misses by itself when nobody taps: no tap by close + lag is a late miss with no offset', async () => {
    const { sim } = await atFirstBeat();
    const { beatWindowOpenAt, responseWindow } = sim.world.chores[0]!;
    const closeAt = beatWindowOpenAt + responseWindow.windowMs + responseWindow.toleranceMs;
    const events: SimEvent[] = [];
    while (sim.world.time.sim < closeAt + 30) events.push(...stepEvents(sim, 1));
    // The first step strictly after the close judges, and not one before it.
    const [missed] = only(events, 'ChoreBeatJudged');
    expect(missed).toMatchObject({ quality: 'fail', reason: 'late', offsetMs: null });
    expect(missed?.t).toBe(Math.floor(closeAt / 10) * 10 + 10);
    expect(only(events, 'ChoreBeatTelegraphed').at(-1)).toMatchObject({
      beatIndex: 0,
      t: missed?.t,
    });
  });

  it('waits input.lagMs more before concluding that nobody tapped', async () => {
    const { sim } = await atFirstBeat({ lagMs: 200 });
    const { beatWindowOpenAt, responseWindow } = sim.world.chores[0]!;
    const closeAt = beatWindowOpenAt + responseWindow.windowMs + responseWindow.toleranceMs;
    const events: SimEvent[] = [];
    while (sim.world.time.sim < closeAt + 230) events.push(...stepEvents(sim, 1));
    const [missed] = only(events, 'ChoreBeatJudged');
    expect(only(events, 'ChoreBeatJudged')).toHaveLength(1);
    expect(missed?.t).toBe(Math.floor((closeAt + 200) / 10) * 10 + 10);
  });

  it('keeps counting beats for Rire and nothing else: no combo, no hitstop', async () => {
    const { sim, centre } = await atFirstBeat();
    expect(sim.world.score).toMatchObject({ perfects: 0, successes: 0 });
    const events = tapStoveAt(sim, centre);
    expect(sim.world.score).toMatchObject({ perfects: 1, successes: 0 });
    expect(sim.freezeRealMs).toBe(0);
    expect(only(events, 'ComboChanged')).toEqual([]);
    expect(sim.world.time.slowMos).toEqual([]);
    const next = centreOf(sim);
    tapStoveAt(sim, next + 60);
    expect(sim.world.score).toMatchObject({ perfects: 1, successes: 1 });
  });
});

describe('the beat’s window is frozen at its announcement (AC 4)', () => {
  const tiered = async (tier: 'assistance' | 'normal' | 'experienced') => {
    const sim = await newSim();
    tell(sim, { type: 'SetDifficultyTier', tier });
    startCooking(sim);
    return sim;
  };

  it.each([
    ['assistance', 1.5],
    ['normal', 1],
    ['experienced', 0.75],
  ] as const)('opens a %s beat with the tier’s window (x%s)', async (tier, multiplier) => {
    const sim = await tiered(tier);
    expect(sim.world.chores[0]!.responseWindow.windowMs).toBeCloseTo(windowMs * multiplier, 9);
  });

  it('uses the chore’s own windowMs instead of the feel’s when it has one', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({
        objects: [...TEST_OBJECTS, TEST_STOVE],
        chores: [TEST_COOKING],
        choreDefs: { cooking: { ...createTestCooking(), windowMs: 500 } },
      }),
      seed: 1,
    });
    startCooking(sim);
    expect(sim.world.chores[0]!.responseWindow.windowMs).toBe(500);
  });

  it('keeps the window it announced when the tier or the feel change afterwards', async () => {
    const sim = await tiered('normal');
    const frozen = { ...sim.world.chores[0]!.responseWindow };
    tell(sim, { type: 'SetDifficultyTier', tier: 'assistance' });
    tell(sim, { type: 'SetFeel', patch: { timing: { windowMs: windowMs * 2 } } });
    stepEvents(sim, 5);
    expect(sim.world.chores[0]!.beatState).toBe('telegraph');
    expect(sim.world.chores[0]!.responseWindow).toEqual(frozen);
    // Judged by the frozen window: a tap 5 ms after it closed is late (it would be a success if the
    // window had widened with the new tier and feel).
    const closeAt = sim.world.chores[0]!.beatWindowOpenAt + frozen.windowMs + frozen.toleranceMs;
    const events = tapStoveAt(sim, closeAt + 5);
    expect(only(events, 'ChoreBeatJudged')).toMatchObject([{ quality: 'fail', reason: 'late' }]);
  });

  it('announces the next beat with the tier of that moment', async () => {
    const sim = await tiered('normal');
    tell(sim, { type: 'SetDifficultyTier', tier: 'experienced' });
    stepEvents(sim, 1);
    tapStoveAt(sim, centreOf(sim));
    expect(sim.world.chores[0]!.responseWindow.windowMs).toBeCloseTo(windowMs * 0.75, 9);
  });
});

describe('leaving and resuming (AC 6)', () => {
  async function afterOneBeat() {
    const sim = await newSim();
    startCooking(sim);
    tapStoveAt(sim, centreOf(sim));
    return sim;
  }

  it.each([
    ['a tap on the floor', { type: 'TapFloor', xM: 0, zM: 0 }],
    ['a move', { type: 'Move', dirX: 1, dirZ: 0 }],
    ['a tap on another object', { type: 'TapObject', objectId: 'phone' }],
  ] as const)(
    '%s pauses the chore, keeping the beats done, with no judgement',
    async (_label, cmd) => {
      const sim = await afterOneBeat();
      tell(sim, cmd);
      const events = stepEvents(sim, 3);
      expect(sim.world.papa.state).not.toBe('chore');
      expect(sim.world.chores[0]).toMatchObject({
        state: 'paused',
        beatsDone: 1,
        beatState: 'none',
        beatTelegraphAt: 0,
        beatWindowOpenAt: 0,
      });
      expect(only(events, 'ChoreBeatJudged')).toEqual([]);
      expect(only(events, 'ChoreCompleted')).toEqual([]);
    },
  );

  it('is paused by taking the baby, whose tap does not move Papa', async () => {
    const sim = await newSim({ carry: true });
    startCooking(sim);
    tell(sim, { type: 'TapBaby' });
    stepEvents(sim, 3);
    // The baby is far: Papa walks to him, which leaves the stove.
    expect(sim.world.papa.state).not.toBe('chore');
    expect(sim.world.chores[0]?.state).toBe('paused');
  });

  it.each([
    ['a tap on the floor', { type: 'TapFloor', xM: 0, zM: 0 }],
    ['a move', { type: 'Move', dirX: 1, dirZ: 0 }],
    ['a tap on another object', { type: 'TapObject', objectId: 'phone' }],
  ] as const)(
    '%s pauses the chore in the very step Papa leaves, so that a snapshot of that step restores',
    async (_label, cmd) => {
      const sim = await afterOneBeat();
      tell(sim, cmd);
      stepEvents(sim, 1);
      expect(sim.world.papa.state).not.toBe('chore');
      expect(sim.world.chores[0]).toMatchObject({
        state: 'paused',
        beatsDone: 1,
        beatState: 'none',
      });
      const snapshot = JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
      expect(() => sim.restore(snapshot)).not.toThrow();
      expect(sim.world.chores[0]?.state).toBe('paused');
    },
  );

  it('is paused in the step a press on a threat makes Papa glide away, and that step restores', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET], { fromMs: 500_000 })] });
    startCooking(sim);
    const threatId = sim.world.threats[0]!.id;
    tell(sim, { type: 'ForceThreat', threatId });
    stepEvents(sim, 2);
    const { windowOpenAt, responseWindow } = sim.world.threats[0]!;
    const pressAt = windowOpenAt + (responseWindow?.windowMs ?? 0) / 2;
    tell(sim, { type: 'PressThreat', threatId }, pressAt);
    while (sim.world.papa.state === 'chore') stepEvents(sim, 1);
    expect(sim.world.chores[0]?.state).toBe('paused');
    const snapshot = JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
    expect(() => sim.restore(snapshot)).not.toThrow();
  });

  it('is paused by taking the baby when he is within reach: Papa does not move, he is set idle', async () => {
    const sim = await newSim({ carry: true });
    startCooking(sim);
    const { baby, papa } = sim.world;
    // The baby crawls up to the stove (set from outside, the test's own arrangement).
    baby.xM = papa.xM;
    baby.zM = papa.zM;
    const [xM, zM] = [papa.xM, papa.zM];
    tell(sim, { type: 'TapBaby' });
    const events = stepEvents(sim, 1);
    expect(sim.world.baby.state).toBe('carried');
    expect(sim.world.papa.state).toBe('idle');
    expect([sim.world.papa.xM, sim.world.papa.zM]).toEqual([xM, zM]);
    expect(sim.world.chores[0]).toMatchObject({ state: 'paused', beatState: 'none' });
    expect(only(events, 'ChoreBeatJudged')).toEqual([]);
    const snapshot = JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
    expect(() => sim.restore(snapshot)).not.toThrow();
  });

  it('is paused by a séquelle that occupies Papa: the gag of an unanswered threat', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET], { fromMs: 500_000 })] });
    startCooking(sim);
    tell(sim, { type: 'ForceThreat', threatId: sim.world.threats[0]!.id });
    const events = runUntilEvent(sim, 'GagTriggered', 10_000);
    expect(only(events, 'GagTriggered')).toHaveLength(1);
    expect(sim.world.papa.state).toBe('electrified');
    expect(sim.world.chores[0]).toMatchObject({ state: 'paused', beatState: 'none' });
    expect(only(events, 'ChoreBeatJudged')).toEqual([]);
  });

  it('is paused when a special sequence starts: Papa is set idle where he stands', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({
        gauges: { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
        carry: CARRY,
        objects: [...TEST_OBJECTS, TEST_STOVE],
        chores: [TEST_COOKING],
        sequences: ['stay_awake'],
      }),
      seed: 1,
    });
    startCooking(sim);
    expect(sim.world.papa.state).toBe('chore');
    tell(sim, { type: 'StartSequence', sequenceId: 'stay_awake' });
    stepEvents(sim, 2);
    expect(sim.world.flow.state).toBe('sequence');
    expect(sim.world.papa.state).toBe('idle');
    expect(sim.world.chores[0]).toMatchObject({ state: 'paused', beatState: 'none' });
    const snapshot = JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
    expect(() => sim.restore(snapshot)).not.toThrow();
  });

  it('is paused by a press on a threat, which is never refused', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET], { fromMs: 500_000 })] });
    startCooking(sim);
    const threatId = sim.world.threats[0]!.id;
    tell(sim, { type: 'ForceThreat', threatId });
    stepEvents(sim, 2);
    const { windowOpenAt, responseWindow } = sim.world.threats[0]!;
    const pressAt = windowOpenAt + (responseWindow?.windowMs ?? 0) / 2;
    tell(sim, { type: 'PressThreat', threatId }, pressAt);
    tell(sim, { type: 'Release' }, pressAt + 20);
    const events: SimEvent[] = [];
    while (sim.world.time.sim < pressAt + 50) events.push(...stepEvents(sim, 1));
    expect(only(events, 'TapRefused')).toEqual([]);
    expect(only(events, 'ResponseResolved')[0]).toMatchObject({ quality: 'perfect' });
    expect(
      only(events, 'PapaGlideStarted').filter((event) => event.threatId === threatId),
    ).toHaveLength(1);
    expect(sim.world.chores[0]?.state).toBe('paused');
  });

  it('resumes at the first beat not done on the next tap on the station', async () => {
    const sim = await afterOneBeat();
    tell(sim, { type: 'TapFloor', xM: 2.5, zM: 1.5 });
    stepEvents(sim, 5);
    expect(sim.world.chores[0]?.state).toBe('paused');
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    const events = runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
    expect(only(events, 'ChoreBeatTelegraphed')[0]).toMatchObject({ beatIndex: 1 });
    expect(sim.world.chores[0]).toMatchObject({ state: 'working', beatsDone: 1 });
    expect(sim.world.papa.state).toBe('chore');
  });

  it('sets Papa idle and pauses a chore he still works at when a sequence starts or the baby is carried', async () => {
    const sim = await newSim({ carry: true });
    startCooking(sim);
    // Forced from outside (a helper that left Papa in `chore` with the baby in his arms).
    (sim.world as { baby: { state: string } }).baby.state = 'carried';
    stepEvents(sim, 1);
    expect(sim.world.papa.state).toBe('idle');
    expect(sim.world.chores[0]?.state).toBe('paused');
  });
});

describe('a threat’s window holds the beat (AC 7)', () => {
  const waves = [testWave([COFFEE_TABLE], { fromMs: 500_000 })];

  it('withdraws the beat while a window is open and announces it again, in full, after it', async () => {
    const sim = await newSim({ waves });
    startCooking(sim);
    const threat = sim.world.threats[0]!;
    tell(sim, { type: 'ForceThreat', threatId: threat.id });
    const events: SimEvent[] = [];
    while (sim.world.threats[0]!.state !== 'windowOpen') events.push(...stepEvents(sim, 1));
    expect(sim.world.chores[0]).toMatchObject({
      state: 'working',
      beatState: 'held',
      beatTelegraphAt: 0,
      beatWindowOpenAt: 0,
    });
    // Nothing was judged: the beat was withdrawn, not missed.
    expect(only(events, 'ChoreBeatJudged')).toEqual([]);
    expect(sim.world.papa.state).toBe('chore');
    // The threat's window closes unanswered; the beat is announced again that very step.
    const after: SimEvent[] = [];
    while (sim.world.chores[0]!.beatState === 'held') after.push(...stepEvents(sim, 1));
    const [announced] = only(after, 'ChoreBeatTelegraphed');
    expect(announced).toMatchObject({ beatIndex: 0 });
    expect(announced!.windowOpenAt - announced!.t).toBe(2000);
    expect(sim.world.threats[0]!.state).not.toBe('windowOpen');
  });

  it('starts held when Papa arrives while a window is open', async () => {
    const sim = await newSim({ waves });
    const threatId = sim.world.threats[0]!.id;
    tell(sim, { type: 'ForceThreat', threatId });
    // The threat's window opens 1500 ms after it is forced and Papa glides for about 600 ms: tapping
    // the stove 900 ms in lands him at the stove just as the window opens.
    stepEvents(sim, 90);
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    const events: SimEvent[] = [];
    while (sim.world.papa.state !== 'chore') events.push(...stepEvents(sim, 1));
    // The precondition of the test, asserted rather than assumed.
    expect(sim.world.threats[0]!.state).toBe('windowOpen');
    expect(sim.world.chores[0]).toMatchObject({
      state: 'working',
      beatState: 'held',
      beatTelegraphAt: 0,
      beatWindowOpenAt: 0,
    });
    expect(only(events, 'ChoreBeatTelegraphed')).toEqual([]);
    // After the window the beat is announced, in full.
    const after: SimEvent[] = [];
    while (sim.world.chores[0]!.beatState === 'held') after.push(...stepEvents(sim, 1));
    expect(only(after, 'ChoreBeatTelegraphed')[0]).toMatchObject({ beatIndex: 0 });
  });

  it('judges a tap made inside the beat’s window even when a threat’s window opens in the step it is applied', async () => {
    const sim = await newSim({ waves });
    startCooking(sim);
    const announcedAt = sim.world.chores[0]!.beatTelegraphAt;
    const centre = centreOf(sim);
    const threatId = sim.world.threats[0]!.id;
    // Forced 650 ms after the announcement, the threat's window opens at announcement + 2160, a step
    // after the beat's window centre (announcement + 2150).
    while (sim.world.time.sim < announcedAt + 650) stepEvents(sim, 1);
    tell(sim, { type: 'ForceThreat', threatId });
    stepEvents(sim, 1);
    const openAt = sim.world.threats[0]!.windowOpenAt;
    expect(openAt).toBe(centre + 10);
    // The tap is stamped at the centre but only applied in the step that opens the threat's window.
    while (sim.world.time.sim < openAt - 10) stepEvents(sim, 1);
    tell(sim, { type: 'TapObject', objectId: 'stove' }, centre);
    const events = stepEvents(sim, 1);
    expect(sim.world.threats[0]!.state).toBe('windowOpen');
    expect(only(events, 'ChoreBeatJudged')).toMatchObject([
      { quality: 'perfect', beatIndex: 0, offsetMs: 0 },
    ]);
    expect(sim.world.chores[0]).toMatchObject({ beatsDone: 1, beatState: 'held' });
  });

  it('ignores a tap on the station while the beat is held', async () => {
    const sim = await newSim({ waves });
    startCooking(sim);
    tell(sim, { type: 'ForceThreat', threatId: sim.world.threats[0]!.id });
    while (sim.world.threats[0]!.state !== 'windowOpen') stepEvents(sim, 1);
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    const events = stepEvents(sim, 2);
    expect(only(events, 'ChoreBeatJudged')).toEqual([]);
    expect(sim.world.papa.state).toBe('chore');
  });
});

describe('finishing a chore (AC 8)', () => {
  /** Catches every beat at the centre of its window; returns every event. */
  function finish(sim: Sim): SimEvent[] {
    const events = startCooking(sim);
    for (let beat = 0; beat < 4; beat++) events.push(...tapStoveAt(sim, centreOf(sim)));
    return events;
  }

  it('completes on the last beat: ChoreCompleted, Papa idle at the station, the station spent', async () => {
    const sim = await newSim();
    const events = finish(sim);
    expect(only(events, 'ChoreBeatJudged').map((event) => event.quality)).toEqual([
      'perfect',
      'perfect',
      'perfect',
      'perfect',
    ]);
    expect(only(events, 'ChoreCompleted')).toEqual([
      { type: 'ChoreCompleted', t: expect.any(Number), choreIndex: 0, homePoints: 7.5 },
    ]);
    // Judged first, then completed, in this order.
    const kinds = events.map((event) => event.type);
    expect(kinds.lastIndexOf('ChoreCompleted')).toBeGreaterThan(
      kinds.lastIndexOf('ChoreBeatJudged'),
    );
    expect(sim.world.chores[0]).toMatchObject({ state: 'done', beatsDone: 4, beatState: 'none' });
    expect(sim.world.papa.state).toBe('idle');
    expect(sim.world.score.perfects).toBe(4);
  });

  it('leaves a done station inert: a tap walks Papa there and starts nothing', async () => {
    const sim = await newSim();
    finish(sim);
    tell(sim, { type: 'TapFloor', xM: 2.5, zM: 1.5 });
    stepEvents(sim, 5);
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    const events = stepEvents(sim, 400);
    expect(only(events, 'ObjectTapped')).toHaveLength(1);
    expect(only(events, 'PapaGlideStarted')).toEqual([]);
    expect(only(events, 'ChoreBeatTelegraphed')).toEqual([]);
    expect(sim.world.chores[0]?.state).toBe('done');
    expect(sim.world.papa.state).toBe('idle');
  });

  it('pays the Maison row at the end of the level: 7.5 with the chore done, 0 unfinished', async () => {
    const done = await newSim({ durationMs: 40_000 });
    finish(done);
    const doneEvents: SimEvent[] = [];
    while (only(doneEvents, 'LevelScored').length === 0) doneEvents.push(...stepEvents(done, 100));
    expect(only(doneEvents, 'LevelScored')[0]?.homePoints).toBe(7.5);
    expect(done.world.score.final?.homePoints).toBe(7.5);

    const unfinished = await newSim({ durationMs: 20_000 });
    startCooking(unfinished);
    tapStoveAt(unfinished, centreOf(unfinished));
    const events: SimEvent[] = [];
    while (only(events, 'LevelScored').length === 0) events.push(...stepEvents(unfinished, 100));
    expect(only(events, 'LevelScored')[0]?.homePoints).toBe(0);
  });

  it('judges nothing once the level has ended, mid-beat, whatever is tapped afterwards', async () => {
    const sim = await newSim({ durationMs: 6_000 });
    startCooking(sim);
    const events: SimEvent[] = [];
    while (only(events, 'LevelEnded').length === 0) events.push(...stepEvents(sim, 1));
    const judgedAtEnd = only(events, 'ChoreBeatJudged').length;
    const { beatsDone } = sim.world.chores[0]!;
    // Taps on the stove, at the centre of the beat that was under way and after it: all ignored.
    const centre = centreOf(sim);
    for (const t of [centre, centre + 500, sim.world.time.sim]) {
      tell(sim, { type: 'TapObject', objectId: 'stove' }, t);
    }
    const after = stepEvents(sim, 500);
    expect(only(after, 'ChoreBeatJudged')).toEqual([]);
    expect(only(after, 'ChoreCompleted')).toEqual([]);
    expect(only(events, 'ChoreBeatJudged')).toHaveLength(judgedAtEnd);
    expect(sim.world.chores[0]!.beatsDone).toBe(beatsDone);
    expect(only(events, 'LevelScored')[0]?.homePoints).toBe(0);
  });

  it('is deterministic: the same game replays to the same world', async () => {
    const run = async () => {
      const sim = await newSim();
      finish(sim);
      stepEvents(sim, 50);
      return JSON.stringify(sim.world);
    };
    expect(await run()).toBe(await run());
  });
});

describe('the catastrophe reads the beats (AC 9)', () => {
  it('rises by risePct.choreBeat on a missed beat, source choreBeat', async () => {
    const sim = await newSim();
    startCooking(sim);
    const events: SimEvent[] = [];
    while (only(events, 'ChoreBeatJudged').length === 0) events.push(...stepEvents(sim, 10));
    const [rise] = only(events, 'CatastropheChanged');
    expect(rise).toMatchObject({
      source: 'choreBeat',
      deltaPct: content.feel.catastrophe.risePct.choreBeat,
    });
  });

  it('multiplies the rise by the tier’s catastropheMultiplier', async () => {
    const sim = await newSim();
    tell(sim, { type: 'SetDifficultyTier', tier: 'experienced' });
    startCooking(sim);
    const events: SimEvent[] = [];
    while (only(events, 'ChoreBeatJudged').length === 0) events.push(...stepEvents(sim, 10));
    const multiplier = content.feel.difficulty.experienced.catastropheMultiplier;
    expect(only(events, 'CatastropheChanged')[0]?.deltaPct).toBeCloseTo(
      content.feel.catastrophe.risePct.choreBeat * multiplier,
      9,
    );
  });

  it('lowers the gauge by perfectDropPct on a perfect beat, and not on a success', async () => {
    const sim = await newSim();
    tell(sim, { type: 'SetCatastrophe', pct: 50 });
    startCooking(sim);
    const perfect = tapStoveAt(sim, centreOf(sim));
    const drop = only(perfect, 'CatastropheChanged').find((event) => event.source === 'perfect');
    expect(drop?.deltaPct).toBeCloseTo(-content.feel.catastrophe.perfectDropPct, 9);
    const success = tapStoveAt(sim, centreOf(sim) + 60);
    expect(
      only(success, 'CatastropheChanged').filter((event) => event.source === 'perfect'),
    ).toEqual([]);
    expect(
      only(success, 'CatastropheChanged').filter((event) => event.source === 'choreBeat'),
    ).toEqual([]);
  });

  it('brings Mama home when a miss takes the gauge to 100 %', async () => {
    const sim = await newSim();
    tell(sim, { type: 'SetCatastrophe', pct: 95 });
    startCooking(sim);
    const events: SimEvent[] = [];
    while (only(events, 'LevelEnded').length === 0) events.push(...stepEvents(sim, 10));
    expect(only(events, 'LevelEnded')[0]).toMatchObject({ reason: 'mamaHome' });
  });
});
