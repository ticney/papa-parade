import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestAbandonableCooking,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestPot,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  SILENCE,
  TEST_COOKING,
  TEST_OBJECTS,
  TEST_STOVE,
  testWave,
} from '../../../tests/support/testContent.ts';
import { isSilenceUnderway } from '../baby/babyFsm.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { replayJournal } from '../replay.ts';

// The pot on the stove (story 9.5): a cooking left `paused` for `afterMs` telegraphs the threat the
// chore names (`abandonedThreat`), under the same conditions as the sim's other spawned threats. Every
// number is read from the frozen content; the frozen cooking here names its pot after SHORT_AFTER_MS so
// that a test does not play 30 s for nothing (the chore system reads the def's `afterMs`, whatever it is).

const content = createTestContent();
const geometry = createTestGeometry();
const { windowMs, toleranceMs } = content.feel.timing;
const FAIRNESS_SPACING_MS =
  content.feel.movement.glideMaxMs + content.feel.director.fairnessMarginMs;
const SHORT_AFTER_MS = 3000;
// Longer than the micro-sleep `stay_awake` may leave Papa in, so that the pot after a sequence is not
// merely waiting for him to wake (which would hide whether the sequence counted).
const SEQUENCE_AFTER_MS = 4000;
const POT = createTestPot();
const POT_DELAY_MS = POT.telegraphDelayMs ?? content.feel.timing.telegraphDelayDefaultMs;

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;
type OfType<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

interface Options {
  afterMs?: number;
  durationMs?: number;
  waves?: ReturnType<typeof testWave>[];
  noise?: boolean;
  fatigue?: boolean;
  carry?: boolean;
  sequences?: string[];
  finalRush?: boolean;
  /** The frozen cooking without its pot (9.4's world), instead of the abandonable one. */
  isPlain?: boolean;
}

async function newSim(options: Options = {}): Promise<Sim> {
  return createSim({ ...worldOf(options), seed: 1 });
}

/** The content and level of {@link newSim}, apart, for a test that replays a journal on them. */
function worldOf(options: Options = {}) {
  // `stay_awake` has a micro-sleeps step and carries the baby; the frozen room has no unbreakable prop
  // for the door to spill, so a final rush spills none.
  const hasSequence = options.sequences !== undefined;
  const levelContent = createTestContent();
  if (options.finalRush === true) levelContent.feel.endOfLevel.doorSpillCount = 0;
  return {
    content: levelContent,
    geometry,
    level: createTestLevel({
      waves: options.waves ?? [],
      objects: [...TEST_OBJECTS, TEST_STOVE],
      chores: [TEST_COOKING],
      ...(options.isPlain === true
        ? {}
        : {
            choreDefs: { cooking: createTestAbandonableCooking(options.afterMs ?? SHORT_AFTER_MS) },
          }),
      gauges: {
        ...(options.noise === true ? NOISE_GAUGES : {}),
        ...(options.fatigue === true || hasSequence ? FATIGUE_GAUGES : {}),
      },
      ...(options.carry === true || hasSequence ? { carry: CARRY } : {}),
      ...(options.sequences === undefined ? {} : { sequences: options.sequences }),
      ...(options.finalRush === true ? { finalRush: { spillAnchor: 'coffee_table' } } : {}),
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    }),
  };
}

function tell(sim: Sim, cmd: DistributiveOmit<SimCommand, 't'>, t?: number): void {
  sim.enqueue({ ...cmd, t: asSimMs(t ?? sim.world.time.sim) } as SimCommand);
}

function stepEvents(sim: Sim, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Steps until `untilSimMs`, calling `onStep` after each step with its events. */
function stepUntil(
  sim: Sim,
  untilSimMs: number,
  onStep: (events: readonly SimEvent[]) => void = () => {},
): SimEvent[] {
  const all: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    const events = stepEvents(sim, 1);
    all.push(...events);
    onStep(events);
  }
  return all;
}

function runUntilEvent(sim: Sim, type: SimEvent['type'], limitMs = 40_000): SimEvent[] {
  const events: SimEvent[] = [];
  const startMs = sim.world.time.sim;
  while (sim.world.time.sim - startMs < limitMs) {
    const stepped = stepEvents(sim, 1);
    events.push(...stepped);
    if (stepped.some((event) => event.type === type)) return events;
  }
  throw new Error(`no ${type} within ${limitMs} ms`);
}

