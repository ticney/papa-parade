import type { SequenceDef } from '@content/schemas/sequence';
import { STEP_MS } from '@shared/constants';
import { nextFloat, type RngState } from '@shared/rng';
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
  OUTLET,
  stepN,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { ThreatInstance, World } from '../world.ts';
import { sequenceRefusal } from './sequenceStart.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const FRAME = STEP_MS;

/** A frozen def whose three steps (5 s each) use the given gaps; `min = max` makes the cadence exact. */
function defWith(gapsMs: readonly [number, number, number], patch: Partial<SequenceDef> = {}) {
  const def = createTestStayAwake();
  def.steps = def.steps.map((step, i) => ({
    ...step,
    gapMinMs: gapsMs[i] as number,
    gapMaxMs: gapsMs[i] as number,
  }));
  return { ...def, ...patch };
}

/** No micro-sleep can come inside a step: the gap is longer than the whole sequence. */
const QUIET = defWith([100_000, 100_000, 100_000]);
/** The exact cadence of the tests: 3 s in each step. */
const REGULAR = defWith([3000, 3000, 3000]);

interface Options {
  def?: SequenceDef;
  waves?: ReturnType<typeof testWave>[];
  gauges?: Parameters<typeof createTestLevel>[0] extends infer O
    ? O extends { gauges?: infer G }
      ? G
      : never
    : never;
  carry?: boolean;
  durationMs?: number;
  objects?: Parameters<typeof createTestLevel>[0] extends infer O
    ? O extends { objects?: infer G }
      ? G
      : never
    : never;
  seed?: number;
  armsCryMs?: number;
}

