import type { SequenceDef } from '@content/schemas/sequence';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBedtimeDuel,
  createTestBedtimeEyes,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
} from '../../../tests/support/testContent.ts';
import { createSim, createSimWithSystems, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { SYSTEMS } from '../step.ts';
import type { ThreatInstance, World } from '../world.ts';
import {
  type DuelThreatShape,
  duelLimitsOf,
  isDuelStepRunning,
  sequenceDuelProblems,
} from './bedtimeDuel.ts';
import { advanceSequenceOnResolve, failSequenceOnGag, goToSequenceStep } from './sequenceEnd.ts';

// « Duel du coucher » (story 4.6), driving the real sim with the frozen def of
// `tests/support/testBedtimeDuel.sequence.json`: three rounds of 8 s, 1 s of rest each, three
// retreats to lose, and the frozen eyes (800 ms of telegraph, then 2000 to 4000 ms to the signal).
const content = createTestContent();
const geometry = createTestGeometry();
const DEF = createTestBedtimeDuel();
const EYES = createTestBedtimeEyes();
const REST_MS = DEF.steps[0]?.kind === 'duel' ? DEF.steps[0].restMs : Number.NaN;
const MAX_RETREATS = DEF.failure.kind === 'retreats' ? DEF.failure.maxRetreats : Number.NaN;
const { resumeGapMs } = content.feel.sequences;

const worldOf = (sim: Sim) => sim.world as World;
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
const typesOf = (events: readonly SimEvent[]) => events.map((event) => event.type);
const eyesOf = (sim: Sim): ThreatInstance => {
  const eyes = worldOf(sim).threats.find((threat) => threat.defId === EYES.id);
  if (eyes === undefined) throw new Error('the level has no eyes');
  return eyes;
};

interface Options {
  def?: SequenceDef;
  durationMs?: number;
  gauges?: Parameters<typeof createTestLevel>[0] extends infer O
    ? O extends { gauges?: infer G }
      ? G
      : never
    : never;
  seed?: number;
}

function stepEvents(sim: Sim, n = 1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

/** Steps until the sim clock reaches `untilMs`. */
function runTo(sim: Sim, untilMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (worldOf(sim).time.sim < untilMs) events.push(...stepEvents(sim));
  return events;
}

/** Steps until `isDone` (bounded: a hang fails the test). */
function runUntil(sim: Sim, isDone: () => boolean, maxSteps = 3000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !isDone(); i++) events.push(...stepEvents(sim));
  expect(isDone()).toBe(true);
  return events;
}

async function started({ def = DEF, durationMs, gauges = {}, seed = 1 }: Options = {}) {
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
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: def.id });
  const events = stepEvents(sim);
  return { sim, startedAt: world.sequence.startedAt, events };
}

/** Steps until the next round is telegraphed; returns its events and the instant of its signal. */
function untilTelegraphed(sim: Sim) {
  const eyes = eyesOf(sim);
  const events = runUntil(sim, () => eyes.state === 'telegraph');
  return { events, signalAt: eyes.windowOpenAt };
}

type Answer = 'centre' | 'early' | 'late' | 'held' | 'none';

/** Answers the round that is telegraphed, then runs until it is settled (resolved or gagged). */
function answerRound(sim: Sim, how: Answer): SimEvent[] {
  const eyes = eyesOf(sim);
  const signalAt = eyes.windowOpenAt;
  const centre = signalAt + (eyes.responseWindow?.windowMs ?? 0) / 2;
  if (how === 'centre') {
    sim.enqueue({ type: 'PressThreat', t: asSimMs(centre), threatId: eyes.id });
    sim.enqueue({ type: 'Release', t: asSimMs(centre + 50) });
  } else if (how === 'early') {
    sim.enqueue({ type: 'PressThreat', t: asSimMs(signalAt - 200), threatId: eyes.id });
    sim.enqueue({ type: 'Release', t: asSimMs(signalAt - 150) });
  } else if (how === 'late') {
    // After the window and its tolerance: the expiry gags it first, whatever comes.
  } else if (how === 'held') {
    sim.enqueue({ type: 'PressThreat', t: asSimMs(centre), threatId: eyes.id });
  }
  return runUntil(sim, () => eyes.state === 'resolved' || eyes.state === 'gag');
}