const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): OfType<T>[] =>
  events.filter((event): event is OfType<T> => event.type === type);

const isPotTelegraph = (event: SimEvent): boolean =>
  event.type === 'ThreatTelegraphed' && event.kind === 'pot_on_stove';

const potOf = (sim: Sim) => {
  const abandoned = sim.chores[0]?.abandoned;
  if (abandoned === null || abandoned === undefined) throw new Error('the chore has no pot');
  return sim.world.threats[abandoned.threatIndex]!;
};

const centreOf = (sim: Sim): number =>
  sim.world.chores[0]!.beatWindowOpenAt + sim.world.chores[0]!.responseWindow.windowMs / 2;

function startCooking(sim: Sim): void {
  tell(sim, { type: 'TapObject', objectId: 'stove' });
  runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
}

/** Taps the stove on the centre of the announced beat and steps past it. */
function catchBeat(sim: Sim): void {
  const t = centreOf(sim);
  tell(sim, { type: 'TapObject', objectId: 'stove' }, t);
  stepUntil(sim, Math.ceil(t / 10) * 10 + 10);
}

function finishCooking(sim: Sim): void {
  startCooking(sim);
  for (let beat = 0; beat < 4; beat++) {
    catchBeat(sim);
    if (beat < 3) runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
  }
  expect(sim.world.chores[0]?.state).toBe('done');
}

/** Papa leaves the stove for the floor; steps until the chore is paused. */
function leaveStove(sim: Sim): void {
  tell(sim, { type: 'TapFloor', xM: 0, zM: 0 });
  stepEvents(sim, 1);
  expect(sim.world.chores[0]?.state).toBe('paused');
}

/**
 * When the pot is due: the latest of the chore being paused, the pot last going idle and the flow last
 * becoming `playing`, plus `afterMs`.
 */
const dueAtOf = (sim: Sim): number =>
  Math.max(sim.world.chores[0]!.enteredAt, potOf(sim).enteredAt, sim.world.flow.enteredAt) +
  (sim.chores[0]!.abandoned!.afterMs as number);

/**
 * Steps to the pot's telegraph, due at `dueAt`: none before it, then at `dueAt` itself, or later only
 * while Papa is busy (after `stay_awake` he may be asleep: the pot waits for him). Returns its instant.
 */
function stepToPot(sim: Sim, dueAt: number): number {
  expect(stepUntil(sim, dueAt - 10).some(isPotTelegraph)).toBe(false);
  while (sim.world.time.sim < dueAt + 20_000) {
    const wasBusy = isPapaBusy(sim.world.papa);
    if (stepEvents(sim, 1).some(isPotTelegraph)) {
      expect(wasBusy).toBe(false);
      return sim.world.time.sim;
    }
    expect(wasBusy, `no pot at ${sim.world.time.sim} with Papa free`).toBe(true);
  }
  throw new Error(`no pot within 20 s of ${dueAt}`);
}

