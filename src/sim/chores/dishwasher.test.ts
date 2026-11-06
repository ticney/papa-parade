import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestCooking,
  createTestDishwasherOpen,
  createTestGeometry,
  createTestLevel,
  createTestUnloadDishwasher,
  DISHWASHER_OPEN,
  NOISE_GAUGES,
  OUTLET,
  SILENCE,
  TEST_COOKING,
  TEST_DISHWASHER,
  TEST_OBJECTS,
  TEST_STOVE,
  TEST_UNLOAD_DISHWASHER,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { replayJournal } from '../replay.ts';

// The dishwasher (story 9.6): the second chore station, its plates and its open door. Every number is
// read from the frozen content (`testDishwasher.chore.json`, `testDishwasherOpen.threat.json`, the frozen
// feel), never typed in. The door is planned in every level that declares the chore (`createSim` refuses
// otherwise); it starts late unless a test is about the director, so that it is planned and never drawn.

const baseContent = createTestContent();
// An early tap is a miss here, as the sim's default: a test of the early miss does not depend on the feel file.
const content = {
  ...baseContent,
  feel: {
    ...baseContent.feel,
    input: { ...baseContent.feel.input, earlyPress: 'fail' as const },
  },
};
const geometry = createTestGeometry();
const DISHWASHER = createTestUnloadDishwasher();
const DOOR = createTestDishwasherOpen();
const { bufferMs } = content.feel.timing;
const DOOR_DELAY_MS = DOOR.telegraphDelayMs ?? content.feel.timing.telegraphDelayDefaultMs;
const BEAT_COUNT = DISHWASHER.beats.length;
const MISS_NOISE_PCT = DISHWASHER.missNoisePct as number;
const MISS_BROKEN = DISHWASHER.missBrokenObjects as number;
// A door planned so late that the director never reaches it in a test that is not about it.
const NEVER_MS = 500_000;

type DistributiveOmit<T, K extends string> = T extends unknown ? Omit<T, K> : never;
type OfType<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;

interface Options {
  /** The cooking too (index 0), the dishwasher then being chore 1. */
  isCookingIncluded?: boolean;
  /** Both stations at the stove's anchor: a glide from one to the other ends in the step it starts. */
  isSameSpot?: boolean;
  /** When the wave that plans the door starts; never by default. */
  doorFromMs?: number;
  /** Other threats the same wave plans (the door's wave). */
  alsoPlans?: (typeof OUTLET)[];
  isNoisy?: boolean;
  isCarrying?: boolean;
  /** The baby is within Papa's reach wherever he crawls (the threat catalogue's trick). */
  isBabyAlwaysInReach?: boolean;
  durationMs?: number;
}

function levelOf(options: Options = {}) {
  const spot = options.isSameSpot === true ? 'stairs_top' : TEST_DISHWASHER.anchor;
  const station = { ...TEST_DISHWASHER, anchor: spot };
  const door = { ...DISHWASHER_OPEN, anchor: spot };
  const cooking = options.isCookingIncluded === true || options.isSameSpot === true;
  return createTestLevel({
    waves: [
      testWave([...(options.alsoPlans ?? []), door], {
        fromMs: options.doorFromMs ?? NEVER_MS,
        ...((options.alsoPlans?.length ?? 0) > 0 ? { maxSimultaneous: 2 } : {}),
      }),
    ],
    objects: [...TEST_OBJECTS, ...(cooking ? [TEST_STOVE] : []), station],
    chores: cooking ? [TEST_COOKING, TEST_UNLOAD_DISHWASHER] : [TEST_UNLOAD_DISHWASHER],
    ...(options.isNoisy === true ? { gauges: NOISE_GAUGES } : {}),
    ...(options.isCarrying === true ? { carry: CARRY } : {}),
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
  });
}

const farReachContent = {
  ...content,
  feel: { ...content.feel, carry: { ...content.feel.carry, reachM: 100 } },
};

async function newSim(options: Options = {}): Promise<Sim> {
  return createSim({
    content: options.isBabyAlwaysInReach === true ? farReachContent : content,
    geometry,
    level: levelOf(options),
    seed: 1,
  });
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

function stepUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const all: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) all.push(...stepEvents(sim, 1));
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