/** A whole round: wait for the telegraph, answer it. */
function playRound(sim: Sim, how: Answer): SimEvent[] {
  const { events } = untilTelegraphed(sim);
  return [...events, ...answerRound(sim, how)];
}

describe('the bedtime duel: starting (story 4.6)', () => {
  it('starts the duel slice with the rest running, the baby carried and no round yet', async () => {
    const { sim, events, startedAt } = await started();
    const world = worldOf(sim);
    expect(typesOf(events)).toContain('SequenceStarted');
    expect(ofType(events, 'SequenceStepStarted')).toEqual([
      { type: 'SequenceStepStarted', t: startedAt, id: 'bedtime_duel', stepIndex: 0 },
    ]);
    expect(isDuelStepRunning(world)).toBe(true);
    expect(world.sequence.duel).toEqual({
      isRunning: true,
      nextRoundAt: startedAt + REST_MS,
      retreats: 0,
    });
    expect(world.baby.state).toBe('carried');
    expect(eyesOf(sim).state).toBe('idle');
    expect(typesOf(events)).not.toContain('ThreatTelegraphed');
  });

  it('telegraphs the first round only when the rest is over', async () => {
    const { sim, startedAt } = await started();
    const quiet = runTo(sim, startedAt + REST_MS - STEP_MS);
    expect(typesOf(quiet)).not.toContain('ThreatTelegraphed');
    const events = runTo(sim, startedAt + REST_MS + STEP_MS);
    expect(ofType(events, 'ThreatTelegraphed')).toEqual([
      expect.objectContaining({ kind: 'bedtime_eyes', waveIndex: -1 }),
    ]);
    expect(worldOf(sim).sequence.duel.nextRoundAt).toBeNull();
  });

  it('is not telegraphed when it could not be judged before the end of the level: the duel is lost at once', async () => {
    // 1 s of rest + 800 + 4000 + the window and the tolerance does not fit in 3 s.
    const { sim, startedAt } = await started({ durationMs: 3000 });
    const events = runTo(sim, 3000 + STEP_MS);
    expect(typesOf(events)).not.toContain('ThreatTelegraphed');
    // Not held until the level ends: the sequence fails when the first round was due, and the baby sleeps on.
    expect(ofType(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({
        id: 'bedtime_duel',
        outcome: 'failed',
        t: expect.any(Number),
      }),
    ]);
    const ended = ofType(events, 'SequenceEnded')[0];
    expect(ended?.t).toBeLessThan(startedAt + REST_MS + 2 * STEP_MS);
    expect(typesOf(events)).not.toContain('BabyWoke');
    expect(worldOf(sim).flow.state).not.toBe('sequence');
    expect(worldOf(sim).sequence.duel.isRunning).toBe(false);
  });

  it('a late round (after a win) that can no longer fit also loses the duel', async () => {
    // Two rounds' worth of level: the first is played, the second no longer fits.
    const { sim } = await started({ durationMs: 9000 });
    const first = playRound(sim, 'centre');
    expect(typesOf(first)).toContain('SequenceStepStarted');
    const events = runTo(sim, 9000 + STEP_MS);
    expect(typesOf(events)).not.toContain('ThreatTelegraphed');
    expect(ofType(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bedtime_duel', outcome: 'failed' }),
    ]);
  });

  it('a press during a rest changes nothing', async () => {
    const { sim, startedAt } = await started();
    const eyes = eyesOf(sim);
    sim.enqueue({ type: 'PressThreat', t: asSimMs(startedAt + 100), threatId: eyes.id });
    sim.enqueue({ type: 'Release', t: asSimMs(startedAt + 150) });
    const events = runTo(sim, startedAt + REST_MS - STEP_MS);
    const settled = ['ResponseResolved', 'GagTriggered', 'SequenceStepRetreated'];
    expect(events.filter((event) => settled.includes(event.type))).toEqual([]);
    expect(eyes.state).toBe('idle');
    expect(worldOf(sim).sequence.duel.retreats).toBe(0);
    expect(worldOf(sim).sequence.stepIndex).toBe(0);
  });
});