async function newSim({
  def = REGULAR,
  waves = [],
  gauges = { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
  carry = true,
  durationMs,
  objects,
  seed = 1,
}: Options = {}): Promise<Sim> {
  return createSim({
    content,
    geometry,
    level: createTestLevel({
      waves,
      gauges,
      ...(carry ? { carry: CARRY } : {}),
      ...(objects === undefined ? {} : { objects }),
      sequences: [def.id],
      sequenceDefs: { [def.id]: def },
      ...(durationMs === undefined ? {} : { durationMs }),
    }),
    seed,
  });
}

const worldOf = (sim: Sim) => sim.world as World;

function stepEvents(sim: Sim, n = 1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

/** Steps (bounded) until `isDone`, returning every event emitted. */
function runUntil(sim: Sim, isDone: () => boolean, maxSteps = 4000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !isDone(); i++) events.push(...stepEvents(sim));
  return events;
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

const start = (sim: Sim, sequenceId = 'stay_awake') =>
  sim.enqueue({ type: 'StartSequence', t: asSimMs(worldOf(sim).time.sim), sequenceId });

/** The baby sits `distM` from Papa, still. */
function placeBaby(sim: Sim, distM: number): void {
  const world = worldOf(sim);
  world.baby.xM = world.papa.xM - distM;
  world.baby.zM = world.papa.zM;
  world.baby.prevXM = world.baby.xM;
  world.baby.prevZM = world.baby.zM;
  world.baby.wanderAt = asSimMs(1_000_000);
}

/** Starts the sequence and steps once: the events of the start step. */
async function started(options: Options = {}): Promise<{ sim: Sim; events: SimEvent[] }> {
  const sim = await newSim(options);
  placeBaby(sim, 3);
  start(sim);
  const events = stepEvents(sim);
  return { sim, events };
}

/** The micro-sleep instance of a level with fatigue and a cry in the arms: second to last. */
function microSleep(sim: Sim): ThreatInstance {
  const instance = worldOf(sim).threats.find((threat) => threat.defId === 'papa_microsleep');
  if (instance === undefined) throw new Error('the level has no micro-sleep');
  return instance;
}

/** Presses and releases the micro-sleep (a parry) at the centre of its window. */
function parry(sim: Sim, instance: ThreatInstance, offsetMs = 0): void {
  const centre = instance.windowOpenAt + (instance.responseWindow?.windowMs ?? 0) / 2 + offsetMs;
  sim.enqueue({ type: 'PressThreat', t: asSimMs(centre), threatId: instance.id });
  sim.enqueue({ type: 'Release', t: asSimMs(centre + 50) });
}

/** Runs the sequence to its end, parrying every micro-sleep as it comes. Returns every event. */
function playPerfectly(sim: Sim, maxSteps = 4000): SimEvent[] {
  const events: SimEvent[] = [];
  const instance = microSleep(sim);
  let answered = -1;
  for (let i = 0; i < maxSteps && worldOf(sim).flow.state === 'sequence'; i++) {
    if (instance.state === 'telegraph' && answered !== instance.enteredAt) {
      answered = instance.enteredAt;
      parry(sim, instance);
    }
    events.push(...stepEvents(sim));
  }
  return events;
}

/** The number of `nextFloat` the rng went through between two states of it (bounded). */
function drawsBetween(before: RngState, after: RngState): number {
  const probe = structuredClone(before);
  for (let draws = 0; draws <= 60; draws++) {
    if (JSON.stringify(probe) === JSON.stringify(after)) return draws;
    nextFloat(probe);
  }
  return -1;
}

describe('startSequence: what a start does (story 4.4, AC 9)', () => {
  it('enters the flow state, takes a distant baby and says so, in the helpers order', async () => {
    const { sim, events } = await started();
    const world = worldOf(sim);
    expect(world.flow.state).toBe('sequence');
    expect(world.baby.state).toBe('carried');
    expect(world.sequence).toMatchObject({
      id: 'stay_awake',
      lastId: 'stay_awake',
      startedAt: FRAME,
      endsAt: FRAME + 15_000,
      endedAt: null,
      stepIndex: 0,
      stepEndsAt: FRAME + 5000,
    });
    // The first step starts at the step that applies the command: step 1 (t = 10).
    expect(events.map((event) => event.type)).toEqual([
      'BabyStateChanged',
      'BabyPickedUp',
      'SequenceStarted',
      'SequenceStepStarted',
    ]);
    expect(ofType(events, 'SequenceStarted')).toEqual([
      { type: 'SequenceStarted', t: FRAME, id: 'stay_awake' },
    ]);
    expect(ofType(events, 'SequenceStepStarted')).toEqual([
      { type: 'SequenceStepStarted', t: FRAME, id: 'stay_awake', stepIndex: 0 },
    ]);
  });

  it('draws one nextFloat for the cadence and one for the cry in the arms of a distant baby', async () => {
    const sim = await newSim();
    placeBaby(sim, 3);
    const before = structuredClone(worldOf(sim).rng);
    start(sim);
    stepEvents(sim);
    expect(drawsBetween(before, worldOf(sim).rng)).toBe(2);
  });

  it('leaves a baby who is already carried alone: no second take, no cry draw', async () => {
    const sim = await newSim();
    placeBaby(sim, 0.5);
    sim.enqueue({ type: 'TapBaby', t: asSimMs(0) });
    stepEvents(sim);
    expect(worldOf(sim).baby.state).toBe('carried');
    const before = structuredClone(worldOf(sim).rng);
    start(sim);
    const events = stepEvents(sim);
    expect(events.map((event) => event.type)).toEqual(['SequenceStarted', 'SequenceStepStarted']);
    expect(drawsBetween(before, worldOf(sim).rng)).toBe(1);
  });

  it('a sequence that does not carry the baby leaves him free, and Papa is stopped', async () => {
    const def = { ...REGULAR, babyCarried: false };
    const sim = await newSim({ def });
    placeBaby(sim, 3);
    sim.enqueue({ type: 'TapFloor', t: asSimMs(0), xM: -2, zM: 2 });
    stepEvents(sim, 2);
    expect(worldOf(sim).papa.state).toBe('walkPath');
    start(sim);
    const events = stepEvents(sim);
    expect(worldOf(sim).baby.state).not.toBe('carried');
    expect(ofType(events, 'BabyPickedUp')).toEqual([]);
    expect(worldOf(sim).papa.state).toBe('idle');
    expect(worldOf(sim).papa.path).toEqual([]);
  });

  it('cancels every announced or open threat, the one on Papa too, with the reason sequence and no gag', async () => {
    const sim = await newSim({
      waves: [testWave([OUTLET], { gapMinMs: 100, gapMaxMs: 100 })],
    });
    placeBaby(sim, 3);
    worldOf(sim).baby.wanderAt = asSimMs(1_000_000);
    // Papa's micro-sleep is announced too (a normal one, fatigue high and due).
    sim.enqueue({ type: 'SetFatigue', t: asSimMs(0), points: 95 });
    runUntil(sim, () => worldOf(sim).threats.filter((t) => t.state === 'telegraph').length >= 2);
    const announced = worldOf(sim).threats.filter((t) => t.state === 'telegraph');
    expect(announced.length).toBeGreaterThanOrEqual(2);
    start(sim);
    const events = stepEvents(sim);
    const cancelled = ofType(events, 'ThreatCancelled');
    expect(cancelled.map((event) => event.reason)).toEqual(announced.map(() => 'sequence'));
    expect(cancelled.map((event) => event.threatId)).toEqual(announced.map((t) => t.id));
    expect(ofType(events, 'GagTriggered')).toEqual([]);
    expect(ofType(events, 'ResponseResolved')).toEqual([]);
    // Cancelled before the baby is taken: none of them reads `carried`.
    expect(cancelled.some((event) => event.reason === ('carried' as never))).toBe(false);
    const types = events.map((event) => event.type);
    expect(types.indexOf('ThreatCancelled')).toBeLessThan(types.indexOf('BabyPickedUp'));
    expect(types.indexOf('BabyPickedUp')).toBeLessThan(types.indexOf('SequenceStarted'));
  });

  it('refuses an id the level does not plan with no event', async () => {
    const sim = await newSim();
    start(sim, 'nope');
    expect(stepEvents(sim)).toEqual([]);
    expect(worldOf(sim).flow.state).toBe('playing');
  });

  it('refuses while a sequence runs, once the level has ended, while Papa is busy, and in a silence', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    expect(sequenceRefusal(world)).toBeNull();
    world.papa.state = 'asleep';
    world.papa.busyUntil = asSimMs(5000);
    expect(sequenceRefusal(world)).toBe('papaBusy');
    world.papa.state = 'idle';
    world.papa.busyUntil = asSimMs(0);
    world.silence.threatId = 1;
    expect(sequenceRefusal(world)).toBe('silence');
    world.silence.threatId = null;
    world.disruptions[0] = { state: 'ringing' } as (typeof world.disruptions)[number];
    expect(sequenceRefusal(world)).toBe('phoneRinging');
    world.disruptions.length = 0;
    world.flow.state = 'sequence';
    expect(sequenceRefusal(world)).toBe('running');
    world.flow.state = 'ended';
    expect(sequenceRefusal(world)).toBe('ended');
  });

  it('ignores a second StartSequence while one runs: nothing is emitted, nothing restarts', async () => {
    const { sim } = await started({ def: QUIET });
    const slice = structuredClone(worldOf(sim).sequence);
    start(sim);
    expect(stepEvents(sim)).toEqual([]);
    expect(worldOf(sim).sequence).toEqual(slice);
  });

  it('refuses to start with the baby hiding or Papa busy: the flow stays playing, no event', async () => {
    const sim = await newSim();
    worldOf(sim).papa.state = 'drink';
    worldOf(sim).papa.busyUntil = asSimMs(100_000);
    start(sim);
    expect(ofType(stepEvents(sim), 'SequenceStarted')).toEqual([]);
    expect(worldOf(sim).flow.state).toBe('playing');
  });
});

describe('the steps and the end (AC 10)', () => {
  it('emits SequenceStepStarted at the exact end of each step and succeeds at endsAt', async () => {
    const { sim, events: first } = await started({ def: QUIET });
    const events = [...first, ...runUntil(sim, () => worldOf(sim).flow.state !== 'sequence')];
    const startedAt = FRAME;
    expect(ofType(events, 'SequenceStepStarted').map((e) => [e.stepIndex, e.t])).toEqual([
      [0, startedAt],
      [1, startedAt + 5000],
      [2, startedAt + 10_000],
    ]);
    const ended = ofType(events, 'SequenceEnded');
    expect(ended).toEqual([
      { type: 'SequenceEnded', t: startedAt + 15_000, id: 'stay_awake', outcome: 'succeeded' },
    ]);
    expect(worldOf(sim).flow.state).toBe('playing');
    expect(worldOf(sim).sequence).toMatchObject({
      id: null,
      lastId: 'stay_awake',
      endedAt: startedAt + 15_000,
    });
    // No micro-sleep ever came: the gap was longer than the sequence.
    expect(ofType(events, 'ThreatTelegraphed')).toEqual([]);
  });

  it('telegraphs the micro-sleep inside each step gap, the one in force when it is drawn', async () => {
    // Step 0: 3 s, step 1: 4 s, step 2: 3 s. Telegraphs at +3 s, +6 s (drawn in step 0: gap 3 s),
    // +10 s (drawn in step 1: 4 s, and due right at the step 2's start), +13 s (step 2: 3 s).
    const def = defWith([3000, 4000, 3000]);
    const { sim, events: first } = await started({ def });
    const events = [...first, ...playPerfectly(sim)];
    const telegraphed = ofType(events, 'ThreatTelegraphed').map((event) => event.t);
    expect(telegraphed).toEqual([3000, 6000, 10_000, 13_000].map((ms) => FRAME + ms));
    expect(ofType(events, 'ThreatTelegraphed').every((event) => event.waveIndex === -1)).toBe(true);
    expect(ofType(events, 'SequenceEnded').map((event) => event.outcome)).toEqual(['succeeded']);
  });

  it('draws exactly one nextFloat per telegraph plus the start, whatever the gaps', async () => {
    for (const gapsMs of [
      [3000, 3000, 3000],
      [2000, 3500, 2500],
    ] as const) {
      const def = defWith(gapsMs);
      def.steps = def.steps.map((step, i) => ({ ...step, gapMaxMs: step.gapMinMs + i * 400 }));
      const sim = await newSim({ def });
      placeBaby(sim, 0.5);
      sim.enqueue({ type: 'TapBaby', t: asSimMs(0) });
      stepEvents(sim);
      const before = structuredClone(worldOf(sim).rng);
      start(sim);
      const events = stepEvents(sim);
      events.push(...playPerfectly(sim));
      const telegraphs = ofType(events, 'ThreatTelegraphed').length;
      expect(telegraphs).toBeGreaterThan(0);
      expect(drawsBetween(before, worldOf(sim).rng)).toBe(1 + telegraphs);
    }
  });

  it('never telegraphs a micro-sleep that could not be judged before the sequence ends', async () => {
    const def: SequenceDef = {
      ...REGULAR,
      steps: [{ kind: 'microSleeps', durationMs: 1500, gapMinMs: 100, gapMaxMs: 100 }],
    };
    const { sim, events: first } = await started({ def });
    const events = [...first, ...runUntil(sim, () => worldOf(sim).flow.state !== 'sequence')];
    expect(ofType(events, 'ThreatTelegraphed')).toEqual([]);
    expect(ofType(events, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: FRAME + 1500, id: 'stay_awake', outcome: 'succeeded' },
    ]);
  });

  it('never telegraphs one that could not be judged before the level ends either', async () => {
    // The level ends at 3 s; the sequence lasts 15 s. A micro-sleep at +1 s would be judged at +2.76 s.
    const def = defWith([1000, 1000, 1000]);
    const { sim, events: first } = await started({ def, durationMs: 3000 });
    const events = [...first, ...runUntil(sim, () => worldOf(sim).flow.state === 'ended')];
    // At +1 s: 1010 + 1200 + 300 + 60 = 2570 ≤ 3000, so the first one does come; the next (at 2.57 s+) cannot.
    const telegraphs = ofType(events, 'ThreatTelegraphed');
    expect(telegraphs).toHaveLength(1);
    expect(ofType(events, 'LevelEnded').map((event) => event.reason)).toEqual(['timer']);
  });

  it('does not succeed over an open window: a lagging input keeps it open past endsAt', async () => {
    // One 5 s step, a micro-sleep at +3 s: window 4.2 s → closes 4.5 s, judged by 4.56 s. With a
    // 1 s lag the sim waits until 5.56 s: at endsAt (5 s) the window is still open.
    const def: SequenceDef = {
      ...REGULAR,
      steps: [{ kind: 'microSleeps', durationMs: 5000, gapMinMs: 3000, gapMaxMs: 3000 }],
    };
    const sim = await newSim({ def });
    placeBaby(sim, 3);
    sim.enqueue({ type: 'SetInputLag', t: asSimMs(0), lagMs: 1000 });
    start(sim);
    runUntil(sim, () => worldOf(sim).time.sim >= FRAME + 5000);
    expect(microSleep(sim).state).toBe('windowOpen');
    expect(worldOf(sim).flow.state).toBe('sequence');
    // Nobody answers: it ends in the gag, and the sequence is lost, not won.
    const events = runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    expect(ofType(events, 'SequenceEnded').map((event) => event.outcome)).toEqual(['failed']);
  });

  it('succeeds in the step the last answered micro-sleep is resolved and past endsAt', async () => {
    const { sim, events: first } = await started();
    const events = [...first, ...playPerfectly(sim)];
    expect(ofType(events, 'SequenceEnded').map((event) => event.outcome)).toEqual(['succeeded']);
    expect(ofType(events, 'GagTriggered')).toEqual([]);
    // Each parry is a response: the combo climbed and the perfects were counted.
    expect(worldOf(sim).combo.multiplier).toBeGreaterThan(1);
    expect(worldOf(sim).score.perfects).toBe(ofType(events, 'ResponseResolved').length);
  });
});

