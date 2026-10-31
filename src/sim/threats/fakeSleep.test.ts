import type { SequenceDef } from '@content/schemas/sequence';
import { STEP_MS } from '@shared/constants';
import { nextFloat, type RngState } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBedtimeEyes,
  createTestContent,
  createTestFakeSleep,
  createTestFakeSleepDuel,
  createTestFakeSleepRound,
  createTestGeometry,
  createTestLevel,
  createTestOutlet,
  NOISE_GAUGES,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { judgePress } from '../timing/judge.ts';
import type { ThreatInstance, World } from '../world.ts';
import {
  cancelThreat,
  gagThreat,
  giveFeint,
  hideThreat,
  rearmThreat,
  resolveThreat,
  telegraphThreat,
} from './threatFsm.ts';

// The fake sleep (story 4.7) on the frozen def `tests/support/testFakeSleep.threat.json`: 800 ms of
// telegraph, the feint 1200 to 2600 ms after it, the signal 3500 to 7000 ms after it, and at least 900
// ms between the two. The frozen feel has a 300 ms window, a 60 ms tolerance and a 100 ms buffer.
const content = createTestContent();
const geometry = createTestGeometry();
const FAKE = createTestFakeSleep();
const EYES = createTestBedtimeEyes();
const OUTLET_DEF = createTestOutlet();
const { telegraphDelayMs, minDelayMs, maxDelayMs, feint } = FAKE;
if (
  telegraphDelayMs === null ||
  minDelayMs === undefined ||
  maxDelayMs === undefined ||
  feint === undefined
) {
  throw new Error('the frozen fake sleep lost a key');
}

/** A duel of the fake sleep alone: the frozen duel's second step, as its only one. */
const ROUND_ONLY: SequenceDef = createTestFakeSleepRound();

const worldOf = (sim: Sim) => sim.world as World;
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
const typesOf = (events: readonly SimEvent[]) => events.map((event) => event.type);
const roundOf = (sim: Sim): ThreatInstance => {
  const round = worldOf(sim).threats.find((threat) => threat.defId === FAKE.id);
  if (round === undefined) throw new Error('the level has no fake sleep');
  return round;
};

function stepEvents(sim: Sim, n = 1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

function runTo(sim: Sim, untilMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (worldOf(sim).time.sim < untilMs) events.push(...stepEvents(sim));
  return events;
}

function runUntil(sim: Sim, isDone: () => boolean, maxSteps = 3000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !isDone(); i++) events.push(...stepEvents(sim));
  expect(isDone()).toBe(true);
  return events;
}

/** The duel of the fake sleep alone, started, the baby in Papa's arms, stopped on the step that telegraphs the round. */
async function telegraphedRound(options: { seed?: number; hasNoise?: boolean } = {}) {
  const { seed = 1, hasNoise = false } = options;
  const sim = await createSim({
    content,
    geometry,
    level: createTestLevel({
      gauges: hasNoise ? NOISE_GAUGES : {},
      carry: CARRY,
      sequences: [ROUND_ONLY.id],
      sequenceDefs: { [ROUND_ONLY.id]: ROUND_ONLY },
    }),
    seed,
  });
  const world = worldOf(sim);
  world.baby.xM = world.papa.xM - 3;
  world.baby.zM = world.papa.zM;
  world.baby.prevXM = world.baby.xM;
  world.baby.prevZM = world.baby.zM;
  world.baby.wanderAt = asSimMs(1_000_000);
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: ROUND_ONLY.id });
  const round = roundOf(sim);
  const events = runUntil(sim, () => round.state === 'telegraph');
  return { sim, world, round, events };
}

/** An rng state whose next `nextFloat` is exactly 0 (all zero). */
const FLOAT_ZERO: RngState = { a: 0, b: 0, c: 0, d: 0 };

/** A threat-level setup: a world with the instances, and a context that collects the events. */
async function setup() {
  const sim = await createSim({
    content,
    geometry,
    level: createTestLevel({
      waves: [testWave([OUTLET])],
      carry: CARRY,
      sequences: [ROUND_ONLY.id, 'bedtime_duel'],
      sequenceDefs: { [ROUND_ONLY.id]: ROUND_ONLY },
    }),
    seed: 1,
  });
  const world = sim.world as World;
  world.time.sim = asSimMs(500);
  const events: SimEvent[] = [];
  const ctx = {
    feel: content.feel,
    events,
    strictInvariants: true,
    t: world.time.sim,
    level: { microSleepIndex: -1 },
    requestFreezeRealMs: () => {},
  } as unknown as StepContext;
  const find = (defId: string) => {
    const found = world.threats.find((threat) => threat.defId === defId);
    if (found === undefined) throw new Error(`no ${defId}`);
    return found;
  };
  return {
    world,
    ctx,
    events,
    fake: find(FAKE.id),
    eyes: find(EYES.id),
    outlet: find(OUTLET_DEF.id),
  };
}