describe('planning the pot (story 9.5, AC 4)', () => {
  it('plans one instance after every other threat, at the station, in no wave', async () => {
    const sim = await newSim({
      waves: [testWave([OUTLET])],
      fatigue: true,
      carry: true,
    });
    const abandoned = sim.chores[0]?.abandoned;
    expect(abandoned).not.toBeNull();
    expect(abandoned?.afterMs).toBe(SHORT_AFTER_MS);
    // The outlet, the micro-sleep and the cry keep their indices; the pot comes last.
    expect(sim.world.threats.map((threat) => threat.defId)).toEqual([
      'outlet',
      'papa_microsleep',
      'arms_cry',
      'pot_on_stove',
    ]);
    expect(abandoned?.threatIndex).toBe(3);
    const pot = potOf(sim);
    expect(pot).toMatchObject({
      state: 'idle',
      waveIndex: -1,
      xM: sim.chores[0]?.xM,
      zM: sim.chores[0]?.zM,
    });
  });

  it('plans nothing for a cooking that names no pot: the same threats as before', async () => {
    const sim = await newSim({ isPlain: true, waves: [testWave([OUTLET])] });
    expect(sim.chores[0]?.abandoned).toBeNull();
    expect(sim.world.threats.map((threat) => threat.defId)).toEqual(['outlet']);
  });

  /** The abandonable level, its pot def replaced (or dropped, `undefined`), and the waves given. */
  function levelWithPot(pot: typeof POT | undefined, waves: ReturnType<typeof testWave>[] = []) {
    const level = createTestLevel({
      waves,
      objects: [...TEST_OBJECTS, TEST_STOVE],
      chores: [TEST_COOKING],
      choreDefs: { cooking: createTestAbandonableCooking(SHORT_AFTER_MS) },
    });
    const { pot_on_stove: _loaded, ...others } = level.threats;
    return { ...level, threats: pot === undefined ? others : { ...others, pot_on_stove: pot } };
  }
  const create = (level: ReturnType<typeof levelWithPot>) =>
    createSim({ content, geometry, level, seed: 1 });

  it('refuses a pot the level does not load', async () => {
    await expect(create(levelWithPot(undefined))).rejects.toThrow(
      /chores\[0\]: no threat "pot_on_stove" is loaded for the abandoned chore/,
    );
  });

  it('refuses a pot whose threat is not on a station', async () => {
    await expect(create(levelWithPot({ ...POT, target: 'anchor' } as typeof POT))).rejects.toThrow(
      /has target "anchor", but the threat of an abandoned chore must have target "station"/,
    );
  });

  it('refuses a pot that is not parried', async () => {
    await expect(
      create(levelWithPot({ ...POT, response: 'hold' } as unknown as typeof POT)),
    ).rejects.toThrow(
      /a threat on a chore station \(target "station"\) is parried: the response of "pot_on_stove" must be "parry", not "hold"/,
    );
  });

  it('refuses a pot that would end in the micro-sleep', async () => {
    const asleep = { ...POT, gag: 'papa_asleep', afterEffect: { kind: 'asleep' } } as typeof POT;
    await expect(create(levelWithPot(asleep))).rejects.toThrow(
      /"papa_asleep" is the micro-sleep's gag: only a threat with target "papa" may end in it/,
    );
  });

  it('refuses a wave that plans the pot', async () => {
    const level = levelWithPot(POT, [testWave([{ def: 'pot_on_stove', anchor: 'stairs_top' }])]);
    await expect(create(level)).rejects.toThrow(/target "station"/);
  });
});