/** The index of the dishwasher in `world.chores`. */
const indexOf = (sim: Sim): number =>
  sim.chores.findIndex((chore) => chore.objectId === 'dishwasher');
const choreOf = (sim: Sim) => sim.world.chores[indexOf(sim)]!;
const doorOf = (sim: Sim) => sim.world.threats[sim.chores[indexOf(sim)]!.openThreatIndex!]!;
const isDoorTelegraph = (event: SimEvent): boolean =>
  event.type === 'ThreatTelegraphed' && event.kind === DOOR.id;
const workingCount = (sim: Sim): number =>
  sim.world.chores.filter((chore) => chore.state === 'working').length;

/** Taps the dishwasher and steps until its first beat is announced. */
function startDishwasher(sim: Sim): void {
  tell(sim, { type: 'TapObject', objectId: 'dishwasher' });
  runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
}

const centreOf = (sim: Sim): number =>
  choreOf(sim).beatWindowOpenAt + choreOf(sim).responseWindow.windowMs / 2;

/** Taps the dishwasher at `t` and steps once past it. */
function tapAt(sim: Sim, t: number): SimEvent[] {
  tell(sim, { type: 'TapObject', objectId: 'dishwasher' }, t);
  return stepUntil(sim, Math.ceil(t / 10) * 10 + 10);
}

/** Catches the announced beat at the centre of its window. */
function catchBeat(sim: Sim): SimEvent[] {
  return tapAt(sim, centreOf(sim));
}

/** Catches every beat; Papa ends the chore (it is done and the door is shut). */
function finishDishwasher(sim: Sim): void {
  startDishwasher(sim);
  for (let beat = 0; beat < BEAT_COUNT; beat++) {
    catchBeat(sim);
    if (beat < BEAT_COUNT - 1) runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
  }
  expect(choreOf(sim).state).toBe('done');
}

/** Papa walks away from the dishwasher: paused in the same step, the door still open. */
function leaveDishwasher(sim: Sim): void {
  tell(sim, { type: 'TapFloor', xM: 0, zM: 0 });
  stepEvents(sim, 1);
  expect(choreOf(sim).state).toBe('paused');
}

/** The window of the door's threat is centred here, and the press for it. */
const doorCentre = (sim: Sim): number =>
  doorOf(sim).windowOpenAt + (doorOf(sim).responseWindow?.windowMs ?? 0) / 2;

/** Presses the telegraphed door at the centre of its window and steps one step at a time to the verdict. */
function pressDoor(sim: Sim): SimEvent[] {
  const door = doorOf(sim);
  const t = doorCentre(sim);
  tell(sim, { type: 'PressThreat', threatId: door.id }, t);
  tell(sim, { type: 'Release' }, t + content.feel.input.holdMinMs / 2);
  return stepUntil(sim, t + content.feel.input.holdMinMs + 20);
}

/** Opens the dishwasher, leaves it, and forces the door: telegraphed, the baby heading for it. */
function openAndForceDoor(sim: Sim): void {
  startDishwasher(sim);
  leaveDishwasher(sim);
  tell(sim, { type: 'ForceThreat', threatId: doorOf(sim).id });
  stepEvents(sim, 1);
  expect(doorOf(sim).state).toBe('telegraph');
}