describe('the telegraph of a fake sleep: the two draws (story 4.7, AC 2)', () => {
  it('draws exactly two floats, the signal’s first and the feint’s second, each as the formula says', async () => {
    const { world, ctx, fake } = await setup();
    const copy = { ...world.rng };
    const first = nextFloat(copy);
    const second = nextFloat(copy);
    telegraphThreat(world, ctx, fake, FAKE, -1);
    expect(world.rng).toEqual(copy);
    expect(fake.windowOpenAt).toBe(
      500 + telegraphDelayMs + Math.round(minDelayMs + first * (maxDelayMs - minDelayMs)),
    );
    expect(fake.feintAt).toBe(
      500 +
        telegraphDelayMs +
        Math.round(feint.minDelayMs + second * (feint.maxDelayMs - feint.minDelayMs)),
    );
    expect(fake.isFeintGiven).toBe(false);
  });

  it('keeps the signal where a def with no feint puts it from the same rng state: the draws are independent', async () => {
    const { world, ctx, fake } = await setup();
    const withoutFeint = { ...FAKE, feint: undefined };
    const state = { ...world.rng };
    telegraphThreat(world, ctx, fake, FAKE, -1);
    const signalAt = fake.windowOpenAt;
    world.rng = { ...state };
    telegraphThreat(world, ctx, fake, withoutFeint, -1);
    expect(fake.windowOpenAt).toBe(signalAt);
    expect(fake.feintAt).toBeNull();
  });

  it('puts the feint at the exact ms of a collapsed range, whatever the draw', async () => {
    const { world, ctx, fake } = await setup();
    const fixed = { ...FAKE, feint: { ...feint, minDelayMs: 1500, maxDelayMs: 1500 } };
    world.rng = { ...FLOAT_ZERO };
    telegraphThreat(world, ctx, fake, fixed, -1);
    expect(fake.feintAt).toBe(500 + telegraphDelayMs + 1500);
    world.rng = { a: 1, b: 2, c: 3, d: 4 };
    telegraphThreat(world, ctx, fake, fixed, -1);
    expect(fake.feintAt).toBe(500 + telegraphDelayMs + 1500);
  });

  it('draws whole ms, inside the range and spread over it, across many rng states', async () => {
    const { world, ctx, fake } = await setup();
    let lowest = Number.POSITIVE_INFINITY;
    let highest = Number.NEGATIVE_INFINITY;
    for (let d = 0; d < 400; d++) {
      world.rng = { a: 0, b: 0, c: 0, d: d * 10_737_418 };
      telegraphThreat(world, ctx, fake, FAKE, -1);
      const feintAt = fake.feintAt as number;
      const delayMs = feintAt - 500 - telegraphDelayMs;
      expect(Number.isInteger(feintAt)).toBe(true);
      expect(delayMs).toBeGreaterThanOrEqual(feint.minDelayMs);
      expect(delayMs).toBeLessThanOrEqual(feint.maxDelayMs);
      lowest = Math.min(lowest, delayMs);
      highest = Math.max(highest, delayMs);
    }
    const spanMs = feint.maxDelayMs - feint.minDelayMs;
    expect(lowest).toBeLessThan(feint.minDelayMs + spanMs * 0.1);
    expect(highest).toBeGreaterThan(feint.maxDelayMs - spanMs * 0.1);
  });

  it('puts the feint at least minGapMs before the signal and strictly before it, over many seeds', async () => {
    const { world, ctx, fake } = await setup();
    for (let seed = 0; seed < 500; seed++) {
      world.rng = { a: seed, b: seed * 7, c: seed * 13, d: seed * 29 };
      telegraphThreat(world, ctx, fake, FAKE, -1);
      expect(fake.feintAt as number).toBeLessThan(fake.windowOpenAt);
      expect(fake.windowOpenAt - (fake.feintAt as number)).toBeGreaterThanOrEqual(feint.minGapMs);
    }
  });

  it('draws one float for a wait with no feint and none for a parry, and gives them no feint', async () => {
    const { world, ctx, eyes, outlet } = await setup();
    const expected = { ...world.rng };
    nextFloat(expected);
    telegraphThreat(world, ctx, eyes, EYES, -1);
    expect(world.rng).toEqual(expected);
    expect(eyes).toMatchObject({ feintAt: null, isFeintGiven: false });
    const before = { ...world.rng };
    telegraphThreat(world, ctx, outlet, OUTLET_DEF, 0);
    expect(world.rng).toEqual(before);
    expect(outlet).toMatchObject({ feintAt: null, isFeintGiven: false });
  });

  it('starts every telegraph with the feint not given, and clears it at the next one', async () => {
    const { world, ctx, fake } = await setup();
    telegraphThreat(world, ctx, fake, FAKE, -1);
    giveFeint(world, ctx, fake);
    expect(fake.isFeintGiven).toBe(true);
    telegraphThreat(world, ctx, fake, FAKE, -1);
    expect(fake.isFeintGiven).toBe(false);
    expect(fake.feintAt).not.toBeNull();
  });
});

