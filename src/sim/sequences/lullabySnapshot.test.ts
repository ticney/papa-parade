import type { BeatsStep } from '@content/schemas/sequence';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestLullabyWalk,
  stepN,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import { beatTimelineOf } from './beatClock.ts';

// Snapshot v22 (story 4.5): `world.sequence.beat` round-trips in a count-in, in an open window and
// just after a decoy, each continued to the end on both copies with the hashes compared (4.4's
// review: a round trip with nothing in flight proves nothing); and the validator refuses a slice
// that disagrees with itself or with the step's timeline.
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestLullabyWalk();
const STEP = DEF.steps[0] as BeatsStep;
const TIMELINE = beatTimelineOf(STEP);
const level = createTestLevel({ carry: CARRY, sequences: ['lullaby_walk'] });
const newSim = () => createSim({ content, geometry, level, seed: 5 });
const roundTrip = (sim: Sim) =>
  JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
type Loose = Record<string, unknown>;
const beatOf = (snapshot: ReturnType<Sim['snapshot']>) =>
  (snapshot.world.sequence as unknown as { beat: Loose }).beat;

const BEAT_ENTRIES = TIMELINE.filter((entry) => entry.kind === 'beat');
const DECOY_OFFSET = TIMELINE.find((entry) => entry.kind === 'decoy')?.offsetMs ?? 0;

/** A started sequence at sim time 10: the baby in reach, the player taps every beat dead on. */
async function playing(): Promise<{ sim: Sim; startedAt: number }> {
  const sim = await newSim();
  const world = sim.world;
  world.baby.xM = world.papa.xM - 3;
  world.baby.zM = world.papa.zM;
  world.baby.prevXM = world.baby.xM;
  world.baby.prevZM = world.baby.zM;
  world.baby.wanderAt = asSimMs(1_000_000);
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'lullaby_walk' });
  stepN(sim, 1);
  const startedAt = world.sequence.startedAt;
  for (const entry of BEAT_ENTRIES) {
    sim.enqueue({ type: 'TapBeat', t: asSimMs(startedAt + entry.offsetMs) });
  }
  return { sim, startedAt };
}

const { missWakePct: MISS_WAKE_PCT, decoyWakePct: DECOY_WAKE_PCT } =
  DEF.failure.kind === 'babyAwake'
    ? DEF.failure
    : { missWakePct: Number.NaN, decoyWakePct: Number.NaN };

/**
 * Like {@link playing}, but the player lets judged beat 2 go by and taps the decoy: the baby has
 * stirred twice and the decoy is spent when the snapshot is taken after it. `taps` are the stamps.
 */
async function playingStirred(): Promise<{ sim: Sim; startedAt: number; taps: number[] }> {
  const sim = await newSim();
  const world = sim.world;
  world.baby.xM = world.papa.xM - 3;
  world.baby.zM = world.papa.zM;
  world.baby.prevXM = world.baby.xM;
  world.baby.prevZM = world.baby.zM;
  world.baby.wanderAt = asSimMs(1_000_000);
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'lullaby_walk' });
  stepN(sim, 1);
  const startedAt = world.sequence.startedAt;
  const taps = BEAT_ENTRIES.filter((_, n) => n !== 2).map((entry) => startedAt + entry.offsetMs);
  taps.push(startedAt + DECOY_OFFSET);
  for (const t of taps) sim.enqueue({ type: 'TapBeat', t: asSimMs(t) });
  return { sim, startedAt, taps };
}

/** Steps `sim` to sim time `untilMs`. */
function stepTo(sim: Sim, untilMs: number): void {
  while (sim.world.time.sim < untilMs) stepN(sim, 1);
}

