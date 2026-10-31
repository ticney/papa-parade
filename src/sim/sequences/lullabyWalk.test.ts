import type { BeatsStep } from '@content/schemas/sequence';
import type { DifficultyTierId } from '@shared/constants';
import { LATE_TAP_GRACE_MS, STEP_MS } from '@shared/constants';
import { createRng, nextInt } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestLullabyWalk,
  createTestStayAwake,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
} from '../../../tests/support/testContent.ts';
import { createSim, createSimWithSystems, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { SYSTEMS } from '../step.ts';
import type { World } from '../world.ts';
import { beatTimelineOf } from './beatClock.ts';
import { isBeatStepRunning } from './lullabyWalk.ts';
import { failSequenceOnGag } from './sequenceEnd.ts';

// « Les 100 pas en rythme » (story 4.5), driving the real sim with the frozen short def of
// `tests/support/testLullaby.sequence.json`: 10 s, 90 → 60 BPM, a lead-in of 1 s, two count-in
// beats, a 180 ms window (the frozen feel adds a 60 ms tolerance: a tap is a hit within ±150 ms of
// a beat), one decoy after judged beat 4, and costs of 25 (miss), 40 (decoy) and 10 (stray).
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestLullabyWalk();
const STEP = DEF.steps[0] as BeatsStep;
const TIMELINE = beatTimelineOf(STEP);
const BEATS = TIMELINE.filter((entry) => entry.kind === 'beat');
const DECOY_INDEX = TIMELINE.findIndex((entry) => entry.kind === 'decoy');
const HIT_ZONE_MS = 90 + 60; // half the window plus the tolerance of the frozen feel
const COST = { missed: 25, decoy: 40, stray: 10 };

const worldOf = (sim: Sim) => sim.world as World;
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
const typesOf = (events: readonly SimEvent[]) => events.map((event) => event.type);

interface Options {
  def?: typeof DEF;
  gauges?: Parameters<typeof createTestLevel>[0] extends infer O
    ? O extends { gauges?: infer G }
      ? G
      : never
    : never;
  durationMs?: number;
  tier?: DifficultyTierId;
  lagMs?: number;
  seed?: number;
}

interface Running {
  sim: Sim;
  /** When the sequence started, in sim time. */
  startedAt: number;
  /** The events of the start step. */
  events: SimEvent[];
}

/** The absolute time of judged beat `n`. */
const beatAtOf = (run: Running, n: number): number =>
  run.startedAt + (BEATS[n]?.offsetMs ?? Number.NaN);
const decoyAtOf = (run: Running): number =>
  run.startedAt + (TIMELINE[DECOY_INDEX]?.offsetMs ?? Number.NaN);

function stepEvents(sim: Sim, n = 1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

/** Steps until the sim clock reaches `untilMs` (the first step whose end is at or after it). */
function runTo(sim: Sim, untilMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (worldOf(sim).time.sim < untilMs) events.push(...stepEvents(sim));
  return events;
}

const tap = (sim: Sim, t: number) => sim.enqueue({ type: 'TapBeat', t: asSimMs(t) });

async function started({
  def = DEF,
  gauges = {},
  durationMs,
  tier,
  lagMs,
  seed = 1,
}: Options = {}): Promise<Running> {
  const sim = await createSim({
    content,
    geometry,
    level: createTestLevel({
      gauges,
      carry: CARRY,
      sequences: [def.id],
      sequenceDefs: { [def.id]: def },
      ...(durationMs === undefined ? {} : { durationMs }),
    }),
    seed,
  });
  const world = worldOf(sim);
  world.baby.xM = world.papa.xM - 3;
  world.baby.zM = world.papa.zM;
  world.baby.prevXM = world.baby.xM;
  world.baby.prevZM = world.baby.zM;
  world.baby.wanderAt = asSimMs(1_000_000);
  if (tier !== undefined) sim.enqueue({ type: 'SetDifficultyTier', t: asSimMs(0), tier });
  if (lagMs !== undefined) sim.enqueue({ type: 'SetInputLag', t: asSimMs(0), lagMs });
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: def.id });
  const events = stepEvents(sim);
  return { sim, startedAt: world.sequence.startedAt, events };
}