describe('failing a micro-sleep ends the sequence (AC 12)', () => {
  /** The order of the types of events that matter for a miss. */
  const missOrder = (events: readonly SimEvent[]) =>
    events
      .map((event) => event.type)
      .filter((type) =>
        [
          'ResponseResolved',
          'GagTriggered',
          'PapaStateChanged',
          'ComboChanged',
          'PapaSnored',
          'BabyWoke',
          'NoiseChanged',
          'SequenceEnded',
        ].includes(type),
      );

  it('late: nobody answers. The full order, the snore, the wake, the noise, the resume', async () => {
    const { sim } = await started();
    const events = runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    expect(missOrder(events)).toEqual([
      'ResponseResolved',
      'GagTriggered',
      'PapaStateChanged',
      'PapaSnored',
      'BabyWoke',
      'SequenceEnded',
      'NoiseChanged',
    ]);
    expect(ofType(events, 'ResponseResolved')[0]).toMatchObject({
      quality: 'fail',
      reason: 'late',
    });
    expect(ofType(events, 'GagTriggered')[0]).toMatchObject({ gag: 'papa_asleep' });
    expect(ofType(events, 'PapaStateChanged')[0]).toMatchObject({ to: 'asleep' });
    expect(ofType(events, 'SequenceEnded')[0]).toMatchObject({ outcome: 'failed' });
    const noise = ofType(events, 'NoiseChanged');
    expect(noise).toHaveLength(1);
    expect(noise[0]).toMatchObject({ source: 'snore', deltaPct: expect.closeTo(15, 9) });
    expect(worldOf(sim).flow.state).toBe('playing');
    expect(worldOf(sim).baby.state).toBe('carried');
    expect(worldOf(sim).papa.state).toBe('asleep');
  });

  it('early: a press long before the window ends it the same way', async () => {
    const { sim } = await started();
    runUntil(sim, () => microSleep(sim).state === 'telegraph');
    const instance = microSleep(sim);
    sim.enqueue({ type: 'PressThreat', t: asSimMs(worldOf(sim).time.sim), threatId: instance.id });
    sim.enqueue({ type: 'Release', t: asSimMs(worldOf(sim).time.sim + 50) });
    const events = runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    expect(ofType(events, 'ResponseResolved')[0]).toMatchObject({ reason: 'early' });
    expect(missOrder(events)).toEqual([
      'ResponseResolved',
      'GagTriggered',
      'PapaStateChanged',
      'PapaSnored',
      'BabyWoke',
      'SequenceEnded',
      'NoiseChanged',
    ]);
    expect(ofType(events, 'SequenceEnded')[0]).toMatchObject({ outcome: 'failed' });
  });

  it('wrongResponse: a hold on a parry ends it too', async () => {
    const { sim } = await started();
    runUntil(sim, () => microSleep(sim).state === 'telegraph');
    const instance = microSleep(sim);
    const centre = instance.windowOpenAt + 100;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(centre), threatId: instance.id });
    sim.enqueue({ type: 'Release', t: asSimMs(centre + 600) });
    const events = runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    expect(ofType(events, 'ResponseResolved')[0]).toMatchObject({ reason: 'wrongResponse' });
    expect(ofType(events, 'SequenceEnded')[0]).toMatchObject({ outcome: 'failed' });
    expect(ofType(events, 'PapaSnored')).toHaveLength(1);
  });

  it('adds exactly the snore noise, clamped at 100, and nothing without a noise gauge', async () => {
    const sim = await newSim();
    placeBaby(sim, 3);
    sim.enqueue({ type: 'SetNoise', t: asSimMs(0), pct: 50 });
    start(sim);
    stepEvents(sim);
    const lifted = runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    expect(worldOf(sim).flow.state).toBe('playing');
    // The snore is added to whatever the gauge holds: 50 + 15, below the cap (the cap is the
    // « wakes Mama » test below, from 95).
    const snored = ofType(lifted, 'NoiseChanged').filter((event) => event.source === 'snore');
    expect(snored).toHaveLength(1);
    expect((snored[0]?.noisePct ?? 0) - (snored[0]?.deltaPct ?? 0)).toBeGreaterThan(40);
    expect(snored[0]?.noisePct).toBeLessThan(100);

    const noisy = await newSim();
    placeBaby(noisy, 3);
    start(noisy);
    stepEvents(noisy);
    const noisyEvents = runUntil(noisy, () => worldOf(noisy).flow.state !== 'sequence');
    const snore = ofType(noisyEvents, 'NoiseChanged');
    expect(snore).toHaveLength(1);
    expect(snore[0]).toMatchObject({ source: 'snore', deltaPct: expect.closeTo(15, 9) });
    expect(worldOf(noisy).gauges.noisePct).toBe(snore[0]?.noisePct);

    const quiet = await newSim({ gauges: FATIGUE_GAUGES });
    placeBaby(quiet, 3);
    start(quiet);
    stepEvents(quiet);
    const events = runUntil(quiet, () => worldOf(quiet).flow.state !== 'sequence');
    expect(ofType(events, 'NoiseChanged')).toEqual([]);
    expect(ofType(events, 'PapaSnored')).toHaveLength(1);
    expect(worldOf(quiet).gauges.noisePct).toBe(0);
  });

  it('wakes Mama in the same step when the snore fills the gauge: SequenceEnded, then MamaWoke, LevelEnded', async () => {
    const sim = await newSim();
    placeBaby(sim, 3);
    start(sim);
    stepEvents(sim);
    runUntil(sim, () => microSleep(sim).state === 'telegraph');
    sim.enqueue({ type: 'SetNoise', t: asSimMs(worldOf(sim).time.sim), pct: 95 });
    const events = runUntil(sim, () => worldOf(sim).flow.state === 'ended');
    const types = events.map((event) => event.type);
    expect(types.indexOf('SequenceEnded')).toBeLessThan(types.indexOf('MamaWoke'));
    expect(types.indexOf('MamaWoke')).toBeLessThan(types.indexOf('LevelEnded'));
    expect(ofType(events, 'NoiseChanged').at(-1)).toMatchObject({ source: 'snore', noisePct: 100 });
    expect(ofType(events, 'LevelEnded')[0]).toMatchObject({ reason: 'mamaWoke' });
    const t = ofType(events, 'MamaWoke')[0]?.t;
    expect(ofType(events, 'SequenceEnded')[0]?.t).toBe(t);
  });

  it('adds nothing to the mess and has no gagCry: the baby does not cry', async () => {
    const { sim } = await started();
    const mess = structuredClone(worldOf(sim).mess);
    const events = runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    expect(worldOf(sim).mess).toEqual(mess);
    expect(ofType(events, 'BabyCrying')).toEqual([]);
    expect(worldOf(sim).baby.cryStartedAt).toBeNull();
  });
});

