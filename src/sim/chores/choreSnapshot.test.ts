import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  TEST_COOKING,
  TEST_OBJECTS,
  TEST_STOVE,
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