/** Taps every judged beat dead on, up front (each command waits for its own step). */
function tapEveryBeat(run: Running, onlyBefore = Number.POSITIVE_INFINITY): void {
  BEATS.forEach((_, n) => {
    if (n < onlyBefore) tap(run.sim, beatAtOf(run, n));
  });
}

describe('the lullaby walk: starting (story 4.5)', () => {
  it('starts with the beat slice running, the first judged beat next, and nobody stirred', async () => {
    const run = await started();
    const world = worldOf(run.sim);
    expect(typesOf(run.events)).toContain('SequenceStarted');
    expect(ofType(run.events, 'SequenceStepStarted')).toEqual([
      { type: 'SequenceStepStarted', t: run.startedAt, id: 'lullaby_walk', stepIndex: 0 },
    ]);
    expect(isBeatStepRunning(world)).toBe(true);
    expect(world.sequence.beat.judgeIndex).toBe(TIMELINE.findIndex((e) => e.kind === 'beat'));
    expect(world.sequence.beat.nextBeatAt).toBe(beatAtOf(run, 0));
    expect(world.sequence.beat.wakePct).toBe(0);
    expect(world.sequence.beat.isDecoySpent).toBe(false);
    expect(world.baby.state).toBe('carried');
  });

  it('computes the first window through the tier and forces its buffer to 0', async () => {
    const normal = await started();
    // The frozen feel has a 100 ms buffer: a rhythm must not keep an early press.
    expect(content.feel.timing.bufferMs).toBeGreaterThan(0);
    expect(worldOf(normal.sim).sequence.beat.responseWindow).toMatchObject({
      windowMs: 180,
      bufferMs: 0,
      toleranceMs: content.feel.timing.toleranceMs,
    });
    const experienced = await started({ tier: 'experienced' });
    expect(worldOf(experienced.sim).sequence.beat.responseWindow.windowMs).toBe(180 * 0.75);
    const assisted = await started({ tier: 'assistance' });
    expect(worldOf(assisted.sim).sequence.beat.responseWindow.windowMs).toBe(180 * 1.5);
  });

  it('shrinks the window with fatigue, like a threat’s', async () => {
    const run = await started({ gauges: FATIGUE_GAUGES });
    const { penaltyPct } = { penaltyPct: content.feel.fatigue.windowPenaltyPct };
    const sim = run.sim;
    sim.enqueue({ type: 'SetFatigue', t: asSimMs(0), points: 100 });
    // The window of the NEXT beat reads the fatigue: hit beat 0, then look at beat 1's window.
    tap(sim, beatAtOf(run, 0));
    runTo(sim, beatAtOf(run, 0) + STEP_MS);
    expect(worldOf(sim).sequence.beat.responseWindow.windowMs).toBeCloseTo(
      180 * (1 - penaltyPct / 100),
      6,
    );
  });
});