describe('when the pot starts (story 9.5, AC 5)', () => {
  it.each([
    ['untouched', async () => newSim()],
    [
      'working',
      async () => {
        const sim = await newSim();
        startCooking(sim);
        return sim;
      },
    ],
    [
      'done',
      async () => {
        const sim = await newSim();
        finishCooking(sim);
        return sim;
      },
    ],
  ] as const)('never starts for a cooking that is %s', async (_state, make) => {
    const sim = await make();
    const events = stepUntil(sim, sim.world.time.sim + SHORT_AFTER_MS * 4);
    expect(events.some(isPotTelegraph)).toBe(false);
    expect(potOf(sim).state).toBe('idle');
  });

  it('starts exactly `afterMs` after Papa left, not one step before', async () => {
    const sim = await newSim();
    startCooking(sim);
    leaveStove(sim);
    const pausedAt = sim.world.chores[0]!.enteredAt;
    const events: { t: number; event: SimEvent }[] = [];
    stepUntil(sim, pausedAt + SHORT_AFTER_MS + 100, (stepped) => {
      for (const event of stepped) events.push({ t: sim.world.time.sim, event });
    });
    const telegraphs = events.filter(({ event }) => isPotTelegraph(event));
    expect(telegraphs).toHaveLength(1);
    expect(telegraphs[0]?.t).toBe(pausedAt + SHORT_AFTER_MS);
    expect(telegraphs[0]?.event).toMatchObject({
      type: 'ThreatTelegraphed',
      kind: 'pot_on_stove',
      anchorId: TEST_STOVE.anchor,
      waveIndex: -1,
    });
  });

  it('reads the afterMs of the chore, not a constant', async () => {
    const sim = await newSim({ afterMs: 8000 });
    startCooking(sim);
    leaveStove(sim);
    const pausedAt = sim.world.chores[0]!.enteredAt;
    const events = stepUntil(sim, pausedAt + 8000 - 10);
    expect(events.some(isPotTelegraph)).toBe(false);
    expect(stepEvents(sim, 1).some(isPotTelegraph)).toBe(true);
  });

  it('waits for Papa to be free: not while he drinks his coffee', async () => {
    // A probe learns when the drink starts and ends, so that the pot falls due in the middle of it.
    const probe = await newSim({ afterMs: 1_000_000 });
    startCooking(probe);
    tell(probe, { type: 'TapObject', objectId: 'coffee_machine' });
    stepEvents(probe, 1);
    const pausedAt = probe.world.chores[0]!.enteredAt;
    let drinkFromAt: number | null = null;
    let drinkToAt: number | null = null;
    while (drinkToAt === null && probe.world.time.sim < pausedAt + 30_000) {
      stepEvents(probe, 1);
      const busy = isPapaBusy(probe.world.papa);
      if (busy && drinkFromAt === null) drinkFromAt = probe.world.time.sim;
      if (!busy && drinkFromAt !== null) drinkToAt = probe.world.time.sim;
    }
    expect(drinkFromAt).not.toBeNull();
    expect(drinkToAt).not.toBeNull();
    const afterMs =
      Math.round((((drinkFromAt as number) + (drinkToAt as number)) / 2 - pausedAt) / 10) * 10;

    const sim = await newSim({ afterMs });
    startCooking(sim);
    tell(sim, { type: 'TapObject', objectId: 'coffee_machine' });
    let dueWhileBusy = 0;
    let busyTelegraphs = 0;
    let telegraphedAt: number | null = null;
    const limitMs = sim.world.time.sim + 30_000;
    while (telegraphedAt === null && sim.world.time.sim < limitMs) {
      const events = stepEvents(sim, 1);
      const chore = sim.world.chores[0]!;
      const isDue =
        chore.state === 'paused' &&
        sim.world.time.sim >= dueAtOf(sim) &&
        potOf(sim).state === 'idle';
      if (isDue && isPapaBusy(sim.world.papa)) dueWhileBusy++;
      if (events.some(isPotTelegraph)) {
        if (isPapaBusy(sim.world.papa)) busyTelegraphs++;
        telegraphedAt = sim.world.time.sim;
      }
    }
    expect(dueWhileBusy).toBeGreaterThan(0);
    expect(busyTelegraphs).toBe(0);
    expect(telegraphedAt).toBeGreaterThanOrEqual(drinkToAt as number);
  });

  it('does not start while Papa is on his way back to the stove', async () => {
    const sim = await newSim();
    startCooking(sim);
    leaveStove(sim);
    // Papa wanders off, then turns back just before the pot is due.
    stepUntil(sim, dueAtOf(sim) - 20);
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    let wasHeadingBackWhenDue = false;
    const events = stepUntil(sim, dueAtOf(sim) + 600, () => {
      const { papa } = sim.world;
      if (
        sim.world.time.sim >= dueAtOf(sim) &&
        sim.world.chores[0]?.state === 'paused' &&
        papa.objectId === 'stove'
      ) {
        wasHeadingBackWhenDue = true;
      }
    });
    expect(wasHeadingBackWhenDue).toBe(true);
    expect(events.some(isPotTelegraph)).toBe(false);
    expect(sim.world.chores[0]?.state).toBe('working');
  });

  it('does not count a special sequence: the wait starts again when it is over', async () => {
    const sim = await newSim({ sequences: ['stay_awake'], afterMs: SEQUENCE_AFTER_MS });
    startCooking(sim);
    tell(sim, { type: 'StartSequence', sequenceId: 'stay_awake' });
    stepEvents(sim, 1);
    expect(sim.world.flow.state).toBe('sequence');
    const pausedAt = sim.world.chores[0]!.enteredAt;
    const events: SimEvent[] = [];
    while (sim.world.flow.state !== 'playing' && sim.world.time.sim < 200_000) {
      events.push(...stepEvents(sim, 1));
    }
    const playingAt = sim.world.flow.enteredAt;
    // The sequence outlasts the wait, which would have been over without it.
    expect(playingAt).toBeGreaterThan(pausedAt + SEQUENCE_AFTER_MS);
    expect(events.some(isPotTelegraph)).toBe(false);
    expect(stepToPot(sim, playingAt + SEQUENCE_AFTER_MS)).toBeGreaterThanOrEqual(
      playingAt + SEQUENCE_AFTER_MS,
    );
    expect(sim.world.flow.state).toBe('playing');
  });

  it('does not start while a silence is under way, the director’s rule', async () => {
    const sim = await newSim({
      waves: [testWave([SILENCE], { gapMinMs: 500_000, gapMaxMs: 500_000 })],
    });
    startCooking(sim);
    leaveStove(sim);
    stepUntil(sim, dueAtOf(sim) - 500);
    tell(sim, { type: 'ForceThreat', threatId: sim.world.threats[0]!.id });
    stepEvents(sim, 1);
    expect(isSilenceUnderway(sim.world)).toBe(true);
    let dueInSilence = 0;
    let telegraphsInSilence = 0;
    let telegraphedAt: number | null = null;
    const limitMs = sim.world.time.sim + 120_000;
    while (telegraphedAt === null && sim.world.time.sim < limitMs) {
      const events = stepEvents(sim, 1);
      const isSilent = isSilenceUnderway(sim.world);
      if (isSilent && sim.world.time.sim >= dueAtOf(sim)) dueInSilence++;
      if (events.some(isPotTelegraph)) {
        if (isSilent) telegraphsInSilence++;
        telegraphedAt = sim.world.time.sim;
      }
    }
    expect(dueInSilence).toBeGreaterThan(0);
    expect(telegraphsInSilence).toBe(0);
    expect(telegraphedAt).not.toBeNull();
  });

  it('does not start in the final rush', async () => {
    const durationMs = 40_000;
    const sim = await newSim({ afterMs: 30_000, finalRush: true, durationMs });
    const rushAt = durationMs - content.feel.endOfLevel.finalRushMs;
    startCooking(sim);
    leaveStove(sim);
    expect(dueAtOf(sim)).toBeGreaterThan(rushAt);
    const events = stepUntil(sim, durationMs);
    expect(sim.world.flow.finalRushAt).not.toBeNull();
    expect(events.some(isPotTelegraph)).toBe(false);
  });

  it('does not start when it could not be judged before the level ends', async () => {
    const probe = await newSim();
    startCooking(probe);
    leaveStove(probe);
    const dueAt = dueAtOf(probe);
    // One ms short of what the pot needs: its delay, its window and its tolerance.
    const durationMs = dueAt + POT_DELAY_MS + windowMs + toleranceMs - 1;
    const sim = await newSim({ durationMs });
    startCooking(sim);
    leaveStove(sim);
    expect(dueAtOf(sim)).toBe(dueAt);
    const events = stepUntil(sim, dueAt + 500);
    expect(events.some(isPotTelegraph)).toBe(false);
    // One ms more and it is judgeable: the control that makes the case above mean something.
    const control = await newSim({ durationMs: durationMs + 10 });
    startCooking(control);
    leaveStove(control);
    expect(stepUntil(control, dueAt + 10).some(isPotTelegraph)).toBe(true);
  });

  it('keeps the fairness spacing from another window: the pot window is postponed', async () => {
    const sim = await newSim({
      waves: [testWave([OUTLET], { gapMinMs: 500_000, gapMaxMs: 500_000 })],
    });
    startCooking(sim);
    leaveStove(sim);
    const outlet = sim.world.threats[0]!;
    // The outlet's window opens where the pot's natural one would, so the pot must give way.
    stepUntil(sim, dueAtOf(sim) - 10);
    tell(sim, { type: 'ForceThreat', threatId: outlet.id });
    const events = stepEvents(sim, 2);
    expect(outlet.state).toBe('telegraph');
    expect(events.some(isPotTelegraph)).toBe(true);
    const pot = potOf(sim);
    const naturalAt = pot.enteredAt + POT_DELAY_MS;
    expect(pot.windowOpenAt).toBeGreaterThan(naturalAt);
    expect(Math.abs(pot.windowOpenAt - outlet.windowOpenAt)).toBeGreaterThanOrEqual(
      FAIRNESS_SPACING_MS,
    );
  });
});