describe('the bedtime duel: won (story 4.6)', () => {
  it('plays the whole event order of a won duel, three rounds, and puts the flow back to playing', async () => {
    const { sim, startedAt } = await started();
    const all: SimEvent[] = [];
    for (let round = 0; round < DEF.steps.length; round++) all.push(...playRound(sim, 'centre'));
    all.push(...stepEvents(sim));
    const sequence = all.filter((event) =>
      [
        'ThreatTelegraphed',
        'WaitSignalGiven',
        'WindowOpened',
        'ResponseResolved',
        'SequenceStepStarted',
        'SequenceEnded',
        'SequenceStepRetreated',
        'BabyWoke',
      ].includes(event.type),
    );
    const round = (next: number | null) => [
      'ThreatTelegraphed',
      'WaitSignalGiven',
      'WindowOpened',
      'ResponseResolved',
      ...(next === null ? ['SequenceEnded'] : ['SequenceStepStarted']),
    ];
    expect(typesOf(sequence)).toEqual([...round(1), ...round(2), ...round(null)]);
    expect(ofType(all, 'SequenceStepStarted').map((event) => event.stepIndex)).toEqual([1, 2]);
    expect(ofType(all, 'ResponseResolved')).toEqual(
      Array(3).fill(expect.objectContaining({ response: 'wait', quality: 'perfect', offsetMs: 0 })),
    );
    expect(ofType(all, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bedtime_duel', outcome: 'succeeded' }),
    ]);
    const world = worldOf(sim);
    expect(world.flow.state).toBe('playing');
    expect(world.sequence.id).toBeNull();
    expect(world.sequence.duel).toEqual({ isRunning: false, nextRoundAt: null, retreats: 0 });
    expect(world.baby.state).toBe('carried');
    expect(world.sequence.startedAt).toBe(startedAt);
  });

  it('gives the signal and the window at the same time, signal first', async () => {
    const { sim } = await started();
    const events = playRound(sim, 'centre');
    const signal = ofType(events, 'WaitSignalGiven')[0];
    const opened = ofType(events, 'WindowOpened')[0];
    expect(signal?.t).toBe(opened?.t);
    expect(events.indexOf(signal as SimEvent)).toBe(events.indexOf(opened as SimEvent) - 1);
  });

  it('counts a won round as a response for the combo and the perfects', async () => {
    const { sim } = await started();
    playRound(sim, 'centre');
    expect(worldOf(sim).score.perfects).toBe(1);
    expect(worldOf(sim).combo.multiplier).toBeGreaterThan(content.feel.combo.minMultiplier);
  });

  it('never wins by waiting past endsAt', async () => {
    // A def that can be failed a thousand times: only time passes, and a result alone may win it.
    const forgiving: SequenceDef = { ...DEF, failure: { kind: 'retreats', maxRetreats: 1000 } };
    const { sim } = await started({ def: forgiving });
    const world = worldOf(sim);
    runTo(sim, world.time.sim + 5 * STEP_MS);
    // The end is an estimate that a retreat keeps moving: put it in the past and keep waiting.
    world.sequence.stepEndsAt = asSimMs(world.sequence.startedAt);
    world.sequence.endsAt = asSimMs(world.sequence.startedAt);
    expect(world.time.sim).toBeGreaterThan(world.sequence.endsAt);
    const events = runTo(sim, world.time.sim + 20_000);
    expect(ofType(events, 'SequenceEnded')).toEqual([]);
    expect(world.flow.state).toBe('sequence');
    expect(ofType(events, 'SequenceStepRetreated').length).toBeGreaterThan(2);
  });
});