describe('where the feint is cleared (story 4.7, AC 2)', () => {
  it.each([
    [
      'rearmThreat',
      (world: World, ctx: StepContext, fake: ThreatInstance) => rearmThreat(world, ctx, fake),
    ],
    [
      'cancelThreat',
      (world: World, ctx: StepContext, fake: ThreatInstance) =>
        cancelThreat(world, ctx, fake, 'carried'),
    ],
    [
      'hideThreat',
      (world: World, ctx: StepContext, fake: ThreatInstance) => hideThreat(world, ctx, fake, 0),
    ],
  ] as const)('%s clears feintAt and isFeintGiven', async (_name, clear) => {
    const { world, ctx, fake } = await setup();
    telegraphThreat(world, ctx, fake, FAKE, -1);
    giveFeint(world, ctx, fake);
    expect(fake.feintAt).not.toBeNull();
    clear(world, ctx, fake);
    expect(fake).toMatchObject({ feintAt: null, isFeintGiven: false });
  });

  it('keeps them through resolved and gag, until the rearm', async () => {
    const { world, ctx, fake } = await setup();
    telegraphThreat(world, ctx, fake, FAKE, -1);
    const { feintAt } = fake;
    giveFeint(world, ctx, fake);
    resolveThreat(world, ctx, fake, FAKE, 'success', 0);
    expect(fake).toMatchObject({ state: 'resolved', feintAt, isFeintGiven: true });
    rearmThreat(world, ctx, fake);
    expect(fake).toMatchObject({ state: 'idle', feintAt: null, isFeintGiven: false });
    telegraphThreat(world, ctx, fake, FAKE, -1);
    gagThreat(world, ctx, fake, FAKE, 'early', -100);
    expect(fake.state).toBe('gag');
    expect(fake.feintAt).not.toBeNull();
  });
});

describe('the event of the feint (story 4.7, AC 3)', () => {
  it('comes once, in telegraph, before the signal, at the first step at or after feintAt', async () => {
    const { sim, round, events: beforeEvents } = await telegraphedRound();
    expect(typesOf(beforeEvents)).not.toContain('WaitFeintGiven');
    const { feintAt, windowOpenAt } = round;
    expect(feintAt).not.toBeNull();
    const events = runUntil(sim, () => round.state === 'windowOpen');
    const feints = ofType(events, 'WaitFeintGiven');
    expect(feints).toEqual([{ type: 'WaitFeintGiven', t: expect.any(Number), threatId: round.id }]);
    expect(feints[0]?.t).toBe(Math.ceil((feintAt as number) / STEP_MS) * STEP_MS);
    const signals = ofType(events, 'WaitSignalGiven');
    expect(signals).toHaveLength(1);
    expect(typesOf(events).indexOf('WaitFeintGiven')).toBeLessThan(
      typesOf(events).indexOf('WaitSignalGiven'),
    );
    expect(signals[0]?.t).toBe(Math.ceil(windowOpenAt / STEP_MS) * STEP_MS);
    expect(round.isFeintGiven).toBe(true);
  });

  it('is false until then and true from then on, still telegraph, no second event', async () => {
    const { sim, round } = await telegraphedRound();
    const { feintAt } = round;
    runTo(sim, (feintAt as number) - STEP_MS);
    expect(round).toMatchObject({ state: 'telegraph', isFeintGiven: false });
    const atFeint = runUntil(sim, () => round.isFeintGiven);
    expect(typesOf(atFeint)).toContain('WaitFeintGiven');
    expect(round.state).toBe('telegraph');
    const rest = runUntil(sim, () => round.state === 'windowOpen');
    expect(typesOf(rest)).not.toContain('WaitFeintGiven');
    expect(round.isFeintGiven).toBe(true);
  });

  it('comes for no other threat: the eyes of the frozen duel never give a feint', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'] }),
      seed: 1,
    });
    sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bedtime_duel' });
    const events = runTo(sim, 8000);
    expect(typesOf(events)).toContain('WaitSignalGiven');
    expect(typesOf(events)).not.toContain('WaitFeintGiven');
  });

  it('is beaten by a press stamped at feintAt: the gag comes, the feint does not', async () => {
    const { sim, round } = await telegraphedRound();
    const feintAt = round.feintAt as number;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(feintAt), threatId: round.id });
    const events = runUntil(sim, () => round.state === 'gag');
    expect(typesOf(events)).not.toContain('WaitFeintGiven');
    expect(round.isFeintGiven).toBe(false);
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'wait', quality: 'fail', reason: 'early' }),
    ]);
    // And it does not come right after either: the round is over (the retreat's next round has its own telegraph).
    expect(typesOf(stepEvents(sim, 3))).not.toContain('WaitFeintGiven');
  });
});