describe('answering the pot (story 9.5, AC 6, 7)', () => {
  /** A sim at the pot's telegraph: the cooking started, abandoned, the pot due. */
  async function atPot(options: Options = {}) {
    const sim = await newSim(options);
    startCooking(sim);
    leaveStove(sim);
    runUntilEvent(sim, 'ThreatTelegraphed', (options.afterMs ?? SHORT_AFTER_MS) + 1000);
    expect(potOf(sim).state).toBe('telegraph');
    return sim;
  }

  const centreOfPot = (sim: Sim): number => {
    const pot = potOf(sim);
    return pot.windowOpenAt + pot.responseWindow!.windowMs / 2;
  };

  it('is lowered with a press on its centre: a perfect, counted for Rire, nothing boils over', async () => {
    const sim = await atPot({ noise: true });
    const perfectsBefore = sim.world.score.perfects;
    const pot = potOf(sim);
    tell(sim, { type: 'PressThreat', threatId: pot.id }, centreOfPot(sim));
    tell(sim, { type: 'Release' }, centreOfPot(sim) + 20);
    const events = stepUntil(sim, centreOfPot(sim) + 200);
    const resolved = only(events, 'ResponseResolved');
    expect(resolved).toHaveLength(1);
    expect(resolved[0]).toMatchObject({ threatId: pot.id, quality: 'perfect', offsetMs: 0 });
    expect(only(events, 'GagTriggered')).toEqual([]);
    expect(sim.world.score.perfects).toBe(perfectsBefore + 1);
    expect(sim.world.mess.mischiefs).toBe(0);
    expect(sim.world.afterEffects.mischiefMarks).toEqual([]);
  });

  it('boils over when missed: a mischief, the mess at the stove, +10 % noise, +20 % catastrophe', async () => {
    const sim = await atPot({ noise: true });
    const pot = potOf(sim);
    const catastropheBefore = sim.world.gauges.catastrophePct;
    const events = stepUntil(sim, pot.windowOpenAt + pot.responseWindow!.windowMs + 400);
    expect(only(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ threatId: pot.id, gag: 'pot_boiled_over', reason: 'late' }),
    ]);
    expect(sim.world.mess.mischiefs).toBe(1);
    // The séquelle marks the floor at the pot, not at the baby.
    expect(sim.world.afterEffects.mischiefMarks).toEqual([
      { gag: 'pot_boiled_over', xM: sim.chores[0]!.xM, zM: sim.chores[0]!.zM },
    ]);
    expect(only(events, 'AfterEffectStarted')).toEqual([
      expect.objectContaining({ kind: 'mess', until: null }),
    ]);
    const noise = only(events, 'NoiseChanged').filter((event) => event.source === 'gag');
    expect(noise).toHaveLength(1);
    expect(noise[0]?.deltaPct).toBe(POT.gagNoisePct);
    expect(noise[0]?.noisePct).toBeGreaterThanOrEqual(POT.gagNoisePct as number);
    const rises = only(events, 'CatastropheChanged').filter((event) => event.source === 'mess');
    expect(rises).toHaveLength(1);
    expect(sim.world.gauges.catastrophePct).toBeGreaterThan(catastropheBefore);
  });

  it('makes no noise in a level with no noise gauge', async () => {
    const sim = await atPot({ noise: false });
    const pot = potOf(sim);
    const events = stepUntil(sim, pot.windowOpenAt + pot.responseWindow!.windowMs + 400);
    expect(only(events, 'GagTriggered')).toHaveLength(1);
    expect(only(events, 'NoiseChanged').filter((event) => event.source === 'gag')).toEqual([]);
  });

  it('is never locked on by the baby, and ForceThreat ignores it', async () => {
    const sim = await newSim();
    const pot = potOf(sim);
    tell(sim, { type: 'ForceThreat', threatId: pot.id });
    stepEvents(sim, 3);
    expect(pot.state).toBe('idle');
    const live = await atPot();
    stepUntil(live, live.world.time.sim + 400);
    expect(live.world.baby.targetThreatId).toBeNull();
    expect(live.world.baby.state).not.toBe('targetLocked');
  });

  it('is not cancelled by taking the baby, but is by a special sequence', async () => {
    const carrying = await atPot({ carry: true, sequences: ['stay_awake'] });
    const pot = potOf(carrying);
    tell(carrying, { type: 'TapBaby' });
    const events = runUntilEvent(carrying, 'BabyPickedUp', 20_000);
    // Still on the fire at the pick-up: `takeBaby` saw it and left it alone.
    expect(['telegraph', 'windowOpen']).toContain(pot.state);
    const cancelled = only(events, 'ThreatCancelled').filter((event) => event.threatId === pot.id);
    expect(cancelled).toEqual([]);

    const sequenced = await atPot({ sequences: ['stay_awake'] });
    tell(sequenced, { type: 'StartSequence', sequenceId: 'stay_awake' });
    const started = stepEvents(sequenced, 2);
    expect(only(started, 'ThreatCancelled')).toEqual([
      expect.objectContaining({ threatId: potOf(sequenced).id, reason: 'sequence' }),
    ]);
  });

  it('comes again `afterMs` after it is over while the cooking stays abandoned', async () => {
    const sim = await atPot();
    const events = runUntilEvent(sim, 'ThreatRearmed', 20_000);
    const rearmedAt = only(events, 'ThreatRearmed')[0]!.t;
    expect(potOf(sim).enteredAt).toBe(rearmedAt);
    expect(potOf(sim).state).toBe('idle');
    const next = stepUntil(sim, rearmedAt + SHORT_AFTER_MS - 10);
    expect(next.some(isPotTelegraph)).toBe(false);
    const due = stepEvents(sim, 1);
    expect(due.some(isPotTelegraph)).toBe(true);
    expect(sim.world.time.sim).toBe(rearmedAt + SHORT_AFTER_MS);
  });

  it('comes again `afterMs` after it was lowered, when Papa does not stay at the stove', async () => {
    const sim = await atPot();
    const pot = potOf(sim);
    tell(sim, { type: 'PressThreat', threatId: pot.id }, centreOfPot(sim));
    tell(sim, { type: 'Release' }, centreOfPot(sim) + 20);
    // Papa sets off for the pot, then turns away before he gets there: the cooking stays abandoned.
    stepUntil(sim, Math.ceil(centreOfPot(sim) / 10) * 10 + 10);
    tell(sim, { type: 'TapFloor', xM: 0, zM: 0 });
    const events = runUntilEvent(sim, 'ThreatRearmed', 20_000);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ threatId: pot.id, quality: 'perfect' }),
    ]);
    expect(sim.world.chores[0]?.state).toBe('paused');
    const rearmedAt = only(events, 'ThreatRearmed')[0]!.t;
    expect(stepUntil(sim, rearmedAt + SHORT_AFTER_MS - 10).some(isPotTelegraph)).toBe(false);
    expect(stepEvents(sim, 1).some(isPotTelegraph)).toBe(true);
    expect(sim.world.time.sim).toBe(rearmedAt + SHORT_AFTER_MS);
  });

  it('comes again `afterMs` after the play resumes, when a sequence cancelled it', async () => {
    const sim = await atPot({ sequences: ['stay_awake'], afterMs: SEQUENCE_AFTER_MS });
    tell(sim, { type: 'StartSequence', sequenceId: 'stay_awake' });
    stepEvents(sim, 2);
    expect(potOf(sim).state).toBe('idle');
    while (sim.world.flow.state !== 'playing' && sim.world.time.sim < 200_000) stepEvents(sim, 1);
    const playingAt = sim.world.flow.enteredAt;
    expect(sim.world.chores[0]?.state).toBe('paused');
    expect(dueAtOf(sim)).toBe(playingAt + SEQUENCE_AFTER_MS);
    stepToPot(sim, playingAt + SEQUENCE_AFTER_MS);
  });

  it('takes an early press as a glide, not a boil-over: only a press in the window is judged', async () => {
    // The pot's marker covers the stove's, so a tap meant for the cooking may land on it too soon.
    expect(content.feel.input.earlyPress).toBe('fail');
    const sim = await atPot();
    const pot = potOf(sim);
    tell(sim, { type: 'PressThreat', threatId: pot.id });
    const early = stepEvents(sim, 2);
    expect(only(early, 'GagTriggered')).toEqual([]);
    expect(only(early, 'ResponseResolved')).toEqual([]);
    expect(only(early, 'PapaGlideStarted')).toHaveLength(1);
    expect(pot.state).toBe('telegraph');
    tell(sim, { type: 'PressThreat', threatId: pot.id }, centreOfPot(sim));
    tell(sim, { type: 'Release' }, centreOfPot(sim) + 20);
    const judged = stepUntil(sim, centreOfPot(sim) + 200);
    expect(only(judged, 'ResponseResolved')).toEqual([
      expect.objectContaining({ threatId: pot.id, quality: 'perfect' }),
    ]);
    expect(only(judged, 'GagTriggered')).toEqual([]);
  });

  it('sends Papa back to the cooking when he lowers the heat: no new pot while he cooks', async () => {
    const sim = await atPot();
    const pot = potOf(sim);
    tell(sim, { type: 'PressThreat', threatId: pot.id }, centreOfPot(sim));
    tell(sim, { type: 'Release' }, centreOfPot(sim) + 20);
    const events = stepUntil(sim, centreOfPot(sim) + SHORT_AFTER_MS * 3);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ threatId: pot.id, quality: 'perfect' }),
    ]);
    // Back at the stove, the cooking resumes on its own, and its beat comes back once the pot is off.
    expect(sim.world.papa.state).toBe('chore');
    expect(sim.world.chores[0]?.state).toBe('working');
    expect(only(events, 'ChoreBeatTelegraphed').length).toBeGreaterThan(0);
    expect(events.filter(isPotTelegraph)).toEqual([]);
  });

  it('keeps Papa at the cooking when he lowers the heat from the stove itself', async () => {
    const sim = await atPot();
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    while (sim.world.papa.state !== 'chore' && sim.world.time.sim < 20_000) stepEvents(sim, 1);
    expect(sim.world.chores[0]?.beatState).toBe('held');
    const pot = potOf(sim);
    tell(sim, { type: 'PressThreat', threatId: pot.id }, centreOfPot(sim));
    tell(sim, { type: 'Release' }, centreOfPot(sim) + 20);
    const events = stepUntil(sim, centreOfPot(sim) + SHORT_AFTER_MS * 3);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ threatId: pot.id, quality: 'perfect' }),
    ]);
    expect(sim.world.papa.state).toBe('chore');
    expect(sim.world.chores[0]?.state).toBe('working');
    expect(events.filter(isPotTelegraph)).toEqual([]);
  });

  it('replays: a game with a boiled-over pot ends in the same world from its journal', async () => {
    const options: Options = { noise: true };
    const { content: liveContent, level } = worldOf(options);
    const live = await createSim({ content: liveContent, geometry, level, seed: 1 });
    startCooking(live);
    leaveStove(live);
    stepUntil(live, 12_000);
    expect(live.world.mess.mischiefs).toBe(1);
    const replay = await replayJournal({
      content: liveContent,
      geometry,
      level,
      journal: live.journal(),
      untilSimMs: live.world.time.sim,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(live.world));
    replay.value.sim.dispose();
  });

  it('holds the cooking: the beat of a chore Papa returns to waits for its own pot', async () => {
    const sim = await atPot();
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    const events: SimEvent[] = [];
    while (sim.world.papa.state !== 'chore' && sim.world.time.sim < 20_000) {
      events.push(...stepEvents(sim, 1));
    }
    // The pot is still on the fire when Papa gets there (its delay is longer than the glide).
    expect(['telegraph', 'windowOpen']).toContain(potOf(sim).state);
    expect(sim.world.chores[0]).toMatchObject({ state: 'working', beatState: 'held' });
    expect(only(events, 'ChoreBeatTelegraphed')).toEqual([]);
  });

  it('survives a snapshot with the pot telegraphed: the restored game ends where the live one does', async () => {
    const live = await atPot({ noise: true });
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
    const copy = await newSim({ noise: true });
    copy.restore(snapshot);
    expect(potOf(copy)).toEqual(potOf(live));
    for (const sim of [live, copy]) stepUntil(sim, 12_000);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    expect(copy.world.mess.mischiefs).toBe(live.world.mess.mischiefs);
  });
});