describe('the bedtime duel: retreats (story 4.6)', () => {
  it.each<[Answer, string]>([
    ['early', 'early'],
    ['late', 'late'],
    ['held', 'wrongResponse'],
  ])('a %s answer steps back one step', async (how, reason) => {
    const { sim } = await started();
    playRound(sim, 'centre');
    expect(worldOf(sim).sequence.stepIndex).toBe(1);
    const events = playRound(sim, how);
    expect(ofType(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_eyes_reopened', reason }),
    ]);
    expect(ofType(events, 'SequenceStepRetreated')).toEqual([
      {
        type: 'SequenceStepRetreated',
        t: expect.any(Number),
        id: 'bedtime_duel',
        fromStepIndex: 1,
        stepIndex: 0,
        retreats: 1,
        reason,
      },
    ]);
    expect(ofType(events, 'SequenceStepStarted').map((event) => event.stepIndex)).toEqual([0]);
    const world = worldOf(sim);
    expect(world.sequence.stepIndex).toBe(0);
    expect(world.sequence.duel.retreats).toBe(1);
    expect(world.flow.state).toBe('sequence');
  });

  it('a retreat at step 0 stays at step 0 and still counts', async () => {
    const { sim } = await started();
    const events = playRound(sim, 'early');
    expect(ofType(events, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({ fromStepIndex: 0, stepIndex: 0, retreats: 1 }),
    ]);
    expect(worldOf(sim).sequence.stepIndex).toBe(0);
    expect(worldOf(sim).sequence.duel.retreats).toBe(1);
  });

  it('restarts the rest and draws a new signal after a retreat', async () => {
    const { sim } = await started();
    const first = untilTelegraphed(sim);
    answerRound(sim, 'early');
    const world = worldOf(sim);
    const retreatedAt = world.time.sim;
    expect(world.sequence.duel.nextRoundAt).toBe(retreatedAt + REST_MS);
    const second = untilTelegraphed(sim);
    const telegraphs = ofType(second.events, 'ThreatTelegraphed');
    expect(telegraphs).toHaveLength(1);
    expect(telegraphs[0]?.t).toBeGreaterThanOrEqual(retreatedAt + REST_MS);
    // A new draw: the instant is relative to its own telegraph, and (seed 1) is not the first one's offset.
    const offsetOf = (signalAt: number, telegraphedAt: number) => signalAt - telegraphedAt;
    const firstTelegraph = first.events.find((event) => event.type === 'ThreatTelegraphed');
    expect(offsetOf(second.signalAt, telegraphs[0]?.t ?? 0)).not.toBe(
      offsetOf(first.signalAt, firstTelegraph?.t ?? 0),
    );
  });

  it('keeps the retreats across a step change', async () => {
    const { sim } = await started();
    playRound(sim, 'early');
    expect(worldOf(sim).sequence.duel.retreats).toBe(1);
    playRound(sim, 'centre');
    expect(worldOf(sim).sequence.stepIndex).toBe(1);
    expect(worldOf(sim).sequence.duel.retreats).toBe(1);
  });

  it('makes no noise and no cry on a retreat', async () => {
    const { sim } = await started({ gauges: NOISE_GAUGES });
    const events = playRound(sim, 'early');
    expect(ofType(events, 'SequenceStepRetreated')).toHaveLength(1);
    expect(typesOf(events)).not.toContain('NoiseChanged');
    expect(typesOf(events)).not.toContain('BabyCrying');
    expect(worldOf(sim).gauges.noisePct).toBe(0);
  });

  it('resets the combo and records the miss on a retreat', async () => {
    const { sim } = await started();
    playRound(sim, 'centre');
    expect(worldOf(sim).combo.multiplier).toBeGreaterThan(content.feel.combo.minMultiplier);
    const events = playRound(sim, 'early');
    expect(typesOf(events)).toContain('ComboChanged');
    expect(worldOf(sim).combo.multiplier).toBe(content.feel.combo.minMultiplier);
  });

  it('ends on the last allowed failure: BabyWoke, failed, back to playing, the baby still carried, the resume gap', async () => {
    const { sim } = await started();
    const all: SimEvent[] = [];
    for (let i = 0; i < MAX_RETREATS; i++) all.push(...playRound(sim, 'early'));
    all.push(...stepEvents(sim));
    expect(ofType(all, 'SequenceStepRetreated').map((event) => event.retreats)).toEqual(
      Array.from({ length: MAX_RETREATS - 1 }, (_, i) => i + 1),
    );
    const tail = all.filter((event) => ['BabyWoke', 'SequenceEnded'].includes(event.type));
    expect(typesOf(tail)).toEqual(['BabyWoke', 'SequenceEnded']);
    expect(ofType(all, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bedtime_duel', outcome: 'failed' }),
    ]);
    const world = worldOf(sim);
    expect(world.flow.state).toBe('playing');
    expect(world.sequence.id).toBeNull();
    expect(world.sequence.duel).toEqual({ isRunning: false, nextRoundAt: null, retreats: 0 });
    expect(world.baby.state).toBe('carried');
    const endedAt = world.sequence.endedAt ?? Number.NaN;
    expect(world.director.nextAt).toBeGreaterThanOrEqual(endedAt + resumeGapMs);
  });

  it('closes a round that is open when the level ends', async () => {
    const { sim } = await started({ gauges: NOISE_GAUGES });
    untilTelegraphed(sim);
    // Mama wakes mid-round: the level ends, the sequence with it.
    sim.enqueue({ type: 'SetNoise', t: asSimMs(worldOf(sim).time.sim), pct: 100 });
    const events = stepEvents(sim, 3);
    expect(ofType(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: 'bedtime_duel', outcome: 'levelEnded' }),
    ]);
    expect(worldOf(sim).sequence.duel).toEqual({
      isRunning: false,
      nextRoundAt: null,
      retreats: 0,
    });
  });
});