describe('the level ends during a sequence (AC 13)', () => {
  it('closes it first: SequenceEnded{levelEnded}, before LevelEnded, with no resume', async () => {
    const { sim } = await started({ def: QUIET, durationMs: 6000 });
    const nextAt = worldOf(sim).director.nextAt;
    const events = runUntil(sim, () => worldOf(sim).flow.state === 'ended');
    const types = events.map((event) => event.type);
    expect(ofType(events, 'SequenceEnded')).toEqual([
      { type: 'SequenceEnded', t: 6000, id: 'stay_awake', outcome: 'levelEnded' },
    ]);
    expect(types.indexOf('SequenceEnded')).toBeLessThan(types.indexOf('LevelEnded'));
    expect(worldOf(sim).sequence).toMatchObject({ id: null, lastId: 'stay_awake', endedAt: 6000 });
    expect(worldOf(sim).director.nextAt).toBe(nextAt);
    expect(worldOf(sim).flow.state).toBe('ended');
  });

  it('closes it with a held phone still pending: SequenceEnded before LevelEnded, no ring', async () => {
    // A phone cannot ring during a sequence (the start is refused while one rings, a pending one is
    // held back), so the level end has no phone or silence to close before the sequence.
    const sim = await newSim({
      def: QUIET,
      durationMs: 6000,
      objects: [{ id: 'phone', kind: 'phone', anchor: 'phone' }],
      waves: [testWave([], { disruptions: [testPhoneEntry(100)] })],
    });
    placeBaby(sim, 3);
    start(sim);
    const events = [
      ...stepEvents(sim),
      ...runUntil(sim, () => worldOf(sim).flow.state === 'ended'),
    ];
    const types = events.map((event) => event.type);
    expect(types).not.toContain('PhoneRingStarted');
    expect(worldOf(sim).disruptions[0]?.state).toBe('pending');
    expect(types.indexOf('SequenceEnded')).toBeGreaterThanOrEqual(0);
    expect(types.indexOf('SequenceEnded')).toBeLessThan(types.indexOf('LevelEnded'));
  });
});