describe('the beat slice in a snapshot (story 4.5)', () => {
  const moments: readonly [string, (startedAt: number) => number][] = [
    ['in the count-in', (startedAt) => startedAt + (TIMELINE[1]?.offsetMs ?? 0) + 20],
    ['in an open window', (startedAt) => startedAt + (BEAT_ENTRIES[2]?.offsetMs ?? 0) - 40],
    ['just after a decoy', (startedAt) => startedAt + DECOY_OFFSET + 20],
  ];

  describe.each(moments)('taken %s', (_name, momentOf) => {
    it('restores to a copy that plays on to the same final world', async () => {
      const { sim: live, startedAt } = await playing();
      stepTo(live, momentOf(startedAt));
      expect(live.world.sequence.beat.isRunning).toBe(true);
      const snapshot = roundTrip(live);
      const copy = await newSim();
      copy.restore(snapshot);
      // The commands still pending are rebuilt from the journal, as for every snapshot.
      for (const entry of BEAT_ENTRIES) {
        const t = startedAt + entry.offsetMs;
        if (t > live.world.time.sim) copy.enqueue({ type: 'TapBeat', t: asSimMs(t) });
      }
      expect(hashJson(copy.world)).toBe(hashJson(live.world));
      stepTo(live, startedAt + STEP.durationMs + 200);
      stepTo(copy, startedAt + STEP.durationMs + 200);
      expect(live.world.sequence.id).toBeNull();
      expect(hashJson(copy.world)).toBe(hashJson(live.world));
    });
  });

  it('carries the cursors and the window of a step in flight', async () => {
    const live = (await playing()).sim;
    stepTo(live, 3500);
    const snapshot = roundTrip(live);
    const beat = beatOf(snapshot);
    expect(beat).toMatchObject({ isRunning: true });
    expect(beat.responseWindow).toMatchObject({ windowMs: 180, bufferMs: 0 });
    const copy = await newSim();
    copy.restore(snapshot);
    expect(copy.world.sequence.beat).toEqual(live.world.sequence.beat);
  });

  it('carries the wake of a baby who stirred and a decoy already spent, and plays on identically', async () => {
    const { sim: live, startedAt, taps } = await playingStirred();
    stepTo(live, startedAt + DECOY_OFFSET + 20);
    // A missed beat (25) and a tap on the decoy (40): nothing here is the zero a clean walk leaves.
    expect(live.world.sequence.beat.wakePct).toBe(MISS_WAKE_PCT + DECOY_WAKE_PCT);
    expect(live.world.sequence.beat.isDecoySpent).toBe(true);
    const snapshot = roundTrip(live);
    expect(beatOf(snapshot)).toMatchObject({
      wakePct: MISS_WAKE_PCT + DECOY_WAKE_PCT,
      isDecoySpent: true,
    });
    const copy = await newSim();
    copy.restore(snapshot);
    for (const t of taps) {
      if (t > live.world.time.sim) copy.enqueue({ type: 'TapBeat', t: asSimMs(t) });
    }
    expect(copy.world.sequence.beat).toEqual(live.world.sequence.beat);
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
    stepTo(live, startedAt + STEP.durationMs + 200);
    stepTo(copy, startedAt + STEP.durationMs + 200);
    expect(live.world.sequence.id).toBeNull();
    expect(hashJson(copy.world)).toBe(hashJson(live.world));
  });

  describe('refuses a slice that disagrees with itself or the timeline', () => {
    const broken: readonly [string, (beat: Loose) => void, RegExp][] = [
      ['a non-boolean isRunning', (b) => (b.isRunning = 1), /beat\.isRunning/],
      ['a stopped step', (b) => (b.isRunning = false), /beat\.isRunning/],
      ['a negative cueIndex', (b) => (b.cueIndex = -1), /beat\.cueIndex/],
      ['a cueIndex past the timeline', (b) => (b.cueIndex = 9999), /beat\.cueIndex/],
      ['a fractional cueIndex', (b) => (b.cueIndex = 1.5), /beat\.cueIndex/],
      ['a judgeIndex past the timeline', (b) => (b.judgeIndex = 9999), /beat\.judgeIndex/],
      ['a judgeIndex on a count-in entry', (b) => (b.judgeIndex = 0), /beat\.judgeIndex/],
      [
        'a judgeIndex on the decoy',
        (b) => (b.judgeIndex = TIMELINE.findIndex((e) => e.kind === 'decoy')),
        /beat\.judgeIndex/,
      ],
      ['a null nextBeatAt with a beat left', (b) => (b.nextBeatAt = null), /beat\.nextBeatAt/],
      ['a nextBeatAt that is not the beat’s', (b) => (b.nextBeatAt = 5), /beat\.nextBeatAt/],
      ['a NaN wakePct', (b) => (b.wakePct = Number.NaN), /beat\.wakePct/],
      ['a wakePct above 100', (b) => (b.wakePct = 101), /beat\.wakePct/],
      ['a negative wakePct', (b) => (b.wakePct = -1), /beat\.wakePct/],
      [
        'a spent decoy with no decoy before the beat',
        (b) => (b.isDecoySpent = true),
        /beat\.isDecoySpent/,
      ],
      ['a non-boolean isDecoySpent', (b) => (b.isDecoySpent = 'no'), /beat\.isDecoySpent/],
      [
        'an infinite window',
        (b) => ((b.responseWindow as Loose).windowMs = Number.POSITIVE_INFINITY),
        /beat\.responseWindow\.windowMs/,
      ],
      [
        'a negative buffer',
        (b) => ((b.responseWindow as Loose).bufferMs = -1),
        /beat\.responseWindow\.bufferMs/,
      ],
      ['a missing window', (b) => (b.responseWindow = null), /beat\.responseWindow/],
    ];

    it.each(broken)('%s', async (_name, damage, expected) => {
      const live = (await playing()).sim;
      stepTo(live, 300);
      const snapshot = roundTrip(live);
      damage(beatOf(snapshot));
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(expected);
    });

    it('a beat slice left running after the sequence ended', async () => {
      const { sim, startedAt } = await playing();
      stepTo(sim, startedAt + STEP.durationMs + 200);
      const snapshot = roundTrip(sim);
      beatOf(snapshot).isRunning = true;
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(/beat\.isRunning/);
    });

    it('a wake left over after the sequence ended', async () => {
      const { sim, startedAt } = await playing();
      stepTo(sim, startedAt + STEP.durationMs + 200);
      const snapshot = roundTrip(sim);
      beatOf(snapshot).wakePct = 30;
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(/beat\.wakePct/);
    });

    it('a missing beat slice', async () => {
      const snapshot = roundTrip(await newSim());
      delete (snapshot.world.sequence as unknown as Loose).beat;
      const target = await newSim();
      expect(() => target.restore(snapshot)).toThrow(/beat is missing/);
    });
  });
});