describe('the dishwasher level (story 9.6, AC 1, 5)', () => {
  it('plans the chore at the dishwasher object and links it to its door, both ways', async () => {
    const sim = await newSim({ isCookingIncluded: true });
    expect(sim.chores.map((chore) => chore.objectId)).toEqual(['stove', 'dishwasher']);
    const index = indexOf(sim);
    expect(index).toBe(1);
    const doorIndex = sim.chores[index]?.openThreatIndex;
    expect(doorIndex).not.toBeNull();
    expect(sim.world.threats[doorIndex as number]?.defId).toBe(DOOR.id);
    // The cooking has no door.
    expect(sim.chores[0]?.openThreatIndex).toBeNull();
  });

  it('starts every chore shut and unbroken, and keeps the cooking shut for a whole game', async () => {
    const sim = await newSim({ isCookingIncluded: true });
    for (const chore of sim.world.chores) {
      expect(chore).toMatchObject({ isOpen: false, beatsMissed: 0 });
    }
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
    stepUntil(sim, sim.world.time.sim + 20_000);
    // Worked at, missed and re-announced for twenty seconds: the stove has no door.
    expect(sim.world.chores[0]).toMatchObject({ state: 'working', isOpen: false });
    expect(sim.world.chores[0]!.beatsMissed).toBeGreaterThan(0);
  });

  it('refuses a level that does not plan the door of its dishwasher exactly once', async () => {
    const noDoor = createTestLevel({
      waves: [testWave([OUTLET])],
      objects: [...TEST_OBJECTS, TEST_DISHWASHER],
      chores: [TEST_UNLOAD_DISHWASHER],
    });
    await expect(createSim({ content, geometry, level: noDoor, seed: 1 })).rejects.toThrow(
      /chores\[0\]: the chore "unload_dishwasher" names the open threat "dishwasher_open", which the level must plan in one of its waves exactly once, but plans it 0 times/,
    );
    const twice = createTestLevel({
      waves: [
        testWave([DISHWASHER_OPEN]),
        testWave([{ def: 'dishwasher_open', anchor: 'coffee_machine' }], { fromMs: 9000 }),
      ],
      objects: [...TEST_OBJECTS, TEST_DISHWASHER],
      chores: [TEST_UNLOAD_DISHWASHER],
    });
    await expect(createSim({ content, geometry, level: twice, seed: 1 })).rejects.toThrow(
      /chores\[0\]: the chore "unload_dishwasher" names the open threat "dishwasher_open", which the level must plan in one of its waves exactly once, but plans it 2 times/,
    );
  });

  it('refuses a door planned away from its station', async () => {
    const away = createTestLevel({
      waves: [testWave([{ def: 'dishwasher_open', anchor: 'coffee_machine' }])],
      objects: [...TEST_OBJECTS, TEST_DISHWASHER],
      chores: [TEST_UNLOAD_DISHWASHER],
    });
    await expect(createSim({ content, geometry, level: away, seed: 1 })).rejects.toThrow(
      /chores\[0\]: the threat "dishwasher_open" is the open threat of the chore "unload_dishwasher": it must be planned at the anchor of the chore's station \("door"\), not at "coffee_machine"/,
    );
  });

  it('refuses an open threat that is not on an anchor', async () => {
    // A silence is planned at a hidden zone: planned once, but it is not a door on an anchor.
    const level = createTestLevel({
      waves: [testWave([SILENCE], { fromMs: NEVER_MS })],
      objects: [...TEST_OBJECTS, TEST_DISHWASHER],
      chores: [TEST_UNLOAD_DISHWASHER],
      choreDefs: {
        unload_dishwasher: { ...createTestUnloadDishwasher(), openThreat: SILENCE.def },
      },
    });
    await expect(createSim({ content, geometry, level, seed: 1 })).rejects.toThrow(
      /chores\[0\]: the threat "silence_mischief" has target "hiddenZone", but the open threat of a chore must have target "anchor"/,
    );
  });

  it('refuses two chores that name the same door', async () => {
    // Both stations share the door's anchor, so that only the sharing is wrong.
    const level = createTestLevel({
      waves: [testWave([DISHWASHER_OPEN], { fromMs: NEVER_MS })],
      objects: [
        ...TEST_OBJECTS,
        { ...TEST_STOVE, anchor: TEST_DISHWASHER.anchor },
        TEST_DISHWASHER,
      ],
      chores: [TEST_COOKING, TEST_UNLOAD_DISHWASHER],
      choreDefs: { cooking: { ...createTestCooking(), openThreat: 'dishwasher_open' } },
    });
    await expect(createSim({ content, geometry, level, seed: 1 })).rejects.toThrow(
      /chores\[1\]: the threat "dishwasher_open" is already the open threat of another chore/,
    );
  });
});