describe('what a sequence suspends (AC 11)', () => {
  it('holds back the director but not the wave clock: no telegraph, WaveStarted on time', async () => {
    const sim = await newSim({
      def: QUIET,
      waves: [
        testWave([OUTLET], { gapMinMs: 100, gapMaxMs: 100 }),
        testWave([], { fromMs: 2000, gapMinMs: 100, gapMaxMs: 100 }),
      ],
    });
    placeBaby(sim, 3);
    start(sim);
    const events = runUntil(sim, () => worldOf(sim).time.sim >= 4000);
    expect(ofType(events, 'WaveStarted').map((event) => [event.waveIndex, event.t])).toEqual([
      [0, FRAME],
      [1, 2000],
    ]);
    expect(ofType(events, 'ThreatTelegraphed')).toEqual([]);
    expect(worldOf(sim).flow.state).toBe('sequence');
  });

  it('ignores ForceThreat during a sequence', async () => {
    const sim = await newSim({ def: QUIET, waves: [testWave([OUTLET], { gapMinMs: 100000 })] });
    placeBaby(sim, 3);
    start(sim);
    stepEvents(sim);
    const outlet = worldOf(sim).threats[0] as ThreatInstance;
    sim.enqueue({ type: 'ForceThreat', t: asSimMs(worldOf(sim).time.sim), threatId: outlet.id });
    expect(stepEvents(sim)).toEqual([]);
    expect(outlet.state).toBe('idle');
  });

  it('suspends the normal micro-sleep (fatigue 100, due) and the cry in the arms', async () => {
    const { sim } = await started({ def: QUIET });
    sim.enqueue({ type: 'SetFatigue', t: asSimMs(worldOf(sim).time.sim), points: 100 });
    stepEvents(sim);
    worldOf(sim).gauges.microSleepAt = asSimMs(0);
    worldOf(sim).carry.armsCryAt = asSimMs(0);
    const events = runUntil(sim, () => worldOf(sim).time.sim >= 3000);
    expect(ofType(events, 'ThreatTelegraphed')).toEqual([]);
    expect(worldOf(sim).flow.state).toBe('sequence');
  });

  it('keeps a pending phone for the end plus resumeGapMs and ignores StartDisruption', async () => {
    const objects = [{ id: 'phone', kind: 'phone' as const, anchor: 'phone' }];
    // A phone due at 1 s: the sequence (15 s) holds it back until its end, then the breath.
    const sim = await newSim({
      def: QUIET,
      objects,
      waves: [testWave([], { disruptions: [testPhoneEntry(1000)] })],
    });
    placeBaby(sim, 3);
    start(sim);
    sim.enqueue({ type: 'StartDisruption', t: asSimMs(0), index: 0 });
    stepEvents(sim);
    const during = runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    expect(ofType(during, 'PhoneRingStarted')).toEqual([]);
    const endedAt = worldOf(sim).sequence.endedAt as number;
    const after = runUntil(sim, () => worldOf(sim).disruptions[0]?.state === 'ringing');
    expect(ofType(after, 'PhoneRingStarted').map((event) => event.t)).toEqual([endedAt + 2000]);
  });

  it('refuses a start while a phone rings, and starts once it has timed out', async () => {
    const ringing = await newSim({
      def: QUIET,
      objects: [{ id: 'phone', kind: 'phone' as const, anchor: 'phone' }],
      waves: [testWave([], { disruptions: [testPhoneEntry(0)] })],
    });
    placeBaby(ringing, 3);
    stepEvents(ringing);
    expect(worldOf(ringing).disruptions[0]?.state).toBe('ringing');
    expect(sequenceRefusal(worldOf(ringing))).toBe('phoneRinging');
    start(ringing);
    const refused = stepEvents(ringing);
    expect(ofType(refused, 'SequenceStarted')).toEqual([]);
    expect(worldOf(ringing).flow.state).toBe('playing');
    runUntil(ringing, () => worldOf(ringing).disruptions[0]?.state !== 'ringing');
    expect(sequenceRefusal(worldOf(ringing))).toBeNull();
    start(ringing);
    expect(ofType(stepEvents(ringing), 'SequenceStarted')).toHaveLength(1);
  });
});