describe('the bedtime duel: the hooks (story 4.6)', () => {
  it('ignores a threat that is not the current step’s, on a win and on a gag', async () => {
    const sim = await createSimWithSystems(
      {
        content,
        geometry,
        level: createTestLevel({
          gauges: FATIGUE_GAUGES,
          carry: CARRY,
          sequences: ['bedtime_duel'],
        }),
        seed: 1,
      },
      [
        ...SYSTEMS,
        (world, ctx) => {
          if (world.time.sim !== 50) return;
          const other = world.threats.find((threat) => threat.defId === 'papa_microsleep');
          if (other === undefined) throw new Error('no micro-sleep');
          failSequenceOnGag(world, ctx, other, 'late');
          advanceSequenceOnResolve(world, ctx, other);
        },
      ],
    );
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bedtime_duel' });
    const events = stepEvents(sim, 8);
    expect(typesOf(events)).not.toContain('SequenceStepRetreated');
    expect(ofType(events, 'SequenceEnded')).toEqual([]);
    expect(worldOf(sim).sequence.stepIndex).toBe(0);
    expect(worldOf(sim).sequence.duel.retreats).toBe(0);
  });

  it('does nothing outside a sequence', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'] }),
      seed: 1,
    });
    const world = worldOf(sim);
    const events: SimEvent[] = [];
    const ctx = { events } as unknown as Parameters<typeof failSequenceOnGag>[1];
    failSequenceOnGag(world, ctx, eyesOf(sim), 'early');
    advanceSequenceOnResolve(world, ctx, eyesOf(sim));
    expect(events).toEqual([]);
  });

  it('goToSequenceStep writes the step, its end, the whole estimate and the next round', async () => {
    const { sim, events } = await started();
    expect(events).not.toEqual([]);
    const world = worldOf(sim);
    const ctx = { events: [] as SimEvent[] } as unknown as Parameters<typeof goToSequenceStep>[1];
    world.time.sim = asSimMs(4000);
    goToSequenceStep(world, ctx, DEF, 1);
    const total = DEF.steps.slice(1).reduce((sum, step) => sum + step.durationMs, 0);
    expect(world.sequence.stepIndex).toBe(1);
    expect(world.sequence.stepEndsAt).toBe(4000 + (DEF.steps[1]?.durationMs ?? 0));
    expect(world.sequence.endsAt).toBe(4000 + total);
    expect(world.sequence.duel.nextRoundAt).toBe(4000 + REST_MS);
    expect(world.sequence.startedAt).toBeLessThanOrEqual(world.sequence.stepEndsAt);
    expect((ctx as unknown as { events: SimEvent[] }).events).toEqual([
      { type: 'SequenceStepStarted', t: 4000, id: 'bedtime_duel', stepIndex: 1 },
    ]);
  });
});