describe('the door (AC 7)', () => {
  it('opens when Papa starts the chore, and stays open when he leaves', async () => {
    const sim = await newSim();
    expect(choreOf(sim).isOpen).toBe(false);
    startDishwasher(sim);
    expect(choreOf(sim)).toMatchObject({ state: 'working', isOpen: true });
    leaveDishwasher(sim);
    expect(choreOf(sim)).toMatchObject({ state: 'paused', isOpen: true });
  });

  it('shuts when the last beat is caught: Papa closes the emptied dishwasher', async () => {
    const sim = await newSim();
    startDishwasher(sim);
    for (let beat = 0; beat < BEAT_COUNT; beat++) {
      expect(choreOf(sim).isOpen, `before beat ${beat}`).toBe(true);
      const events = catchBeat(sim);
      if (beat < BEAT_COUNT - 1) {
        expect(choreOf(sim).isOpen, `after beat ${beat}`).toBe(true);
        runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
      } else {
        expect(only(events, 'ChoreCompleted')).toHaveLength(1);
      }
    }
    expect(choreOf(sim)).toMatchObject({ state: 'done', isOpen: false });
  });

  it('stays shut on a done chore: tapping the emptied dishwasher opens nothing', async () => {
    const sim = await newSim();
    finishDishwasher(sim);
    tell(sim, { type: 'TapFloor', xM: 0, zM: 0 });
    stepEvents(sim, 1);
    tell(sim, { type: 'TapObject', objectId: 'dishwasher' });
    stepEvents(sim, 150);
    expect(choreOf(sim)).toMatchObject({ state: 'done', isOpen: false });
  });

  it('shuts in the step of the parry, while the chore is paused', async () => {
    const sim = await newSim();
    openAndForceDoor(sim);
    expect(choreOf(sim)).toMatchObject({ state: 'paused', isOpen: true });
    const door = doorOf(sim);
    tell(sim, { type: 'PressThreat', threatId: door.id }, doorCentre(sim));
    tell(sim, { type: 'Release' }, doorCentre(sim) + content.feel.input.holdMinMs / 2);
    let resolvedAt: number | null = null;
    while (resolvedAt === null && sim.world.time.sim < doorCentre(sim) + 1000) {
      const events = stepEvents(sim, 1);
      const [resolved] = only(events, 'ResponseResolved');
      if (resolved === undefined) {
        expect(choreOf(sim).isOpen, 'open until the parry').toBe(true);
        continue;
      }
      resolvedAt = resolved.t;
      expect(resolved.quality).toBe('perfect');
      // Shut at the end of the step that emits the result, not one step later.
      expect(choreOf(sim)).toMatchObject({ state: 'paused', isOpen: false });
    }
    expect(resolvedAt).not.toBeNull();
  });

  it('shuts on a success too, not only on a perfect', async () => {
    const sim = await newSim();
    openAndForceDoor(sim);
    const door = doorOf(sim);
    const openAt = door.windowOpenAt;
    // The edge of the window, tolerance included: a success.
    const t = openAt - (door.responseWindow?.toleranceMs ?? 0);
    tell(sim, { type: 'PressThreat', threatId: door.id }, t);
    tell(sim, { type: 'Release' }, t + content.feel.input.holdMinMs / 2);
    const events = stepUntil(sim, t + content.feel.input.holdMinMs + 20);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'success' }),
    ]);
    expect(choreOf(sim).isOpen).toBe(false);
  });

  it('shuts while the chore is working, and the press that shut it leaves the chore paused, not working', async () => {
    const sim = await newSim();
    openAndForceDoor(sim);
    // Papa goes back to the dishwasher before the window opens: the beat is held for the door.
    tell(sim, { type: 'TapObject', objectId: 'dishwasher' });
    runUntilEvent(sim, 'PapaArrived', 5000);
    expect(choreOf(sim)).toMatchObject({ state: 'working', isOpen: true, beatState: 'held' });
    pressDoor(sim);
    expect(doorOf(sim).state).toBe('resolved');
    // `working` ⇔ Papa in `chore` holds at the end of every step: the glide to the door paused it.
    expect(choreOf(sim)).toMatchObject({ state: 'paused', isOpen: false });
    expect(sim.world.papa.state).not.toBe('chore');
    expect(workingCount(sim)).toBe(0);
  });

  it('is opened again by the next start: a shut door is no target until Papa resumes the chore', async () => {
    const sim = await newSim();
    openAndForceDoor(sim);
    pressDoor(sim);
    expect(choreOf(sim)).toMatchObject({ state: 'paused', isOpen: false });
    startDishwasher(sim);
    expect(choreOf(sim)).toMatchObject({ state: 'working', isOpen: true });
  });

  it('stays open after a gag: the baby got in, the door is still open', async () => {
    const sim = await newSim();
    openAndForceDoor(sim);
    const events = runUntilEvent(sim, 'GagTriggered', 10_000);
    expect(only(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_in_dishwasher' }),
    ]);
    expect(choreOf(sim)).toMatchObject({ state: 'paused', isOpen: true });
  });

  it('stays open when the baby is taken: the threat is cancelled, not answered', async () => {
    const sim = await newSim({ isCarrying: true, isBabyAlwaysInReach: true });
    openAndForceDoor(sim);
    tell(sim, { type: 'TapBaby' });
    const events = [...runUntilEvent(sim, 'BabyPickedUp', 10_000), ...stepEvents(sim, 2)];
    expect(only(events, 'ThreatCancelled')).toEqual([
      expect.objectContaining({ threatId: doorOf(sim).id }),
    ]);
    expect(doorOf(sim).state).toBe('idle');
    expect(choreOf(sim)).toMatchObject({ state: 'paused', isOpen: true });
  });
});

