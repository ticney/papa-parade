import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  DISHWASHER_OPEN,
  TEST_COOKING,
  TEST_DISHWASHER,
  TEST_OBJECTS,
  TEST_STOVE,
  TEST_UNLOAD_DISHWASHER,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

// The chores slice of the snapshot (story 9.4): a game round-trips through it mid-beat, and a damaged
// slice is refused with the field named (the project's rule: everything is checked first).

const content = createTestContent();
const geometry = createTestGeometry();

async function newSim(): Promise<Sim> {
  return createSim({
    content,
    geometry,
    level: createTestLevel({ objects: [...TEST_OBJECTS, TEST_STOVE], chores: [TEST_COOKING] }),
    seed: 4,
  });
}

function stepUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

/** A sim at the first beat of a started cooking, and its snapshot as a restore would receive it (through JSON). */
async function atFirstBeat() {
  const live = await newSim();
  live.enqueue({ type: 'TapObject', objectId: 'stove', t: asSimMs(0) });
  stepUntil(live, 1000);
  expect(live.world.chores[0]?.beatState).toBe('telegraph');
  const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
  return { live, snapshot };
}

describe('the chores in a snapshot', () => {
  it('round-trips a chore mid-beat: the restored game ends where the live one does', async () => {
    const { live, snapshot } = await atFirstBeat();
    const copy = await newSim();
    copy.restore(snapshot);
    expect(copy.world.chores).toEqual(live.world.chores);
    expect(copy.world.papa.state).toBe('chore');
    // Both play on, with the same tap on the window's centre.
    const centre =
      live.world.chores[0]!.beatWindowOpenAt + live.world.chores[0]!.responseWindow.windowMs / 2;
    for (const sim of [live, copy]) {
      sim.enqueue({ type: 'TapObject', objectId: 'stove', t: asSimMs(centre) });
      stepUntil(sim, centre + 3000);
    }
    expect(copy.world.chores[0]?.beatsDone).toBe(1);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it('round-trips a paused chore with its progress, and a glide to a station', async () => {
    const live = await newSim();
    live.enqueue({ type: 'TapObject', objectId: 'stove', t: asSimMs(0) });
    stepUntil(live, 300);
    // Mid-glide: a glide with no threat, and an object.
    expect(live.world.papa.state).toBe('glide');
    expect(live.world.papa.glide?.threatId).toBeNull();
    expect(live.world.papa.objectId).toBe('stove');
    const copy = await newSim();
    copy.restore(JSON.parse(JSON.stringify(live.snapshot())));
    stepUntil(live, 2000);
    stepUntil(copy, 2000);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    expect(copy.world.chores[0]?.state).toBe('working');
  });

  describe('refuses a damaged slice, naming the field', () => {
    const chore = (world: Record<string, unknown>) =>
      (world.chores as Record<string, unknown>[])[0] as Record<string, unknown>;
    const set = (target: Record<string, unknown>, key: string, value: unknown): void => {
      target[key] = value;
    };
    const broken: [string, (world: Record<string, unknown>) => void, RegExp][] = [
      ['no chores', (world) => delete world.chores, /world\.chores/],
      ['another number of chores', (world) => set(world, 'chores', []), /world\.chores/],
      ['a chore that is not an object', (world) => set(world, 'chores', [3]), /world\.chores\[0\]/],
      ['an unknown state', (world) => set(chore(world), 'state', 'baking'), /chores\[0\]\.state/],
      [
        'an unknown beat state',
        (world) => set(chore(world), 'beatState', 'late'),
        /chores\[0\]\.beatState/,
      ],
      [
        'a NaN enteredAt',
        (world) => set(chore(world), 'enteredAt', Number.NaN),
        /chores\[0\]\.enteredAt/,
      ],
      [
        'an enteredAt in the future',
        (world) => set(chore(world), 'enteredAt', 99_999_999),
        /chores\[0\]\.enteredAt/,
      ],
      [
        'a fractional beatsDone',
        (world) => set(chore(world), 'beatsDone', 0.5),
        /chores\[0\]\.beatsDone/,
      ],
      [
        'more beats done than beats',
        (world) => set(chore(world), 'beatsDone', 5),
        /chores\[0\]\.beatsDone/,
      ],
      [
        'a done chore with beats left',
        (world) => set(chore(world), 'state', 'done'),
        /chores\[0\]\.beatsDone/,
      ],
      [
        'all the beats done on a chore that is not done',
        (world) => set(chore(world), 'beatsDone', 4),
        /chores\[0\]\.beatsDone/,
      ],
      [
        'a working chore with no beat',
        (world) => set(chore(world), 'beatState', 'none'),
        /chores\[0\]\.beatState/,
      ],
      [
        'a beat on a chore that is not working',
        (world) => {
          set(chore(world), 'state', 'paused');
          set(world.papa as Record<string, unknown>, 'state', 'idle');
        },
        /chores\[0\]\.beatState/,
      ],
      [
        'a beat announced in the future',
        (world) => set(chore(world), 'beatTelegraphAt', 99_999_999),
        /chores\[0\]\.beatTelegraphAt/,
      ],
      [
        'a window that opens before the announcement',
        (world) => set(chore(world), 'beatWindowOpenAt', 1),
        /chores\[0\]\.beatWindowOpenAt/,
      ],
      [
        'a window of no length on an announced beat',
        (world) =>
          set(chore(world), 'responseWindow', {
            windowMs: 0,
            perfectMs: 0,
            toleranceMs: 0,
            bufferMs: 0,
          }),
        /chores\[0\]\.responseWindow/,
      ],
      [
        'a missing window',
        (world) => set(chore(world), 'responseWindow', null),
        /chores\[0\]\.responseWindow/,
      ],
      [
        'a held beat that keeps an announcement',
        (world) => set(chore(world), 'beatState', 'held'),
        /chores\[0\]\.beatTelegraphAt/,
      ],
      [
        'a working chore while Papa is not in chore',
        (world) => set(world.papa as Record<string, unknown>, 'state', 'idle'),
        /world\.papa\.state/,
      ],
      [
        'a Papa in chore while no chore is working',
        (world) => {
          set(chore(world), 'state', 'paused');
          set(chore(world), 'beatState', 'none');
          set(chore(world), 'beatTelegraphAt', 0);
          set(chore(world), 'beatWindowOpenAt', 0);
          set(chore(world), 'responseWindow', {
            windowMs: 0,
            perfectMs: 0,
            toleranceMs: 0,
            bufferMs: 0,
          });
        },
        /world\.papa\.state/,
      ],
    ];
    it.each(broken)('%s', async (_name, damage, expected) => {
      const { snapshot } = await atFirstBeat();
      damage(snapshot.world as unknown as Record<string, unknown>);
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });

    it('a glide with no threat to an object that is not a chore’s station', async () => {
      const live = await newSim();
      live.enqueue({ type: 'TapObject', objectId: 'stove', t: asSimMs(0) });
      stepUntil(live, 300);
      const toPhone = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
      (toPhone.world.papa as { objectId: string | null }).objectId = 'phone';
      await expect(async () => (await newSim()).restore(toPhone)).rejects.toThrow(
        /world\.papa\.objectId/,
      );
    });

    it('a glide to a station with no object, and a threat glide with an object', async () => {
      const live = await newSim();
      live.enqueue({ type: 'TapObject', objectId: 'stove', t: asSimMs(0) });
      stepUntil(live, 300);
      const noObject = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
      (noObject.world.papa as { objectId: string | null }).objectId = null;
      await expect(async () => (await newSim()).restore(noObject)).rejects.toThrow(
        /world\.papa\.objectId/,
      );
      const withThreat = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
      (withThreat.world.papa.glide as { threatId: number | null }).threatId = 7;
      await expect(async () => (await newSim()).restore(withThreat)).rejects.toThrow(
        /world\.papa\.objectId/,
      );
    });
  });
});

describe('the Maison row in a snapshot of an ended level (story 9.4 review)', () => {
  const newShortSim = (): Promise<Sim> =>
    createSim({
      content,
      geometry,
      level: createTestLevel({
        objects: [...TEST_OBJECTS, TEST_STOVE],
        chores: [TEST_COOKING],
        durationMs: 40_000,
      }),
      seed: 4,
    });

  /** A cooking finished with four perfect beats, and the level played to its end. */
  async function endedWithCookingDone(): Promise<Sim> {
    const sim = await newShortSim();
    sim.enqueue({ type: 'TapObject', objectId: 'stove', t: asSimMs(0) });
    stepUntil(sim, 1000);
    for (let beat = 0; beat < 4; beat++) {
      const chore = sim.world.chores[0]!;
      const centre = chore.beatWindowOpenAt + chore.responseWindow.windowMs / 2;
      sim.enqueue({ type: 'TapObject', objectId: 'stove', t: asSimMs(centre) });
      stepUntil(sim, centre + 20);
    }
    expect(sim.world.chores[0]?.state).toBe('done');
    while (sim.world.score.final === null) stepUntil(sim, sim.world.time.sim + 1000);
    return sim;
  }

  it('restores a note whose Maison row and total end on a half', async () => {
    const live = await endedWithCookingDone();
    expect(live.world.score.final?.homePoints).toBe(7.5);
    expect(Number.isInteger((live.world.score.final?.scorePoints ?? 0) * 2)).toBe(true);
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
    const copy = await newShortSim();
    expect(() => copy.restore(snapshot)).not.toThrow();
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it.each([
    ['a Maison row that is not a half', 'homePoints', 7.3, /world\.score\.final\.homePoints/],
    ['a negative Maison row', 'homePoints', -0.5, /world\.score\.final\.homePoints/],
    ['a total that is not a half', 'scorePoints', 61.3, /world\.score\.final\.scorePoints/],
    ['a half on another row', 'laughPoints', 1.5, /world\.score\.final\.laughPoints/],
  ] as const)('still refuses %s', async (_name, key, value, expected) => {
    const live = await endedWithCookingDone();
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
    (snapshot.world.score.final as unknown as Record<string, number>)[key] = value;
    const copy = await newShortSim();
    expect(() => copy.restore(snapshot)).toThrow(expected);
  });
});

describe('the dishwasher’s plates and door in a snapshot (story 9.6)', () => {
  // The cooking is chore 0, the dishwasher chore 1; its door is planned late, so that only a test draws it.
  const newDishSim = (): Promise<Sim> =>
    createSim({
      content,
      geometry,
      level: createTestLevel({
        waves: [testWave([DISHWASHER_OPEN], { fromMs: 500_000 })],
        objects: [...TEST_OBJECTS, TEST_STOVE, TEST_DISHWASHER],
        chores: [TEST_COOKING, TEST_UNLOAD_DISHWASHER],
      }),
      seed: 4,
    });
  const DISH = 1;

  /** The dishwasher opened and left, its door forced: the chore paused and open, the threat telegraphed. */
  async function atOpenDoor() {
    const live = await newDishSim();
    live.enqueue({ type: 'TapObject', objectId: 'dishwasher', t: asSimMs(0) });
    stepUntil(live, 1500);
    live.enqueue({ type: 'TapFloor', xM: 0, zM: 0, t: asSimMs(live.world.time.sim) });
    stepUntil(live, live.world.time.sim + 20);
    const doorIndex = live.chores[DISH]?.openThreatIndex as number;
    live.enqueue({
      type: 'ForceThreat',
      threatId: live.world.threats[doorIndex]!.id,
      t: asSimMs(live.world.time.sim),
    });
    stepUntil(live, live.world.time.sim + 20);
    expect(live.world.threats[doorIndex]?.state).toBe('telegraph');
    expect(live.world.chores[DISH]).toMatchObject({ state: 'paused', isOpen: true });
    const snapshot = JSON.parse(JSON.stringify(live.snapshot())) as ReturnType<Sim['snapshot']>;
    return { live, snapshot };
  }

  const choreOf = (snapshot: ReturnType<Sim['snapshot']>, index: number) =>
    snapshot.world.chores[index] as unknown as Record<string, unknown>;

  it('round-trips the plates missed and the open door: the restored game ends where the live one does', async () => {
    const { live, snapshot } = await atOpenDoor();
    const copy = await newDishSim();
    copy.restore(snapshot);
    expect(copy.world.chores).toEqual(live.world.chores);
    stepUntil(live, live.world.time.sim + 4000);
    stepUntil(copy, copy.world.time.sim + 4000);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it.each([
    ['a negative count of beats missed', -1],
    ['a fractional count of beats missed', 1.5],
    ['a count of beats missed that is not a number', '2'],
  ])('refuses %s', async (_name, value) => {
    const { snapshot } = await atOpenDoor();
    choreOf(snapshot, DISH).beatsMissed = value;
    await expect(restoreInto(snapshot)).rejects.toThrow(/world\.chores\[1\]\.beatsMissed/);
  });

  it('refuses a missing count of beats missed', async () => {
    const { snapshot } = await atOpenDoor();
    delete choreOf(snapshot, DISH).beatsMissed;
    await expect(restoreInto(snapshot)).rejects.toThrow(/world\.chores\[1\]\.beatsMissed/);
  });

  it.each([
    ['a door that is not a boolean', 1, 'yes'],
    ['a missing door', 1, undefined],
    ['an open door on the cooking, which has none', 0, true],
  ])('refuses %s', async (_name, index, value) => {
    const { snapshot } = await atOpenDoor();
    const target = choreOf(snapshot, index);
    if (value === undefined) delete target.isOpen;
    else target.isOpen = value;
    await expect(restoreInto(snapshot)).rejects.toThrow(
      new RegExp(`world\\.chores\\[${index}\\]\\.isOpen`),
    );
  });

  it('refuses an open door on a chore that is untouched, and on one that is done', async () => {
    const { snapshot } = await atOpenDoor();
    const untouched = structuredClone(snapshot);
    Object.assign(choreOf(untouched, DISH), { state: 'untouched', enteredAt: 0, beatsDone: 0 });
    await expect(restoreInto(untouched)).rejects.toThrow(/world\.chores\[1\]\.isOpen/);
    const done = structuredClone(snapshot);
    Object.assign(choreOf(done, DISH), { state: 'done', beatsDone: 4 });
    await expect(restoreInto(done)).rejects.toThrow(/world\.chores\[1\]\.isOpen/);
  });

  it('refuses a shut chore whose door the baby is heading for', async () => {
    const { snapshot } = await atOpenDoor();
    choreOf(snapshot, DISH).isOpen = false;
    await expect(restoreInto(snapshot)).rejects.toThrow(/world\.chores\[1\]\.isOpen/);
  });

  it('refuses a snapshot of the version before: its chores have no plates or door', async () => {
    const { snapshot } = await atOpenDoor();
    await expect(restoreInto({ ...snapshot, version: 32 as 34 })).rejects.toThrow(/version 32/);
  });

  /** Restores into a fresh sim; async so that every refusal is read the same way (`rejects`). */
  async function restoreInto(snapshot: ReturnType<Sim['snapshot']>): Promise<void> {
    (await newDishSim()).restore(snapshot);
  }
});