describe('sequenceDuelProblems (story 4.6)', () => {
  const limits = duelLimitsOf(content.feel);
  const eyes = EYES as DuelThreatShape;
  const problemsOf = (
    def: SequenceDef,
    threats: Readonly<Record<string, DuelThreatShape>> = { bedtime_eyes: eyes },
  ) => sequenceDuelProblems(def, threats, limits);

  it('accepts the frozen duel', () => {
    expect(problemsOf(DEF)).toEqual([]);
  });

  it('refuses a threatDef that is not loaded', () => {
    expect(problemsOf(DEF, {})[0]).toMatch(/threatDef "bedtime_eyes" is not loaded/);
  });

  it('refuses a threat whose response is not wait', () => {
    expect(problemsOf(DEF, { bedtime_eyes: { ...eyes, response: 'parry' } })[0]).toMatch(
      /has the response "parry", but a duel asks for "wait"/,
    );
  });

  it('refuses a threat whose target is not papa', () => {
    expect(problemsOf(DEF, { bedtime_eyes: { ...eyes, target: 'anchor' } })[0]).toMatch(
      /has the target "anchor"/,
    );
  });

  it('refuses a durationMs below what a round can take', () => {
    const { windowMs, toleranceMs } = content.feel.timing;
    const widest = Math.max(
      ...Object.values(content.feel.difficulty).map((t) => t.windowMultiplier),
    );
    const neededMs = REST_MS + 800 + (EYES.maxDelayMs ?? 0) + windowMs * widest + toleranceMs;
    const withDuration = (durationMs: number): SequenceDef => ({
      ...DEF,
      steps: [{ kind: 'duel', durationMs, threatDef: 'bedtime_eyes', restMs: REST_MS }],
    });
    expect(problemsOf(withDuration(neededMs))).toEqual([]);
    expect(problemsOf(withDuration(neededMs - 1))[0]).toMatch(/below the .* ms a round can take/);
  });

  it('counts the cooldown of the threat when it is longer than the rest', () => {
    const { windowMs, toleranceMs } = content.feel.timing;
    const widest = Math.max(
      ...Object.values(content.feel.difficulty).map((t) => t.windowMultiplier),
    );
    const cooldownMs = REST_MS + 3000;
    const neededMs = cooldownMs + 800 + (EYES.maxDelayMs ?? 0) + windowMs * widest + toleranceMs;
    const withDuration = (durationMs: number): SequenceDef => ({
      ...DEF,
      steps: [{ kind: 'duel', durationMs, threatDef: 'bedtime_eyes', restMs: REST_MS }],
    });
    const slow = { bedtime_eyes: { ...eyes, cooldownMs } };
    expect(problemsOf(withDuration(neededMs), slow)).toEqual([]);
    expect(problemsOf(withDuration(neededMs - 1), slow)[0]).toMatch(/below the .* ms a round/);
  });

  it('refuses a duel step whose failure is not retreats', () => {
    const def: SequenceDef = { ...DEF, failure: { kind: 'gag', hasSnore: false } };
    expect(problemsOf(def)).toEqual([
      'has a duel step, so its failure must be "retreats", not "gag"',
    ]);
  });

  it('refuses a retreats failure with a step that is not a duel, or with no duel at all', () => {
    const duel = DEF.steps[0] as Extract<SequenceDef['steps'][number], { kind: 'duel' }>;
    const timed = {
      kind: 'microSleeps',
      durationMs: 8000,
    } as unknown as SequenceDef['steps'][number];
    expect(problemsOf({ ...DEF, steps: [duel, timed] })).toEqual([
      'has a "retreats" failure, so every step must be a duel (steps[1] is a "microSleeps" step)',
    ]);
    expect(problemsOf({ ...DEF, steps: [timed] })).toEqual([
      'has a "retreats" failure, but no duel step to step back from',
      'has a "retreats" failure, so every step must be a duel (steps[0] is a "microSleeps" step)',
    ]);
  });

  it('refuses the papa_asleep gag', () => {
    expect(problemsOf(DEF, { bedtime_eyes: { ...eyes, gag: 'papa_asleep' } })[0]).toMatch(
      /has the gag "papa_asleep"/,
    );
  });
});
