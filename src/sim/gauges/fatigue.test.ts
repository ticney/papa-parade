import type { ContentBundle } from '@content/contentBundle';
import type { Feel } from '@content/schemas/feel';
import { MS_PER_S, STEP_MS } from '@shared/constants';
import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  stepN,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { putPapaToSleep } from '../papa/sleep.ts';
import type { World } from '../world.ts';
import { addFatigue, fatigueWindowModifier, isBabyCarried } from './fatigue.ts';

const base = createTestContent();
const geometry = createTestGeometry();
const { fatigue: fatigueFeel, timing, difficulty } = base.feel;
const GAIN_PER_STEP = (fatigueFeel.perSec * STEP_MS) / MS_PER_S;

function contentWith(fatigue: Partial<Feel['fatigue']> = {}): ContentBundle {
  return { ...base, feel: { ...base.feel, fatigue: { ...fatigueFeel, ...fatigue } } };
}

interface Options {
  fatigue?: Partial<Feel['fatigue']>;
  hasFatigue?: boolean;
  waves?: ReturnType<typeof testWave>[];
  durationMs?: number;
  seed?: number;
}

async function newSim({
  fatigue,
  hasFatigue = true,
  waves = [],
  durationMs,
  seed = 1,
}: Options = {}): Promise<Sim> {
  return createSim({
    content: contentWith(fatigue),
    geometry,
    level: createTestLevel({
      waves,
      gauges: hasFatigue ? FATIGUE_GAUGES : {},
      ...(durationMs === undefined ? {} : { durationMs }),
    }),
    seed,
  });
}

const setFatigue = (sim: Sim, points: number) =>
  sim.enqueue({ type: 'SetFatigue', t: asSimMs(sim.world.time.sim), points });

/** Steps until `untilSimMs`, collecting every event. */
function runUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

type Telegraphed = Extract<SimEvent, { type: 'ThreatTelegraphed' }>;
const microSleeps = (events: readonly SimEvent[]): Telegraphed[] =>
  events.filter(
    (event): event is Telegraphed =>
      event.type === 'ThreatTelegraphed' && event.kind === 'papa_microsleep',
  );
const crossings = (events: readonly SimEvent[]) =>
  events.filter((event) => event.type === 'FatigueThresholdCrossed');

/** A context that only collects events, over a real world, for the helpers that take `(world, ctx)`. */
async function helperSetup(fatigue: Partial<Feel['fatigue']> = {}) {
  const sim = await newSim({ fatigue });
  const world = sim.world as World;
  world.time.sim = asSimMs(500);
  const events: SimEvent[] = [];
  const ctx = {
    feel: contentWith(fatigue).feel,
    events,
    strictInvariants: true,
    t: world.time.sim,
    level: { microSleepIndex: 0 },
  } as unknown as StepContext;
  return { world, ctx, events };
}