describe('the lullaby walk: cues, hits and misses (story 4.5)', () => {
  it('announces every note at its time, the count-in with a null judged index, in order', async () => {
    const run = await started();
    tapEveryBeat(run);
    const events = runTo(run.sim, beatAtOf(run, 5) + 200);
    const cues = events.filter(
      (event) => event.type === 'BeatCued' || event.type === 'DecoyCued',
    ) as Extract<SimEvent, { type: 'BeatCued' | 'DecoyCued' }>[];
    // The first entries are the count-in (the start step already announced none: the lead-in is 1 s).
    expect(
      cues.slice(0, 2).map((cue) => (cue.type === 'BeatCued' ? cue.judgedIndex : 'x')),
    ).toEqual([null, null]);
    expect(cues.map((cue) => cue.entryIndex)).toEqual(cues.map((_, i) => i));
    for (const cue of cues) {
      const entry = TIMELINE[cue.entryIndex];
      const due = run.startedAt + (entry?.offsetMs ?? 0);
      // Announced at the first step at or after its time.
      expect(cue.t).toBe(Math.ceil(due / STEP_MS) * STEP_MS);
    }
    expect(cues.some((cue) => cue.type === 'DecoyCued')).toBe(true);
    const decoyCue = cues.find((cue) => cue.type === 'DecoyCued');
    expect(decoyCue?.entryIndex).toBe(DECOY_INDEX);
  });

  it('hits a tap dead on the beat, with an offset of 0, and moves on to the next beat', async () => {
    const run = await started();
    tap(run.sim, beatAtOf(run, 0));
    const events = runTo(run.sim, beatAtOf(run, 0) + 2 * STEP_MS);
    expect(ofType(events, 'BeatHit')).toEqual([
      { type: 'BeatHit', t: expect.any(Number), judgedIndex: 0, offsetMs: 0 },
    ]);
    expect(typesOf(events)).not.toContain('BabyStirred');
    expect(worldOf(run.sim).sequence.beat.nextBeatAt).toBe(beatAtOf(run, 1));
  });

  it('judges a tap on its own timestamp, not on the step that reaches the sim', async () => {
    const run = await started();
    const lateStepMs = beatAtOf(run, 0) + 120;
    runTo(run.sim, lateStepMs);
    // The finger came down 130 ms before the sim learns of it: `t` is early by 10 ms.
    tap(run.sim, beatAtOf(run, 0) - 10);
    const events = stepEvents(run.sim, 2);
    expect(ofType(events, 'BeatHit')[0]).toMatchObject({ judgedIndex: 0, offsetMs: -10 });
  });

  it('still announces a beat that was tapped early, at its time', async () => {
    const run = await started();
    tap(run.sim, beatAtOf(run, 0) - 140);
    const early = runTo(run.sim, beatAtOf(run, 0) - 100);
    expect(ofType(early, 'BeatHit')).toHaveLength(1);
    expect(ofType(early, 'BeatCued').filter((cue) => cue.judgedIndex === 0)).toEqual([]);
    const later = runTo(run.sim, beatAtOf(run, 0) + 20);
    expect(ofType(later, 'BeatCued').filter((cue) => cue.judgedIndex === 0)).toHaveLength(1);
  });

  it('misses a beat at the exact step its window, tolerance and late-tap grace close, with the stir right after', async () => {
    const run = await started();
    const closesAt = beatAtOf(run, 0) + HIT_ZONE_MS + LATE_TAP_GRACE_MS;
    const before = runTo(run.sim, closesAt - STEP_MS);
    expect(typesOf(before)).not.toContain('BeatMissed');
    const events = stepEvents(run.sim, 2);
    const firstStepEnd = Math.ceil(closesAt / STEP_MS) * STEP_MS;
    expect(ofType(events, 'BeatMissed')).toEqual([
      { type: 'BeatMissed', t: firstStepEnd, judgedIndex: 0 },
    ]);
    expect(ofType(events, 'BabyStirred')[0]).toEqual({
      type: 'BabyStirred',
      t: firstStepEnd,
      wakePct: COST.missed,
      deltaPct: COST.missed,
      reason: 'missed',
    });
    const types = typesOf(
      events.filter((e) => e.type === 'BeatMissed' || e.type === 'BabyStirred'),
    );
    expect(types).toEqual(['BeatMissed', 'BabyStirred']);
  });

  it('waits `lagMs` longer before it calls a miss (a stamp corrected into the past is late)', async () => {
    const run = await started({ lagMs: 100 });
    const closesAt = beatAtOf(run, 0) + HIT_ZONE_MS + LATE_TAP_GRACE_MS + 100;
    const before = runTo(run.sim, closesAt - STEP_MS);
    expect(typesOf(before)).not.toContain('BeatMissed');
    // A tap stamped 60 ms late still reaches the beat, 200 ms after the instant it names.
    tap(run.sim, beatAtOf(run, 0) + 60);
    const events = stepEvents(run.sim, 2);
    expect(ofType(events, 'BeatHit')[0]).toMatchObject({ judgedIndex: 0, offsetMs: 60 });
    expect(typesOf(events)).not.toContain('BeatMissed');
  });

  it('settles a tap that is too late as a miss: one tap never pays twice, at lagMs 0 too', async () => {
    const run = await started();
    const lateAt = beatAtOf(run, 0) + HIT_ZONE_MS + 2;
    runTo(run.sim, lateAt);
    // The window closed 2 ms ago, but the finger's stamp only reaches the sim now: the beat is
    // still open (the grace), so this tap is the miss and not a stray against the next beat.
    tap(run.sim, lateAt);
    const events = stepEvents(run.sim, 2);
    expect(ofType(events, 'BeatMissed')).toEqual([expect.objectContaining({ judgedIndex: 0 })]);
    expect(ofType(events, 'BabyStirred')).toEqual([
      expect.objectContaining({ reason: 'missed', wakePct: COST.missed }),
    ]);
    expect(typesOf(events)).not.toContain('BeatStrayTapped');
    expect(worldOf(run.sim).sequence.beat.nextBeatAt).toBe(beatAtOf(run, 1));
  });

  it('settles a tap that is too late as a miss under an input lag too', async () => {
    const run = await started({ lagMs: 400 });
    runTo(run.sim, beatAtOf(run, 0) + HIT_ZONE_MS + 20);
    tap(run.sim, beatAtOf(run, 0) + HIT_ZONE_MS + 10);
    const events = stepEvents(run.sim, 2);
    expect(ofType(events, 'BeatMissed')).toHaveLength(1);
    expect(ofType(events, 'BabyStirred')).toEqual([
      expect.objectContaining({ reason: 'missed', wakePct: COST.missed }),
    ]);
    expect(worldOf(run.sim).sequence.beat.nextBeatAt).toBe(beatAtOf(run, 1));
  });

  it('charges a tap stamped after the grace as a stray for the next beat: the miss was already called', async () => {
    const run = await started();
    const afterGraceAt = beatAtOf(run, 0) + HIT_ZONE_MS + LATE_TAP_GRACE_MS + 30;
    const before = runTo(run.sim, afterGraceAt);
    expect(ofType(before, 'BeatMissed')).toHaveLength(1);
    tap(run.sim, afterGraceAt);
    const events = stepEvents(run.sim, 2);
    expect(ofType(events, 'BeatStrayTapped')).toHaveLength(1);
    expect(ofType(events, 'BabyStirred').map((e) => [e.reason, e.wakePct])).toEqual([
      ['stray', COST.missed + COST.stray],
    ]);
  });

  it('still reads a tap on the decoy as the decoy when the input lag is large', async () => {
    const run = await started({ lagMs: 200 });
    tapEveryBeat(run, 5);
    // The stamp names the decoy's instant; with a lag it reaches the sim 200 ms after it.
    runTo(run.sim, decoyAtOf(run) + 200);
    tap(run.sim, decoyAtOf(run));
    const events = stepEvents(run.sim, 2);
    expect(ofType(events, 'DecoyTapped')).toHaveLength(1);
    expect(typesOf(events)).not.toContain('BeatMissed');
  });

  it('says nothing for a stray tap that costs 0: the event, no stir', async () => {
    const def = {
      ...DEF,
      failure: { kind: 'babyAwake' as const, missWakePct: 25, decoyWakePct: 40, strayWakePct: 0 },
    };
    const run = await started({ def });
    tap(run.sim, beatAtOf(run, 0));
    tap(run.sim, beatAtOf(run, 0) + 40);
    const events = runTo(run.sim, beatAtOf(run, 0) + 4 * STEP_MS);
    expect(ofType(events, 'BeatStrayTapped')).toHaveLength(1);
    expect(typesOf(events)).not.toContain('BabyStirred');
    expect(worldOf(run.sim).sequence.beat.wakePct).toBe(0);
  });

  it('applies the tier: a tap that is a hit at the normal tier is a miss at the experienced one', async () => {
    const offsetMs = 140;
    const normal = await started({ lagMs: 400 });
    tap(normal.sim, beatAtOf(normal, 0) + offsetMs);
    const hit = runTo(normal.sim, beatAtOf(normal, 0) + offsetMs + 2 * STEP_MS);
    expect(typesOf(hit)).toContain('BeatHit');
    const experienced = await started({ tier: 'experienced', lagMs: 400 });
    tap(experienced.sim, beatAtOf(experienced, 0) + offsetMs);
    const miss = runTo(experienced.sim, beatAtOf(experienced, 0) + offsetMs + 2 * STEP_MS);
    expect(typesOf(miss)).toContain('BeatMissed');
    expect(typesOf(miss)).not.toContain('BeatHit');
  });

  it('lets taps in the lead-in and the count-in go free: no event, no stir', async () => {
    const run = await started();
    for (let t = run.startedAt + 100; t < beatAtOf(run, 0) - 200; t += 150) tap(run.sim, t);
    const events = runTo(run.sim, beatAtOf(run, 0) - 160);
    expect(typesOf(events).filter((type) => type !== 'BeatCued')).toEqual([]);
    expect(worldOf(run.sim).sequence.beat.wakePct).toBe(0);
  });

  it('costs a stray tap: a second tap in a window already hit, and one between windows', async () => {
    const run = await started();
    tap(run.sim, beatAtOf(run, 0));
    tap(run.sim, beatAtOf(run, 0) + 40);
    const events = runTo(run.sim, beatAtOf(run, 0) + 4 * STEP_MS);
    expect(ofType(events, 'BeatHit')).toHaveLength(1);
    expect(ofType(events, 'BeatStrayTapped')).toHaveLength(1);
    expect(ofType(events, 'BabyStirred')).toEqual([
      expect.objectContaining({ reason: 'stray', wakePct: COST.stray, deltaPct: COST.stray }),
    ]);
    tap(run.sim, (beatAtOf(run, 0) + beatAtOf(run, 1)) / 2);
    const between = runTo(run.sim, (beatAtOf(run, 0) + beatAtOf(run, 1)) / 2 + 2 * STEP_MS);
    expect(ofType(between, 'BabyStirred')).toEqual([
      expect.objectContaining({ reason: 'stray', wakePct: 2 * COST.stray }),
    ]);
  });

  it('costs a tap on the decoy, once; a second tap on it is a stray', async () => {
    const run = await started();
    tapEveryBeat(run, 5);
    tap(run.sim, decoyAtOf(run));
    tap(run.sim, decoyAtOf(run) + 30);
    const events = runTo(run.sim, decoyAtOf(run) + 4 * STEP_MS);
    expect(ofType(events, 'DecoyTapped')).toEqual([
      { type: 'DecoyTapped', t: expect.any(Number), entryIndex: DECOY_INDEX },
    ]);
    expect(ofType(events, 'BeatStrayTapped')).toHaveLength(1);
    expect(ofType(events, 'BabyStirred').map((e) => [e.reason, e.wakePct])).toEqual([
      ['decoy', COST.decoy],
      ['stray', COST.decoy + COST.stray],
    ]);
    expect(worldOf(run.sim).sequence.beat.isDecoySpent).toBe(true);
  });

  it('clears the spent decoy once the next beat is settled', async () => {
    const run = await started();
    tapEveryBeat(run, 6);
    tap(run.sim, decoyAtOf(run));
    runTo(run.sim, beatAtOf(run, 5) + 2 * STEP_MS);
    expect(worldOf(run.sim).sequence.beat.isDecoySpent).toBe(false);
  });
});

