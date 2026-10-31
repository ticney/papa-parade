import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBedtimeDuel,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

// Snapshot v23 (story 4.6): `world.sequence.duel` round-trips, and the validator refuses a slice
// that disagrees with itself or with the level. The round trips are taken with something in flight
// (the rest, a drawn signal not yet given, an open window, after a retreat), and each copy is played
// to the end next to the live sim, with the hashes compared (the reviews of 4.4 and 4.5).
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestBedtimeDuel();
const level = createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'] });
const newSim = () => createSim({ content, geometry, level, seed: 5 });
const roundTrip = (sim: Sim) =>
  JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
const worldOf = (sim: Sim) => sim.world as World;
const eyesOf = (sim: Sim) => {
  const eyes = worldOf(sim).threats.find((threat) => threat.defId === 'bedtime_eyes');
  if (eyes === undefined) throw new Error('no eyes');
  return eyes;
};

function stepFor(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

function stepUntil(sim: Sim, isDone: () => boolean): void {
  for (let i = 0; i < 3000 && !isDone(); i++) {
    sim.step();
    // What happened before the snapshot is not part of what both copies play next.
    sim.drainEvents();
  }
  expect(isDone()).toBe(true);
}

async function started(): Promise<Sim> {
  const sim = await newSim();
  const world = worldOf(sim);
  world.baby.xM = world.papa.xM - 3;
  world.baby.zM = world.papa.zM;
  world.baby.prevXM = world.baby.xM;
  world.baby.prevZM = world.baby.zM;
  world.baby.wanderAt = asSimMs(1_000_000);
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bedtime_duel' });
  stepFor(sim, 1);
  return sim;
}

/** Presses the open round dead centre, as the player would. */
function pressCentre(sim: Sim): void {
  const eyes = eyesOf(sim);
  const centre = eyes.windowOpenAt + (eyes.responseWindow?.windowMs ?? 0) / 2;
  sim.enqueue({ type: 'PressThreat', t: asSimMs(centre), threatId: eyes.id });
  sim.enqueue({ type: 'Release', t: asSimMs(centre + 50) });
}

describe('the duel slice in a snapshot (story 4.6)', () => {
  it('carries the slice mid-rest, a round up and after a retreat', async () => {
    const sim = await started();
    expect(roundTrip(sim).world.sequence.duel).toEqual({
      isRunning: true,
      nextRoundAt: worldOf(sim).sequence.startedAt + 1000,
      retreats: 0,
    });
    stepUntil(sim, () => eyesOf(sim).state === 'telegraph');
    expect(roundTrip(sim).world.sequence.duel).toMatchObject({
      isRunning: true,
      nextRoundAt: null,
    });
    // Nobody answers: a retreat, retreats 1.
    stepUntil(sim, () => worldOf(sim).sequence.duel.retreats === 1);
    expect(roundTrip(sim).world.sequence.duel).toMatchObject({ isRunning: true, retreats: 1 });
  });

  describe.each([
    ['in the rest before a round', async (sim: Sim) => stepFor(sim, 20)],
    [
      'with a signal drawn and not given yet (the drawn windowOpenAt must survive)',
      async (sim: Sim) => stepUntil(sim, () => eyesOf(sim).state === 'telegraph'),
    ],
    [
      'with the window open',
      async (sim: Sim) => {
        stepUntil(sim, () => eyesOf(sim).state === 'windowOpen');
        stepFor(sim, 3);
      },
    ],
    [
      'after a retreat, with retreats above 0',
      async (sim: Sim) => {
        stepUntil(sim, () => worldOf(sim).sequence.duel.retreats === 1);
        stepFor(sim, 5);
      },
    ],
  ] as const)('%s', (_name, bring) => {
    it('restores to the same state and plays the same to the end, answered or not', async () => {
      for (const isAnswered of [true, false]) {
        const live = await started();
        await bring(live);
        const snapshot = roundTrip(live);
        const copy = await newSim();
        copy.restore(snapshot);
        expect(hashJson(copy.world)).toBe(hashJson(live.world));
        expect(eyesOf(copy).windowOpenAt).toBe(eyesOf(live).windowOpenAt);
        if (isAnswered) {
          for (const sim of [live, copy]) {
            if (eyesOf(sim).state === 'telegraph' || eyesOf(sim).state === 'windowOpen') {
              pressCentre(sim);
            }
          }
        }
        // To the end of the sequence or 40 s, whichever comes first, on both copies.
        const liveEvents: SimEvent[] = [];
        const copyEvents: SimEvent[] = [];
        for (let i = 0; i < 4000; i++) {
          liveEvents.push(...stepFor(live, 1));
          copyEvents.push(...stepFor(copy, 1));
          if (worldOf(live).sequence.id === null) break;
          if (isAnswered && eyesOf(live).state === 'telegraph') {
            for (const sim of [live, copy]) pressCentre(sim);
          }
        }
        expect(worldOf(live).sequence.id).toBeNull();
        expect(copyEvents).toEqual(liveEvents);
        expect(hashJson(copy.world)).toBe(hashJson(live.world));
      }
    });
  });

  describe('refuses a damaged slice, naming the field', () => {
    type Damage = (
      duel: Record<string, unknown>,
      world: Record<string, Record<string, unknown>>,
    ) => void;
    const broken: [string, Damage, RegExp][] = [
      [
        'no duel slice',
        (_duel, w) => delete (w.sequence as Record<string, unknown>).duel,
        /world\.sequence\.duel is missing/,
      ],
      [
        'an isRunning that is not a boolean',
        (duel) => (duel.isRunning = 1),
        /world\.sequence\.duel\.isRunning/,
      ],
      [
        'an isRunning false while a duel step runs',
        (duel) => (duel.isRunning = false),
        /world\.sequence\.duel\.isRunning/,
      ],
      [
        'a nextRoundAt that is a string',
        (duel) => (duel.nextRoundAt = 'soon'),
        /world\.sequence\.duel\.nextRoundAt/,
      ],
      [
        'a negative nextRoundAt',
        (duel) => (duel.nextRoundAt = -5),
        /world\.sequence\.duel\.nextRoundAt/,
      ],
      [
        'a NaN nextRoundAt',
        (duel) => (duel.nextRoundAt = Number.NaN),
        /world\.sequence\.duel\.nextRoundAt/,
      ],
      ['a fractional retreats', (duel) => (duel.retreats = 0.5), /world\.sequence\.duel\.retreats/],
      ['a negative retreats', (duel) => (duel.retreats = -1), /world\.sequence\.duel\.retreats/],
      [
        'retreats at maxRetreats (the sequence would have ended)',
        (duel) => (duel.retreats = DEF.failure.kind === 'retreats' ? DEF.failure.maxRetreats : 0),
        /world\.sequence\.duel\.retreats/,
      ],
    ];

    it.each(broken)('%s', async (_name, damage, expected) => {
      const snapshot = roundTrip(await started());
      const world = snapshot.world as unknown as Record<string, Record<string, unknown>>;
      damage(world.sequence?.duel as Record<string, unknown>, world);
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });

    it.each([
      [
        'a duel still running after the end',
        { isRunning: true, nextRoundAt: null, retreats: 0 },
        /isRunning/,
      ],
      [
        'a round still due after the end',
        { isRunning: false, nextRoundAt: 5000, retreats: 0 },
        /nextRoundAt/,
      ],
      [
        'retreats left over after the end',
        { isRunning: false, nextRoundAt: null, retreats: 2 },
        /retreats/,
      ],
    ] as const)('%s', async (_name, patch, expected) => {
      const live = await started();
      for (let i = 0; i < 3; i++) {
        stepUntil(live, () => {
          const eyes = eyesOf(live);
          return eyes.state === 'telegraph' || worldOf(live).sequence.id === null;
        });
        if (worldOf(live).sequence.id === null) break;
        stepUntil(live, () => eyesOf(live).state !== 'telegraph');
      }
      stepUntil(live, () => worldOf(live).sequence.id === null);
      const snapshot = roundTrip(live);
      (snapshot.world as unknown as Record<string, Record<string, unknown>>).sequence = {
        ...(snapshot.world.sequence as unknown as Record<string, unknown>),
        duel: patch,
      };
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });

    // A sequence that is not a duel (the default `stay_awake`): the slice must stay empty.
    describe.each([
      [
        'a duel running during a step that is not a duel',
        { isRunning: true, nextRoundAt: null, retreats: 0 },
        /duel\.isRunning/,
      ],
      [
        'retreats in a sequence whose failure is not retreats',
        { isRunning: false, nextRoundAt: null, retreats: 1 },
        /duel\.retreats/,
      ],
    ] as const)('%s', (_name, patch, expected) => {
      it('is refused', async () => {
        const stayAwakeLevel = createTestLevel({
          gauges: { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
          carry: CARRY,
          sequences: ['stay_awake'],
        });
        const make = () => createSim({ content, geometry, level: stayAwakeLevel, seed: 5 });
        const live = await make();
        live.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'stay_awake' });
        stepFor(live, 2);
        expect(worldOf(live).sequence.id).toBe('stay_awake');
        const snapshot = roundTrip(live);
        const world = snapshot.world as unknown as Record<string, Record<string, unknown>>;
        world.sequence = { ...(world.sequence as Record<string, unknown>), duel: patch };
        const target = await make();
        expect(() => target.restore(snapshot)).toThrow(expected);
      });
    });

    it('a flow outside a sequence, with a duel running', async () => {
      const snapshot = roundTrip(await newSim());
      const world = snapshot.world as unknown as Record<string, Record<string, unknown>>;
      world.sequence = {
        ...(world.sequence as Record<string, unknown>),
        duel: { isRunning: true, nextRoundAt: null, retreats: 0 },
      };
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(/world\.sequence\.duel\.isRunning/);
    });
  });

  it('refuses a version 22 snapshot, which has no duel slice', async () => {
    const snapshot = roundTrip(await started());
    const target = await newSim();
    expect(() => target.restore({ ...snapshot, version: 22 as 23 })).toThrow(/version 22/);
  });
});