describe('the fatigue gauge', () => {
  it('starts at feel.fatigue.startPoints', async () => {
    expect((await newSim()).world.gauges.fatigue).toBe(fatigueFeel.startPoints);
    expect((await newSim({ fatigue: { startPoints: 30 } })).world.gauges.fatigue).toBe(30);
  });

  it('rises by perSec × STEP_MS / 1000 at each step, in every Papa state', async () => {
    const sim = await newSim();
    stepN(sim, 100);
    expect(sim.world.gauges.fatigue).toBeCloseTo(100 * GAIN_PER_STEP, 9);
    // While walking too.
    sim.enqueue({ type: 'Move', t: asSimMs(sim.world.time.sim), dirX: 1, dirZ: 0 });
    stepN(sim, 100);
    expect(sim.world.papa.state).toBe('walkDir');
    expect(sim.world.gauges.fatigue).toBeCloseTo(200 * GAIN_PER_STEP, 9);
  });

  it('is held at 100 and at 0, silently (a rule, not an invariant violation)', async () => {
    const sim = await newSim();
    setFatigue(sim, 250);
    const events = runUntil(sim, 200);
    expect(sim.world.gauges.fatigue).toBe(100);
    expect(events.map((event) => event.type)).not.toContain('InvariantViolated');
    setFatigue(sim, -40);
    stepN(sim, 1);
    expect(sim.world.gauges.fatigue).toBeCloseTo(GAIN_PER_STEP, 9);
  });

  it('does nothing in a level with no fatigue gauge: no draw, no event, the value stays at its start', async () => {
    const withStart = await newSim({ hasFatigue: false, fatigue: { startPoints: 90 } });
    const plain = await newSim({ hasFatigue: false });
    const events = runUntil(withStart, 10_000);
    runUntil(plain, 10_000);
    expect(withStart.world.gauges.fatigue).toBe(90);
    expect(withStart.world.gauges.isFatigueAbove).toBe(false);
    expect(withStart.world.gauges.microSleepAt).toBeNull();
    expect(crossings(events)).toEqual([]);
    expect(microSleeps(events)).toEqual([]);
    // The baby draws from the same stream: the streams agree only if the fatigue system drew nothing.
    expect(withStart.world.rng).toEqual(plain.world.rng);
  });

  it('ignores SetFatigue in a level with no fatigue gauge', async () => {
    const sim = await newSim({ hasFatigue: false });
    setFatigue(sim, 80);
    stepN(sim, 5);
    expect(sim.world.gauges.fatigue).toBe(0);
  });

  it('stops once the level has ended', async () => {
    const sim = await newSim({ durationMs: 1000 });
    runUntil(sim, 1000);
    expect(sim.world.flow.state).toBe('ended');
    const frozen = sim.world.gauges.fatigue;
    stepN(sim, 200);
    expect(sim.world.gauges.fatigue).toBe(frozen);
  });

  it('never counts the baby as carried until epic 4', async () => {
    const { world } = await helperSetup();
    expect(isBabyCarried(world)).toBe(false);
  });
});

describe('the threshold', () => {
  it('crosses up once, and draws the first micro-sleep once, between min and max after the crossing', async () => {
    const sim = await newSim();
    stepN(sim, 5); // before the baby's first draw (babbleMinMs)
    const before = { ...sim.world.rng };
    setFatigue(sim, 71);
    const events = runUntil(sim, sim.world.time.sim + 300);
    const [crossing, ...others] = crossings(events);
    expect(others).toEqual([]);
    expect(crossing).toMatchObject({ isAbove: true });
    // Exactly one nextFloat was drawn by the whole step.
    const probe = { ...before };
    const draw = nextFloat(probe);
    expect(sim.world.rng).toEqual(probe);
    const crossedAt = (crossing as { t: number }).t;
    const { microSleepMinMs, microSleepMaxMs } = fatigueFeel;
    expect(sim.world.gauges.microSleepAt).toBe(
      crossedAt + microSleepMinMs + draw * (microSleepMaxMs - microSleepMinMs),
    );
  });

  it('crosses down once and cancels the pending micro-sleep', async () => {
    const sim = await newSim();
    setFatigue(sim, 90);
    stepN(sim, 2);
    expect(sim.world.gauges.microSleepAt).not.toBeNull();
    sim.drainEvents();
    setFatigue(sim, 10);
    const events = runUntil(sim, sim.world.time.sim + 100);
    expect(crossings(events)).toEqual([expect.objectContaining({ isAbove: false })]);
    expect(sim.world.gauges.microSleepAt).toBeNull();
    expect(sim.world.gauges.isFatigueAbove).toBe(false);
  });

  it('is strict: exactly the threshold is not above, a hair over is', async () => {
    const { world, ctx, events } = await helperSetup();
    const { thresholdPoints } = fatigueFeel;
    addFatigue(world, ctx, thresholdPoints - world.gauges.fatigue);
    expect(world.gauges.fatigue).toBe(thresholdPoints);
    expect(world.gauges.isFatigueAbove).toBe(false);
    expect(events).toEqual([]);
    expect(fatigueWindowModifier(world, ctx)).toBe(1);
    addFatigue(world, ctx, 0.01);
    expect(world.gauges.isFatigueAbove).toBe(true);
    expect(events).toEqual([expect.objectContaining({ type: 'FatigueThresholdCrossed' })]);
    expect(fatigueWindowModifier(world, ctx)).toBe(1 - fatigueFeel.windowPenaltyPct / 100);
  });

  it('crosses at the very first step when startPoints is already above', async () => {
    const sim = await newSim({ fatigue: { startPoints: 80 } });
    expect(sim.world.gauges.isFatigueAbove).toBe(false);
    sim.step();
    expect(crossings(sim.drainEvents())).toEqual([
      expect.objectContaining({ isAbove: true, t: STEP_MS }),
    ]);
  });
});