describe('the lullaby walk: waking and winning (story 4.5)', () => {
  it('wakes the baby at 100: events in order, the sequence lost, the flow back to playing, nothing else', async () => {
    const run = await started();
    const events = runTo(run.sim, beatAtOf(run, 3) + 400);
    const names = events
      .filter((event) =>
        ['BeatMissed', 'BabyStirred', 'BabyWoke', 'SequenceEnded', 'PapaSnored'].includes(
          event.type,
        ),
      )
      .map((event) => event.type);
    expect(names).toEqual([
      'BeatMissed',
      'BabyStirred',
      'BeatMissed',
      'BabyStirred',
      'BeatMissed',
      'BabyStirred',
      'BeatMissed',
      'BabyStirred',
      'BabyWoke',
      'SequenceEnded',
    ]);
    expect(ofType(events, 'BabyStirred').map((e) => e.wakePct)).toEqual([25, 50, 75, 100]);
    expect(ofType(events, 'SequenceEnded')[0]).toMatchObject({ outcome: 'failed' });
    const world = worldOf(run.sim);
    expect(world.flow.state).toBe('playing');
    expect(world.sequence.id).toBeNull();
    expect(world.sequence.beat).toMatchObject({ isRunning: false, wakePct: 0, nextBeatAt: null });
    // The baby woke, he did not cry; and Papa made no noise (D5).
    expect(world.baby.state).toBe('carried');
    expect(typesOf(events)).not.toContain('PapaSnored');
  });

  it('adds no noise when the baby wakes: the noise gauge stays at rest', async () => {
    const run = await started({ gauges: NOISE_GAUGES });
    const events = runTo(run.sim, beatAtOf(run, 3) + 400);
    expect(typesOf(events)).toContain('BabyWoke');
    expect(typesOf(events)).not.toContain('NoiseChanged');
    expect(worldOf(run.sim).gauges.noisePct).toBe(0);
  });

  it('does not judge the commands left in the step that woke him', async () => {
    // A stray wakes him at once (100), so that the taps after it, all in the same step, are left.
    const def = {
      ...DEF,
      failure: {
        kind: 'babyAwake' as const,
        missWakePct: 25,
        decoyWakePct: 40,
        strayWakePct: 100,
      },
    };
    const run = await started({ def });
    runTo(run.sim, beatAtOf(run, 0) + 120);
    tap(run.sim, beatAtOf(run, 0)); // a hit
    tap(run.sim, beatAtOf(run, 0) + 40); // a stray: he wakes
    tap(run.sim, beatAtOf(run, 0) + 60); // would be a second stray
    tap(run.sim, beatAtOf(run, 0) + 80); // and a third
    const events = stepEvents(run.sim);
    expect(ofType(events, 'BeatHit')).toHaveLength(1);
    expect(ofType(events, 'BeatStrayTapped')).toHaveLength(1);
    expect(ofType(events, 'BabyStirred')).toEqual([
      expect.objectContaining({ reason: 'stray', wakePct: 100, deltaPct: 100 }),
    ]);
    expect(ofType(events, 'BabyWoke')).toHaveLength(1);
    expect(ofType(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({ outcome: 'failed' }),
    ]);
    expect(worldOf(run.sim).flow.state).toBe('playing');
  });

  it('wins when every beat is tapped: SequenceEnded succeeded at the end of the step, the baby carried', async () => {
    const run = await started();
    tapEveryBeat(run);
    const events = runTo(run.sim, run.startedAt + STEP.durationMs + 100);
    expect(ofType(events, 'BeatHit')).toHaveLength(BEATS.length);
    expect(typesOf(events)).not.toContain('BabyStirred');
    expect(ofType(events, 'SequenceEnded')).toEqual([
      {
        type: 'SequenceEnded',
        t: run.startedAt + STEP.durationMs,
        id: 'lullaby_walk',
        outcome: 'succeeded',
      },
    ]);
    const world = worldOf(run.sim);
    expect(world.flow.state).toBe('playing');
    expect(world.baby.state).toBe('carried');
    expect(world.sequence.beat.isRunning).toBe(false);
  });

  it('wins only once the last beat is settled, even when its miss comes after the end of the step', async () => {
    const run = await started({ lagMs: 600 });
    tapEveryBeat(run, BEATS.length - 1);
    const lastAt = beatAtOf(run, BEATS.length - 1);
    const events = runTo(run.sim, lastAt + HIT_ZONE_MS + 600 + 100);
    const order = events
      .filter((event) => event.type === 'BeatMissed' || event.type === 'SequenceEnded')
      .map((event) => event.type);
    expect(order).toEqual(['BeatMissed', 'SequenceEnded']);
    expect(ofType(events, 'SequenceEnded')[0]?.t).toBeGreaterThanOrEqual(
      run.startedAt + STEP.durationMs,
    );
    expect(ofType(events, 'SequenceEnded')[0]?.outcome).toBe('succeeded');
  });

  it('is cut by the end of the level: SequenceEnded levelEnded, the slice clear, no resume', async () => {
    const run = await started({ durationMs: 3000 });
    const events = runTo(run.sim, 3100);
    expect(ofType(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({ outcome: 'levelEnded' }),
    ]);
    const world = worldOf(run.sim);
    expect(world.flow.state).toBe('ended');
    expect(world.sequence.beat).toMatchObject({ isRunning: false, nextBeatAt: null, wakePct: 0 });
  });

  it('draws nothing from world.rng, whatever the taps do', async () => {
    const run = await started();
    const world = worldOf(run.sim);
    const before = structuredClone(world.rng);
    tapEveryBeat(run, 5);
    tap(run.sim, decoyAtOf(run));
    tap(run.sim, beatAtOf(run, 6) + 400);
    // Up to the step the sequence ends (the baby wakes at the missed beats): what normal play draws
    // after it (a wander, the cry in the arms) is not the step's.
    const events: SimEvent[] = [];
    while (world.sequence.id !== null) events.push(...stepEvents(run.sim));
    expect(typesOf(events)).toContain('DecoyTapped');
    expect(typesOf(events)).toContain('SequenceEnded');
    expect(world.rng).toEqual(before);
  });

  it('does not stretch anything but the clock in a slow-mo: the same events at the same sim times', async () => {
    const plain = await started();
    const slow = await started();
    slow.sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0.3 });
    for (const run of [plain, slow]) {
      tapEveryBeat(run, 5);
      tap(run.sim, decoyAtOf(run));
    }
    const keep = (events: SimEvent[]) =>
      events.filter((event) => /^(Beat|Decoy|Baby|Sequence)/.test(event.type));
    const a = keep(runTo(plain.sim, plain.startedAt + STEP.durationMs + 100));
    const b = keep(runTo(slow.sim, slow.startedAt + STEP.durationMs + 100));
    expect(b).toEqual(a);
  });
});