describe('the plates (AC 3)', () => {
  /** Misses the announced beat by saying nothing: the verdict is the silence's. */
  const missByWaiting = (sim: Sim): SimEvent[] => runUntilEvent(sim, 'ChoreBeatJudged', 20_000);

  it('counts a late miss, and the beat comes back', async () => {
    const sim = await newSim();
    startDishwasher(sim);
    const events = missByWaiting(sim);
    expect(only(events, 'ChoreBeatJudged')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', beatIndex: 0 }),
    ]);
    expect(choreOf(sim)).toMatchObject({ beatsMissed: 1, beatsDone: 0, beatState: 'telegraph' });
  });

  it('counts an early miss too', async () => {
    const sim = await newSim();
    startDishwasher(sim);
    const chore = choreOf(sim);
    const t = chore.beatWindowOpenAt - chore.responseWindow.toleranceMs - bufferMs - 10;
    expect(t).toBeGreaterThan(chore.beatTelegraphAt);
    const events = tapAt(sim, t);
    expect(only(events, 'ChoreBeatJudged')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'early' }),
    ]);
    expect(choreOf(sim).beatsMissed).toBe(1);
  });

  it('never decreases: a catch after two misses leaves them counted', async () => {
    const sim = await newSim();
    startDishwasher(sim);
    missByWaiting(sim);
    missByWaiting(sim);
    expect(choreOf(sim).beatsMissed).toBe(2);
    catchBeat(sim);
    expect(choreOf(sim)).toMatchObject({ beatsDone: 1, beatsMissed: 2 });
    // And leaving and coming back does not wipe them.
    leaveDishwasher(sim);
    startDishwasher(sim);
    expect(choreOf(sim).beatsMissed).toBe(2);
  });

  it('keeps the catastrophe rise of a missed beat as 9.4 made it', async () => {
    const sim = await newSim();
    startDishwasher(sim);
    const events = missByWaiting(sim);
    expect(only(events, 'CatastropheChanged')).toEqual([
      expect.objectContaining({
        source: 'choreBeat',
        deltaPct: content.feel.catastrophe.risePct.choreBeat,
      }),
    ]);
  });

  it('makes the def’s noise with a noise gauge: one gag-sourced rise of missNoisePct', async () => {
    const sim = await newSim({ isNoisy: true });
    startDishwasher(sim);
    const before = sim.world.gauges.noisePct;
    const events = missByWaiting(sim);
    expect(only(events, 'NoiseChanged')).toEqual([
      expect.objectContaining({ source: 'gag', deltaPct: MISS_NOISE_PCT }),
    ]);
    expect(sim.world.gauges.noisePct).toBeCloseTo(before + MISS_NOISE_PCT, 6);
  });

  it('makes no noise in a level without a gauge, and none for a catch', async () => {
    const quiet = await newSim();
    startDishwasher(quiet);
    expect(only(missByWaiting(quiet), 'NoiseChanged')).toEqual([]);
    const noisy = await newSim({ isNoisy: true });
    startDishwasher(noisy);
    const events = catchBeat(noisy);
    expect(only(events, 'NoiseChanged').filter((event) => event.source === 'gag')).toEqual([]);
  });

  it('makes no noise of its own for a chore whose def has no missNoisePct (the cooking)', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({
        objects: [...TEST_OBJECTS, TEST_STOVE],
        chores: [TEST_COOKING],
        gauges: NOISE_GAUGES,
      }),
      seed: 1,
    });
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
    const events = runUntilEvent(sim, 'ChoreBeatJudged', 20_000);
    expect(only(events, 'ChoreBeatJudged')).toHaveLength(1);
    expect(only(events, 'NoiseChanged').filter((event) => event.source === 'gag')).toEqual([]);
    expect(sim.world.chores[0]!.beatsMissed).toBe(1);
  });

  it('counts the broken plates in Mama’s note: one object per miss, a Soupir of sighPerBrokenPropPoints each', async () => {
    // Played once to find when the second and the third miss fall; the level of the real run ends between
    // them, so that exactly two plates are broken when Mama scores (more would only hit the Soupir's cap).
    const probe = await newSim();
    startDishwasher(probe);
    runUntilEvent(probe, 'ChoreBeatJudged', 20_000);
    runUntilEvent(probe, 'ChoreBeatJudged', 20_000);
    const secondMissAt = probe.world.time.sim;
    runUntilEvent(probe, 'ChoreBeatJudged', 20_000);
    const thirdMissAt = probe.world.time.sim;
    const durationMs = Math.floor((secondMissAt + thirdMissAt) / 2 / 10) * 10;
    const sim = await newSim({ durationMs });
    startDishwasher(sim);
    const events = stepUntil(sim, durationMs + 20);
    expect(choreOf(sim).beatsMissed).toBe(2);
    const [scored] = only(events, 'LevelScored');
    expect(scored).toBeDefined();
    const {
      sighPerBrokenPropPoints,
      sighPerMischiefPoints,
      sighPerPropOnFloorPoints,
      sighMaxPoints,
    } = content.feel.mama;
    const sighOf = (plates: number): number =>
      Math.min(
        sighMaxPoints,
        Math.round(
          sim.world.mess.propsOnFloor * sighPerPropOnFloorPoints +
            (sim.world.mess.propsBroken + plates) * sighPerBrokenPropPoints +
            sim.world.mess.mischiefs * sighPerMischiefPoints,
        ),
      );
    expect(scored?.sighPoints).toBe(sighOf(2 * MISS_BROKEN));
    // The two plates are what the Soupir shows: without them it would be lower.
    expect(sighOf(0)).toBeLessThan(sighOf(2 * MISS_BROKEN));
  });
});