describe('shrunk windows', () => {
  const baseWindowMs = timing.windowMs * difficulty.normal.windowMultiplier;
  const shrunkMs = baseWindowMs * (1 - fatigueFeel.windowPenaltyPct / 100);

  it('freezes base × tier × (1 − penalty) for a threat telegraphed above the threshold', async () => {
    const sim = await newSim({
      fatigue: { startPoints: 90 },
      waves: [testWave([OUTLET])],
    });
    stepN(sim, 1);
    expect(sim.world.threats[0]?.state).toBe('telegraph');
    expect(sim.world.threats[0]?.responseWindow?.windowMs).toBeCloseTo(shrunkMs, 9);
  });

  it('keeps the full window below the threshold', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET])] });
    stepN(sim, 1);
    expect(sim.world.threats[0]?.responseWindow?.windowMs).toBe(baseWindowMs);
  });

  it('does not move a window already frozen when fatigue crosses (1.10 D8)', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET])] });
    stepN(sim, 1);
    setFatigue(sim, 95);
    stepN(sim, 3);
    expect(sim.world.gauges.isFatigueAbove).toBe(true);
    expect(sim.world.threats[0]?.responseWindow?.windowMs).toBe(baseWindowMs);
  });

  it("shrinks the micro-sleep's own window too", async () => {
    const sim = await newSim({
      fatigue: { startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 },
    });
    const events = runUntil(sim, 100);
    expect(microSleeps(events)).toHaveLength(1);
    const instance = sim.world.threats[0];
    expect(instance?.defId).toBe('papa_microsleep');
    expect(instance?.responseWindow?.windowMs).toBeCloseTo(shrunkMs, 9);
  });
});