describe('the lullaby walk under random taps (story 4.5)', () => {
  it('keeps wakePct in [0, 100], throws no invariant and ends in a coherent flow, for 30 seeds', async () => {
    for (let seed = 1; seed <= 30; seed++) {
      const rng = createRng(seed);
      const run = await started({ seed });
      const world = worldOf(run.sim);
      // Dense and uneven: up to 40 taps anywhere in the step, in no order (a real input is sorted).
      const count = nextInt(rng, 5, 40);
      for (let i = 0; i < count; i++) {
        tap(run.sim, run.startedAt + nextInt(rng, 0, STEP.durationMs));
      }
      let lastWake = 0;
      while (world.time.sim < run.startedAt + STEP.durationMs + 1500) {
        stepEvents(run.sim);
        const { beat } = world.sequence;
        expect(beat.wakePct, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(beat.wakePct, `seed ${seed}`).toBeLessThan(100);
        // The wake never goes back down while the step runs, and a clear slice is all clear.
        if (beat.isRunning) {
          expect(beat.wakePct, `seed ${seed}`).toBeGreaterThanOrEqual(lastWake);
          lastWake = beat.wakePct;
        } else {
          expect(beat.wakePct).toBe(0);
          expect(beat.nextBeatAt).toBeNull();
          lastWake = 0;
        }
        expect(world.flow.state === 'sequence', `seed ${seed}`).toBe(world.sequence.id !== null);
      }
      expect(world.sequence.id, `seed ${seed}`).toBeNull();
      const copy = await createSim({
        content,
        geometry,
        level: createTestLevel({ carry: CARRY, sequences: [DEF.id] }),
        seed,
      });
      expect(() => copy.restore(run.sim.snapshot())).not.toThrow();
    }
  });
});

describe('the gag and the walk (story 4.5)', () => {
  /** Calls `failSequenceOnGag` once, from inside a step, as `gagThreat` does. */
  async function withGagAt(stepAt: number, def: typeof DEF) {
    let calls = 0;
    const sim = await createSimWithSystems(
      {
        content,
        geometry,
        level: createTestLevel({
          carry: CARRY,
          gauges: FATIGUE_GAUGES,
          sequences: [def.id],
          sequenceDefs: { [def.id]: def },
        }),
        seed: 1,
      },
      [
        ...SYSTEMS,
        (world, ctx) => {
          if (world.time.sim === stepAt) {
            calls += 1;
            failSequenceOnGag(world, ctx);
          }
        },
      ],
    );
    const world = worldOf(sim);
    world.baby.xM = world.papa.xM - 3;
    world.baby.zM = world.papa.zM;
    world.baby.prevXM = world.baby.xM;
    world.baby.prevZM = world.baby.zM;
    world.baby.wanderAt = asSimMs(1_000_000);
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: def.id });
    const events: SimEvent[] = [];
    while (world.time.sim <= stepAt + STEP_MS) events.push(...stepEvents(sim));
    return { sim, events, calls };
  }

  it('does not end a babyAwake sequence: only the baby waking does', async () => {
    const { sim, events, calls } = await withGagAt(500, DEF);
    expect(calls).toBe(1);
    expect(typesOf(events)).not.toContain('SequenceEnded');
    expect(worldOf(sim).flow.state).toBe('sequence');
    expect(worldOf(sim).sequence.beat.isRunning).toBe(true);
  });

  it('still ends « Rester éveillé » on a gag, with the snore', async () => {
    const { events } = await withGagAt(500, createTestStayAwake());
    expect(
      typesOf(events).filter((type) => ['PapaSnored', 'BabyWoke', 'SequenceEnded'].includes(type)),
    ).toEqual(['PapaSnored', 'BabyWoke', 'SequenceEnded']);
    expect(ofType(events, 'SequenceEnded')[0]).toMatchObject({ outcome: 'failed' });
  });
});