describe('Papa stands still (AC 11, D3)', () => {
  it.each([
    ['TapFloor', { type: 'TapFloor', xM: -2, zM: 2 }],
    ['TapObject', { type: 'TapObject', objectId: 'coffee_machine' }],
    ['TapBaby', { type: 'TapBaby' }],
    ['Move', { type: 'Move', dirX: 1, dirZ: 0 }],
    ['MoveStop', { type: 'MoveStop' }],
  ] as const)('ignores %s, in the sequence and in its first step', async (_name, command) => {
    const sim = await newSim({
      def: QUIET,
      objects: [{ id: 'coffee_machine', kind: 'coffee_machine', anchor: 'coffee_machine' }],
    });
    placeBaby(sim, 3);
    start(sim);
    // Same step as the start: the command comes after StartSequence in the queue.
    sim.enqueue({ ...command, t: asSimMs(0) });
    const events = stepEvents(sim);
    expect(worldOf(sim).papa.state).toBe('idle');
    expect(ofType(events, 'PapaPathPlanned')).toEqual([]);
    sim.enqueue({ ...command, t: asSimMs(worldOf(sim).time.sim) });
    const later = stepEvents(sim, 3);
    expect(worldOf(sim).papa.state).toBe('idle');
    expect(ofType(later, 'PapaPathPlanned')).toEqual([]);
    expect(ofType(later, 'BabyPutDown')).toEqual([]);
    expect(worldOf(sim).baby.state).toBe('carried');
    expect(worldOf(sim).flow.state).toBe('sequence');
  });

  it('lets a press on a threat through', async () => {
    const { sim } = await started();
    runUntil(sim, () => microSleep(sim).state === 'telegraph');
    parry(sim, microSleep(sim));
    const events = runUntil(sim, () => microSleep(sim).state === 'resolved');
    expect(ofType(events, 'ResponseResolved')).toHaveLength(1);
    expect(ofType(events, 'PapaGlideStarted')).toEqual([]);
  });
});

