import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestStayAwake,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  stepN,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';

// Snapshot v19 (story 4.4): `world.sequence` and the `sequence` flow state round-trip, and the
// validator refuses a slice that disagrees with itself or with the level.
const content = createTestContent();
const geometry = createTestGeometry();
// No micro-sleep ever comes (the gap is longer than the sequence): the sequence is only played to its end.
const quiet = createTestStayAwake();
quiet.steps = quiet.steps.map((step) => ({ ...step, gapMinMs: 100_000, gapMaxMs: 100_000 }));
const level = createTestLevel({
  gauges: { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
  carry: CARRY,
  sequences: ['stay_awake'],
  sequenceDefs: { stay_awake: quiet },
});
const newSim = () => createSim({ content, geometry, level, seed: 5 });
const roundTrip = (sim: Sim) =>
  JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;

/** Mid-step: the second step of the sequence is running and a micro-sleep is due. */
async function midSequence(): Promise<Sim> {
  const sim = await newSim();
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'stay_awake' });
  stepN(sim, 520);
  expect(sim.world.flow.state).toBe('sequence');
  expect(sim.world.sequence.stepIndex).toBe(1);
  return sim;
}

type World = Record<string, Record<string, unknown>>;

describe('the sequence slice in a snapshot (story 4.4)', () => {
  it('is version 20 and carries the slice at rest, before any sequence', async () => {
    const snapshot = roundTrip(await newSim());
    expect(snapshot.version).toBe(20);
    expect(snapshot.world.sequence).toEqual({
      id: null,
      lastId: null,
      startedAt: 0,
      endsAt: 0,
      endedAt: null,
      stepIndex: 0,
      stepEndsAt: 0,
      nextMicroSleepAt: null,
    });
    expect(snapshot.world.flow.state).toBe('playing');
  });

  it('round-trips a sequence mid-step to the uninterrupted hash', async () => {
    const live = await midSequence();
    const snapshot = roundTrip(live);
    expect(snapshot.world.flow.state).toBe('sequence');
    expect(snapshot.world.sequence.id).toBe('stay_awake');
    const copy = await newSim();
    copy.restore(snapshot);
    stepN(live, 1200);
    stepN(copy, 1200);
    expect(live.world.flow.state).toBe('playing');
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  it('round-trips the slice after the end: lastId and endedAt stay', async () => {
    const live = await midSequence();
    stepN(live, 1200);
    expect(live.world.sequence.id).toBeNull();
    const snapshot = roundTrip(live);
    expect(snapshot.world.sequence.lastId).toBe('stay_awake');
    expect(snapshot.world.sequence.endedAt).not.toBeNull();
    const copy = await newSim();
    expect(() => copy.restore(snapshot)).not.toThrow();
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  describe('refuses a damaged slice, naming the field', () => {
    type Damage = (w: World) => void;
    const slice = (w: World) => w.sequence as Record<string, unknown>;
    const broken: [string, Damage, RegExp][] = [
      ['an id the level does not plan', (w) => (slice(w).id = 'sleep_walk'), /world\.sequence\.id/],
      ['an id that is a number', (w) => (slice(w).id = 7), /world\.sequence\.id/],
      [
        'a lastId the level does not plan',
        (w) => (slice(w).lastId = 'x'),
        /world\.sequence\.lastId/,
      ],
      [
        'a lastId that is not the running id',
        (w) => (slice(w).lastId = null),
        /world\.sequence\.lastId/,
      ],
      ['a negative startedAt', (w) => (slice(w).startedAt = -1), /world\.sequence\.startedAt/],
      [
        'a startedAt in the future',
        (w) => (slice(w).startedAt = 1e9),
        /world\.sequence\.startedAt/,
      ],
      ['a NaN endsAt', (w) => (slice(w).endsAt = Number.NaN), /world\.sequence\.endsAt/],
      ['a string stepEndsAt', (w) => (slice(w).stepEndsAt = '5'), /world\.sequence\.stepEndsAt/],
      ['a stepIndex out of range', (w) => (slice(w).stepIndex = 3), /world\.sequence\.stepIndex/],
      ['a fractional stepIndex', (w) => (slice(w).stepIndex = 0.5), /world\.sequence\.stepIndex/],
      ['an endedAt while one runs', (w) => (slice(w).endedAt = 100), /world\.sequence\.endedAt/],
      [
        'a nextMicroSleepAt that is not a time',
        (w) => (slice(w).nextMicroSleepAt = 'soon'),
        /world\.sequence\.nextMicroSleepAt/,
      ],
      [
        'a flow that is not in a sequence while one runs',
        (w) => ((w.flow as Record<string, unknown>).state = 'playing'),
        /world\.sequence\.id/,
      ],
      ['no slice', (w) => delete w.sequence, /world\.sequence is missing/],
    ];

    it.each(broken)('%s', async (_name, damage, expected) => {
      const snapshot = roundTrip(await midSequence());
      damage(snapshot.world as unknown as World);
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });

    it('a sequence flow state with no running id', async () => {
      const snapshot = roundTrip(await newSim());
      (snapshot.world as unknown as World).flow = { state: 'sequence', enteredAt: 0 };
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(/world\.sequence\.id/);
    });

    it('an endedAt in the future after the end', async () => {
      const live = await midSequence();
      stepN(live, 1200);
      const snapshot = roundTrip(live);
      (snapshot.world as unknown as World).sequence = {
        ...(snapshot.world.sequence as unknown as Record<string, unknown>),
        endedAt: 1e9,
      };
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(/world\.sequence\.endedAt/);
    });
  });

  it('refuses a version 18 snapshot, which has no sequence slice', async () => {
    const snapshot = roundTrip(await newSim());
    const target = await newSim();
    expect(() => target.restore({ ...snapshot, version: 18 as 20 })).toThrow(/version 18/);
  });
});