describe('the director and the open door (AC 8)', () => {
  const doorOptions = { doorFromMs: 0 } as const;

  it('never draws the door while the chore is untouched', async () => {
    const sim = await newSim(doorOptions);
    expect(stepUntil(sim, 5000).some(isDoorTelegraph)).toBe(false);
    expect(doorOf(sim).state).toBe('idle');
  });

  it('never draws it while Papa works at the dishwasher', async () => {
    const sim = await newSim(doorOptions);
    startDishwasher(sim);
    expect(choreOf(sim).state).toBe('working');
    expect(stepUntil(sim, sim.world.time.sim + 3000).some(isDoorTelegraph)).toBe(false);
    expect(choreOf(sim).state).toBe('working');
  });

  it('never draws it once the dishwasher is emptied and shut', async () => {
    const sim = await newSim(doorOptions);
    finishDishwasher(sim);
    expect(stepUntil(sim, sim.world.time.sim + 5000).some(isDoorTelegraph)).toBe(false);
  });

  it('draws it while the chore is paused with its door open: the baby heads for the anchor', async () => {
    const sim = await newSim(doorOptions);
    startDishwasher(sim);
    tell(sim, { type: 'TapFloor', xM: 0, zM: 0 });
    const events = stepUntil(sim, sim.world.time.sim + 2000);
    const [telegraphed] = events.filter(isDoorTelegraph) as OfType<'ThreatTelegraphed'>[];
    expect(telegraphed).toMatchObject({ kind: DOOR.id, anchorId: 'door' });
    expect(choreOf(sim)).toMatchObject({ state: 'paused', isOpen: true });
    // A wave threat like any other: the window opens `telegraphDelayMs` after the telegraph.
    expect(doorOf(sim).windowOpenAt).toBe((telegraphed?.t ?? 0) + DOOR_DELAY_MS);
  });

  it('does not draw it again after a parry shut the door, even long after the cooldown', async () => {
    const sim = await newSim(doorOptions);
    openAndForceDoor(sim);
    pressDoor(sim);
    expect(choreOf(sim).isOpen).toBe(false);
    // Past the cooldown: the threat is idle again and only the shut door keeps it from being drawn.
    const cooldownMs = DOOR.cooldownMs;
    const events = stepUntil(sim, sim.world.time.sim + cooldownMs + 6000);
    expect(doorOf(sim).state).toBe('idle');
    expect(events.some(isDoorTelegraph)).toBe(false);
    // Papa reopens it and walks off: the baby may choose it again.
    startDishwasher(sim);
    tell(sim, { type: 'TapFloor', xM: 0, zM: 0 });
    expect(stepUntil(sim, sim.world.time.sim + 2000).some(isDoorTelegraph)).toBe(true);
  });

  it('ignores ForceThreat on a shut door and obeys it on an open one', async () => {
    const sim = await newSim();
    const door = doorOf(sim);
    tell(sim, { type: 'ForceThreat', threatId: door.id });
    expect(stepEvents(sim, 3).some(isDoorTelegraph)).toBe(false);
    expect(door.state).toBe('idle');
    startDishwasher(sim);
    leaveDishwasher(sim);
    tell(sim, { type: 'ForceThreat', threatId: door.id });
    expect(stepEvents(sim, 1).some(isDoorTelegraph)).toBe(true);
  });

  it('draws nothing of its own: a shut door leaves the director’s random stream as if it were not planned', async () => {
    const withDoor = await newSim({ doorFromMs: 0, alsoPlans: [OUTLET] });
    const without = await createSim({
      content,
      geometry,
      level: createTestLevel({ waves: [testWave([OUTLET])], objects: TEST_OBJECTS }),
      seed: 1,
    });
    const events = stepUntil(withDoor, 6000);
    stepUntil(without, 6000);
    // The outlet really was drawn, so the stream really moved.
    expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
    expect(withDoor.world.rng).toEqual(without.world.rng);
  });
});