describe('the micro-sleeps', () => {
  const { microSleepMinMs: minMs, microSleepMaxMs: maxMs } = fatigueFeel;

  it('come in the 8-12 s band: the first after the crossing, each next after the previous telegraph', async () => {
    const sim = await newSim();
    setFatigue(sim, 90);
    const events = runUntil(sim, 60_000);
    const [crossing] = crossings(events);
    const telegraphs = microSleeps(events);
    expect(telegraphs.length).toBeGreaterThanOrEqual(3);
    const crossedAt = (crossing as { t: number }).t;
    expect((telegraphs[0] as Telegraphed).t).toBeGreaterThanOrEqual(crossedAt + minMs);
    expect((telegraphs[0] as Telegraphed).t).toBeLessThanOrEqual(crossedAt + maxMs + STEP_MS);
    for (let i = 1; i < telegraphs.length; i++) {
      const gap = (telegraphs[i] as Telegraphed).t - (telegraphs[i - 1] as Telegraphed).t;
      expect(gap).toBeGreaterThanOrEqual(minMs);
      expect(gap).toBeLessThanOrEqual(maxMs + STEP_MS);
    }
    for (const telegraph of telegraphs) {
      expect(telegraph).toMatchObject({ waveIndex: -1, anchorId: 'papa', kind: 'papa_microsleep' });
    }
  });

  it('are the same instants for the same seed, and others for another', async () => {
    const instants = async (seed: number) => {
      const sim = await newSim({ seed });
      setFatigue(sim, 90);
      return microSleeps(runUntil(sim, 40_000)).map((event) => event.t);
    };
    expect(await instants(7)).toEqual(await instants(7));
    expect(await instants(7)).not.toEqual(await instants(8));
  });

  it('stand on Papa: the instance follows him at every step', async () => {
    const sim = await newSim();
    sim.enqueue({ type: 'Move', t: asSimMs(0), dirX: 1, dirZ: 0 });
    stepN(sim, 50);
    const { papa } = sim.world;
    expect(papa.state).toBe('walkDir');
    expect(sim.world.threats[0]).toMatchObject({ xM: papa.xM, zM: papa.zM });
  });

  it('wait while Papa is busy and go at the first step he is not', async () => {
    const sim = await newSim({
      fatigue: { startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 },
    });
    const world = sim.world as World;
    const ctx = {
      feel: contentWith({ microSleepMinMs: 0, microSleepMaxMs: 0 }).feel,
      events: [] as SimEvent[],
      strictInvariants: true,
      t: world.time.sim,
    } as unknown as StepContext;
    putPapaToSleep(world, ctx);
    const wakeAt = world.papa.busyUntil;
    const events = runUntil(sim, wakeAt + 200);
    const [first] = microSleeps(events);
    expect(first?.t).toBe(wakeAt);
    expect(world.papa.state).not.toBe('asleep');
  });

  it('wait while the instance is not idle (resolved or gag, in cooldown) and then go', async () => {
    const sim = await newSim({
      fatigue: { startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 },
    });
    const events = runUntil(sim, 12_000);
    const telegraphs = microSleeps(events);
    expect(telegraphs.length).toBeGreaterThanOrEqual(2);
    const rearms = events.filter((event) => event.type === 'ThreatRearmed');
    for (let i = 1; i < telegraphs.length; i++) {
      const previous = telegraphs[i - 1] as Telegraphed;
      const rearmedBefore = rearms.filter(
        (event) => event.t > previous.t && event.t <= (telegraphs[i] as Telegraphed).t,
      );
      expect(rearmedBefore.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('are never telegraphed once the level has ended', async () => {
    const sim = await newSim({
      fatigue: { startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 },
      durationMs: 3000,
    });
    runUntil(sim, 3000);
    sim.drainEvents();
    const after = runUntil(sim, 20_000);
    expect(microSleeps(after)).toEqual([]);
  });
});

describe('judging the micro-sleep', () => {
  async function telegraphedSim() {
    const sim = await newSim({
      fatigue: { startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 },
    });
    runUntil(sim, 100);
    const instance = sim.world.threats[0];
    if (instance === undefined || instance.state !== 'telegraph')
      throw new Error('not telegraphed');
    return { sim, instance };
  }

  it('is parried like any threat, and the press does not glide Papa', async () => {
    const { sim, instance } = await telegraphedSim();
    sim.enqueue({ type: 'Move', t: asSimMs(sim.world.time.sim), dirX: 1, dirZ: 0 });
    stepN(sim, 2);
    const pressAt = instance.windowOpenAt + (instance.responseWindow?.windowMs ?? 0) / 2;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(pressAt), threatId: instance.id });
    sim.enqueue({ type: 'Release', t: asSimMs(pressAt + 100) });
    const events = runUntil(sim, pressAt + 600);
    expect(events.map((event) => event.type)).not.toContain('PapaGlideStarted');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', quality: 'perfect' }),
    );
    // He keeps walking where he was walking.
    expect(sim.world.papa.state).toBe('walkDir');
    expect(sim.world.papa.glide).toBeNull();
  });

  it('falls asleep for asleepMs when it is missed, with a papa_asleep gag and no near miss', async () => {
    const { sim } = await telegraphedSim();
    const events = runUntil(sim, 3000);
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'GagTriggered', gag: 'papa_asleep', reason: 'late' }),
    );
    expect(events.map((event) => event.type)).not.toContain('NearMiss');
    const asleep = events.find(
      (event) => event.type === 'PapaStateChanged' && event.to === 'asleep',
    ) as { t: number };
    expect(sim.world.papa.busyUntil).toBe(asleep.t + fatigueFeel.asleepMs);
    const wake = runUntil(sim, asleep.t + fatigueFeel.asleepMs + STEP_MS).find(
      (event) => event.type === 'PapaStateChanged' && event.from === 'asleep',
    ) as { t: number; to: string };
    expect(wake).toMatchObject({ to: 'idle', t: asleep.t + fatigueFeel.asleepMs });
  });
});