describe('judging a press around the feint: no new code, only proof (story 4.7, AC 4)', () => {
  /** What happens to a press stamped `at`, queued before anything is stepped. */
  async function pressAt(offset: (round: ThreatInstance) => number, seed = 1) {
    const { sim, round } = await telegraphedRound({ seed });
    const at = offset(round);
    sim.enqueue({ type: 'PressThreat', t: asSimMs(at), threatId: round.id });
    const events = runUntil(sim, () => round.state === 'gag' || round.state === 'resolved');
    return { events, round, at };
  }

  const gagged = (events: readonly SimEvent[]) => {
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'wait', quality: 'fail', reason: 'early' }),
    ]);
    expect(ofType(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_sat_up', reason: 'early' }),
    ]);
  };

  it.each([
    ['before the feint', (round: ThreatInstance) => (round.feintAt as number) - 400],
    ['at feintAt exactly', (round: ThreatInstance) => round.feintAt as number],
    ['one step after the feint', (round: ThreatInstance) => (round.feintAt as number) + STEP_MS],
    ['one ms before the signal', (round: ThreatInstance) => round.windowOpenAt - 1],
  ])('a press %s is an early gag, whatever earlyPress says', async (_name, offset) => {
    const { events } = await pressAt(offset);
    gagged(events);
  });

  it('judges the same with earlyPress guard and fail: the strict rule does not read it', async () => {
    for (const earlyPress of ['guard', 'fail'] as const) {
      const guarded = {
        ...content,
        feel: { ...content.feel, input: { ...content.feel.input, earlyPress } },
      };
      const sim = await createSim({
        content: guarded,
        geometry,
        level: createTestLevel({
          carry: CARRY,
          sequences: [ROUND_ONLY.id],
          sequenceDefs: { [ROUND_ONLY.id]: ROUND_ONLY },
        }),
        seed: 1,
      });
      sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: ROUND_ONLY.id });
      const round = roundOf(sim);
      runUntil(sim, () => round.state === 'telegraph');
      sim.enqueue({ type: 'PressThreat', t: asSimMs(round.feintAt as number), threatId: round.id });
      gagged(runUntil(sim, () => round.state === 'gag'));
    }
  });

  it('judges a press stamped before the signal that arrives after it as early', async () => {
    const { sim, round } = await telegraphedRound();
    const { windowOpenAt } = round;
    runTo(sim, windowOpenAt + 2 * STEP_MS);
    expect(round.state).toBe('windowOpen');
    sim.enqueue({ type: 'PressThreat', t: asSimMs(windowOpenAt - 30), threatId: round.id });
    gagged(runTo(sim, windowOpenAt + 4 * STEP_MS));
  });

  it('judges a press in the window after a given feint as it would with no feint: same quality, same offset', async () => {
    for (const afterMs of [0, 100, 250]) {
      const { sim, round } = await telegraphedRound({ seed: 2 });
      const at = round.windowOpenAt + afterMs;
      const expected = judgePress(at, round.windowOpenAt, round.responseWindow as never);
      sim.enqueue({ type: 'PressThreat', t: asSimMs(at), threatId: round.id });
      sim.enqueue({ type: 'Release', t: asSimMs(at + 50) });
      const events = runUntil(sim, () => round.state === 'resolved' || round.state === 'gag');
      expect(round.isFeintGiven).toBe(true);
      expect(ofType(events, 'ResponseResolved')).toEqual([
        expect.objectContaining({
          response: 'wait',
          quality: expected.quality,
          offsetMs: expected.offsetMs,
        }),
      ]);
      expect(['perfect', 'success']).toContain(expected.quality);
      expect(typesOf(events)).not.toContain('GagTriggered');
    }
  });
});