describe('the door holds the chore (AC 9)', () => {
  it('holds the beat while the baby heads for the door, and announces it when the threat is over', async () => {
    const sim = await newSim();
    openAndForceDoor(sim);
    tell(sim, { type: 'TapObject', objectId: 'dishwasher' });
    const arrival = runUntilEvent(sim, 'PapaArrived', 5000);
    expect(only(arrival, 'ChoreBeatTelegraphed')).toEqual([]);
    expect(['telegraph', 'windowOpen']).toContain(doorOf(sim).state);
    expect(choreOf(sim)).toMatchObject({ state: 'working', beatState: 'held' });
    // The whole telegraph and window: nothing announced while the door is on, the beat held.
    let announcedAt: number | null = null;
    while (announcedAt === null) {
      if (sim.world.time.sim > 20_000) throw new Error('the beat was never announced');
      const events = stepEvents(sim, 1);
      const isOn = ['telegraph', 'windowOpen'].includes(doorOf(sim).state);
      if (only(events, 'ChoreBeatTelegraphed').length > 0) {
        announcedAt = sim.world.time.sim;
        expect(isOn, 'announced with the door still on').toBe(false);
        expect(only(events, 'ChoreBeatTelegraphed')).toEqual([
          expect.objectContaining({ beatIndex: 0 }),
        ]);
      } else if (isOn) {
        expect(choreOf(sim).beatState).toBe('held');
      }
    }
    // Over by a gag (nobody parried it): the hold ended with the threat.
    expect(doorOf(sim).state).toBe('gag');
    expect(choreOf(sim).beatState).toBe('telegraph');
  });

  it('cannot be emptied with the door telegraphed: the last beat is not announced either', async () => {
    const sim = await newSim();
    startDishwasher(sim);
    for (let beat = 0; beat < BEAT_COUNT - 1; beat++) {
      catchBeat(sim);
      runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
    }
    expect(choreOf(sim).beatsDone).toBe(BEAT_COUNT - 1);
    leaveDishwasher(sim);
    tell(sim, { type: 'ForceThreat', threatId: doorOf(sim).id });
    stepEvents(sim, 1);
    tell(sim, { type: 'TapObject', objectId: 'dishwasher' });
    runUntilEvent(sim, 'PapaArrived', 5000);
    expect(choreOf(sim)).toMatchObject({
      state: 'working',
      beatState: 'held',
      beatsDone: BEAT_COUNT - 1,
    });
  });
});