describe('the resume (AC 14)', () => {
  it('pushes the three clocks to now + resumeGapMs after a success, pulls none earlier, draws nothing', async () => {
    const { sim } = await started({ def: QUIET });
    const resumeGapMs = content.feel.sequences.resumeGapMs;
    const world = worldOf(sim);
    world.director.nextAt = asSimMs(1000);
    world.gauges.microSleepAt = asSimMs(2000);
    world.carry.armsCryAt = asSimMs(10_000_000);
    const before = structuredClone(world.rng);
    const events = runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    const endedAt = worldOf(sim).sequence.endedAt as number;
    expect(ofType(events, 'SequenceEnded')[0]?.outcome).toBe('succeeded');
    expect(worldOf(sim).director.nextAt).toBe(endedAt + resumeGapMs);
    expect(worldOf(sim).gauges.microSleepAt).toBe(endedAt + resumeGapMs);
    expect(worldOf(sim).carry.armsCryAt).toBe(10_000_000);
    expect(drawsBetween(before, worldOf(sim).rng)).toBe(0);
  });

  it('leaves a null clock null: a micro-sleep that is not due is not invented', async () => {
    const { sim } = await started({ def: QUIET });
    expect(worldOf(sim).gauges.microSleepAt).toBeNull();
    runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    expect(worldOf(sim).gauges.microSleepAt).toBeNull();
  });

  it('is the same after a failure, and Papa has the room back when he wakes', async () => {
    const { sim } = await started();
    runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    const endedAt = worldOf(sim).sequence.endedAt as number;
    expect(worldOf(sim).director.nextAt).toBeGreaterThanOrEqual(
      endedAt + content.feel.sequences.resumeGapMs,
    );
    runUntil(sim, () => worldOf(sim).papa.state === 'idle');
    expect(worldOf(sim).papa.state).toBe('idle');
    expect(worldOf(sim).flow.state).toBe('playing');
    expect(worldOf(sim).baby.state).toBe('carried');
  });

  it('lets commands through again on the step the sequence ends (runSequence runs before runPapa)', async () => {
    const { sim } = await started({ def: QUIET });
    runUntil(sim, () => worldOf(sim).time.sim >= FRAME + 15_000 - STEP_MS);
    sim.enqueue({ type: 'TapFloor', t: asSimMs(worldOf(sim).time.sim + STEP_MS), xM: -2, zM: 2 });
    const events = stepEvents(sim);
    expect(ofType(events, 'SequenceEnded')).toHaveLength(1);
    expect(ofType(events, 'PapaPathPlanned')).toHaveLength(1);
  });

  it('the director draws nothing while he is still carried, even past the pushed time', async () => {
    const sim = await newSim({
      def: QUIET,
      waves: [testWave([OUTLET], { gapMinMs: 100, gapMaxMs: 100 })],
    });
    placeBaby(sim, 3);
    start(sim);
    stepEvents(sim);
    runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    const endedAt = worldOf(sim).sequence.endedAt as number;
    const events = runUntil(sim, () => worldOf(sim).time.sim >= endedAt + 5000);
    // The cry in the arms (not the director's) may come; the outlet never does.
    expect(ofType(events, 'ThreatTelegraphed').filter((event) => event.kind === 'outlet')).toEqual(
      [],
    );
    expect(worldOf(sim).baby.state).toBe('carried');
  });

  it('after a put-down the director telegraphs, and not before the pushed time', async () => {
    const sim = await newSim({
      def: QUIET,
      waves: [testWave([OUTLET], { gapMinMs: 100, gapMaxMs: 100 })],
    });
    placeBaby(sim, 3);
    start(sim);
    stepEvents(sim);
    runUntil(sim, () => worldOf(sim).flow.state !== 'sequence');
    const endedAt = worldOf(sim).sequence.endedAt as number;
    // Put down at once: the director would be due long before, but waits for the pushed time.
    sim.enqueue({ type: 'TapBaby', t: asSimMs(endedAt + STEP_MS) });
    const events = runUntil(sim, () => worldOf(sim).threats[0]?.state === 'telegraph', 1000);
    expect(ofType(events, 'BabyPutDown')).toHaveLength(1);
    const telegraph = ofType(events, 'ThreatTelegraphed');
    expect(telegraph).toHaveLength(1);
    expect(telegraph[0]?.t).toBe(endedAt + content.feel.sequences.resumeGapMs);
  });
});

describe('journal and replay', () => {
  it('replays a sequence from its journal to the same world', async () => {
    const options = {
      content,
      geometry,
      level: createTestLevel({
        gauges: { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
        carry: CARRY,
        sequences: ['stay_awake'],
      }),
      seed: 9,
    };
    const live = await createSim(options);
    live.enqueue({ type: 'StartSequence', t: asSimMs(500), sequenceId: 'stay_awake' });
    stepN(live, 3000);
    expect(live.world.sequence.lastId).toBe('stay_awake');
    const replay = await createSim({ ...options, journal: live.journal() });
    stepN(replay, 3000);
    expect(replay.world).toEqual(live.world);
    expect(live.journal().entries.map((entry) => entry.command.type)).toEqual(['StartSequence']);
  });
});