describe('the cost of a gag on the fake sleep: noise through gagCryMs (story 4.7, AC 8)', () => {
  const perSec = content.feel.noise.sources.babyCrying.perSec;
  const { decayPerSec } = content.feel.noise;

  it('makes two BabyCrying on a press on the feint, the baby carried, and raises the noise by two cries less the decay', async () => {
    const { sim, world, round } = await telegraphedRound({ hasNoise: true });
    expect(world.baby.state).toBe('carried');
    expect(world.gauges.noisePct).toBe(0);
    sim.enqueue({ type: 'PressThreat', t: asSimMs(round.feintAt as number), threatId: round.id });
    const gagEvents = runUntil(sim, () => round.state === 'gag');
    const gagAt = (ofType(gagEvents, 'GagTriggered')[0]?.t ?? Number.NaN) as number;
    const events = [...gagEvents, ...runTo(sim, gagAt + (FAKE.gagCryMs ?? 0) + 500)];
    expect(ofType(events, 'BabyCrying')).toHaveLength(Math.floor((FAKE.gagCryMs ?? 0) / 1000));
    expect(ofType(events, 'BabyCrying')).toHaveLength(2);
    const raised = 2 * perSec;
    // The decay is at most `decayPerSec` for each second the cry and its tail take.
    const elapsedSec = (world.time.sim - gagAt) / 1000;
    expect(world.gauges.noisePct).toBeLessThanOrEqual(raised);
    expect(world.gauges.noisePct).toBeGreaterThanOrEqual(raised - decayPerSec * elapsedSec - 0.001);
    expect(world.gauges.noisePct).toBeGreaterThan(0);
  });

  it('makes the same cry for a late press: one gag per def, one cost', async () => {
    const { sim, round } = await telegraphedRound({ hasNoise: true });
    const events = runUntil(sim, () => round.state === 'gag');
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late' }),
    ]);
    const cries = ofType(runTo(sim, worldOf(sim).time.sim + 2500), 'BabyCrying');
    expect(cries).toHaveLength(2);
  });

  it('makes no noise in a level without the noise gauge, and the cry still comes', async () => {
    const { sim, world, round } = await telegraphedRound({ hasNoise: false });
    sim.enqueue({ type: 'PressThreat', t: asSimMs(round.feintAt as number), threatId: round.id });
    const events = runUntil(sim, () => round.state === 'gag');
    const all = [...events, ...runTo(sim, world.time.sim + 2500)];
    expect(typesOf(all)).not.toContain('NoiseChanged');
    expect(world.gauges.noisePct).toBe(0);
    // The cry does not need the gauge: it still comes, twice.
    expect(ofType(all, 'BabyCrying')).toHaveLength(2);
  });

  it('keeps a cry from covering the next round’s signal: the earliest signal after a gag is later than the cry', () => {
    const step = ROUND_ONLY.steps[0];
    if (step === undefined || step.kind !== 'duel') throw new Error('the round is not a duel step');
    const earliestSignalMs = step.restMs + telegraphDelayMs + minDelayMs;
    expect(earliestSignalMs).toBeGreaterThan(FAKE.gagCryMs ?? Number.POSITIVE_INFINITY);
    // The eyes' round after it is the same: its own earliest signal is past the fake sleep's cry too.
    const eyesStep = createTestFakeSleepDuel().steps[0];
    if (eyesStep === undefined || eyesStep.kind !== 'duel') throw new Error('no eyes step');
    expect(eyesStep.restMs + (EYES.telegraphDelayMs ?? 0) + (EYES.minDelayMs ?? 0)).toBeGreaterThan(
      FAKE.gagCryMs ?? Number.POSITIVE_INFINITY,
    );
  });
});