describe('two stations, one working chore (AC 10)', () => {
  it('pauses the stove when a glide from it ends, in its own step, at the dishwasher', async () => {
    const sim = await newSim({ isSameSpot: true });
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
    expect(sim.world.chores.map((chore) => chore.state)).toEqual(['working', 'untouched']);
    tell(sim, { type: 'TapObject', objectId: 'dishwasher' });
    const events = stepEvents(sim, 1);
    // The glide really did end where it started (the stations share a point), within the step.
    expect(only(events, 'PapaArrived')).toHaveLength(1);
    expect(sim.world.chores.map((chore) => chore.state)).toEqual(['paused', 'working']);
    expect(workingCount(sim)).toBe(1);
    expect(sim.world.papa.state).toBe('chore');
    // The rule the snapshot enforces holds, and the beat of the stove is dropped, not frozen mid-air.
    expect(sim.world.chores[0]).toMatchObject({ beatState: 'none', beatTelegraphAt: 0 });
    expect(() => sim.restore(JSON.parse(JSON.stringify(sim.snapshot())))).not.toThrow();
  });

  it('goes the other way too, and resumes each chore where it stopped', async () => {
    const sim = await newSim({ isSameSpot: true });
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    runUntilEvent(sim, 'ChoreBeatTelegraphed', 10_000);
    const stoveCentre =
      sim.world.chores[0]!.beatWindowOpenAt + sim.world.chores[0]!.responseWindow.windowMs / 2;
    tell(sim, { type: 'TapObject', objectId: 'stove' }, stoveCentre);
    stepUntil(sim, Math.ceil(stoveCentre / 10) * 10 + 10);
    expect(sim.world.chores[0]!.beatsDone).toBe(1);
    tell(sim, { type: 'TapObject', objectId: 'dishwasher' });
    stepEvents(sim, 1);
    tell(sim, { type: 'TapObject', objectId: 'stove' });
    stepEvents(sim, 1);
    expect(sim.world.chores.map((chore) => chore.state)).toEqual(['working', 'paused']);
    expect(sim.world.chores[0]!.beatsDone).toBe(1);
    expect(workingCount(sim)).toBe(1);
  });
});

describe('the snapshot and the replay (AC 13)', () => {
  it('restores a game with the door open and its threat telegraphed, and both play on alike', async () => {
    const live = await newSim({ isNoisy: true });
    openAndForceDoor(live);
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
    expect(snapshot.world.chores[indexOf(live)]).toMatchObject({ isOpen: true, state: 'paused' });
    const copy = await newSim({ isNoisy: true });
    copy.restore(snapshot);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    stepUntil(live, live.world.time.sim + 4000);
    stepUntil(copy, copy.world.time.sim + 4000);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    expect(choreOf(copy).isOpen).toBe(true);
  });

  it('replays a game that misses, parries the door and finishes both chores to the same world', async () => {
    const options: Options = { isCookingIncluded: true, doorFromMs: 0, isNoisy: true };
    const live = await createSim({ content, geometry, level: levelOf(options), seed: 1 });
    startDishwasher(live);
    runUntilEvent(live, 'ChoreBeatJudged', 20_000);
    leaveDishwasher(live);
    runUntilEvent(live, 'ThreatTelegraphed', 5000);
    pressDoor(live);
    expect(choreOf(live).isOpen).toBe(false);
    finishDishwasher(live);
    const replay = await replayJournal({
      content,
      geometry,
      level: levelOf(options),
      journal: live.journal(),
      untilSimMs: live.world.time.sim,
    });
    expect(replay.ok).toBe(true);
    if (!replay.ok) return;
    expect(hashJson(replay.value.sim.world)).toBe(hashJson(live.world));
    replay.value.sim.dispose();
  });
});
