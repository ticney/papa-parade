import { STEP_MS } from '@shared/constants';
import { createRng, nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestSilence,
  OUTLET,
  SILENCE,
  stepN,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { PapaSlice } from '../world.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const FEEL = content.feel.baby;
const def = createTestSilence();
if (def.target !== 'hiddenZone') throw new Error('the frozen silence must be a hidden-zone def');
const { findMaxMs, surpriseGags } = def;
const zone = geometry.zones.find((candidate) => candidate.id === 'behind_sofa');
if (zone === undefined) throw new Error('the frozen room has no behind_sofa zone');
const [zoneXM, , zoneZM] = zone.centerM;

async function newSim(options: { durationMs?: number; seed?: number } = {}): Promise<Sim> {
  return createSim({
    content,
    geometry,
    level: createTestLevel({
      waves: [testWave([SILENCE])],
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
    }),
    seed: options.seed ?? 1,
  });
}

/** Steps until `isDone` (bounded) and returns every event emitted. */
function runUntil(sim: Sim, isDone: () => boolean, maxSteps = 3000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !isDone(); i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

/** A sim stopped on the step where `SilenceStarted` was emitted. */
async function started(options: { durationMs?: number; seed?: number } = {}) {
  const sim = await newSim(options);
  const events = runUntil(sim, () => sim.world.silence.startedAt !== null);
  expect(sim.world.silence.startedAt).not.toBeNull();
  return { sim, events };
}

const tapBaby = (sim: Sim) => sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });

describe('runSilence: the baby hides', () => {
  it('takes the hidden threat at once: mischiefSilent, a path to the zone, still babbling', async () => {
    const sim = await newSim();
    sim.step();
    const events = sim.drainEvents();
    const threat = sim.world.threats[0];
    expect(threat).toMatchObject({ state: 'hidden', defId: 'silence_mischief' });
    expect(ofType(events, 'ThreatHidden')).toEqual([
      expect.objectContaining({ threatId: threat?.id, kind: 'silence_mischief', waveIndex: 0 }),
    ]);
    expect(ofType(events, 'ThreatTelegraphed')).toEqual([]);
    expect(ofType(events, 'BabyStateChanged')).toEqual([
      expect.objectContaining({ from: 'babble', to: 'mischiefSilent' }),
    ]);
    const { baby, silence } = sim.world;
    expect(silence).toEqual({ threatId: threat?.id, zoneEnteredAt: null, startedAt: null });
    expect(baby.targetThreatId).toBe(threat?.id);
    expect(baby.babbling).toBe(true);
    expect(baby.path.length).toBeGreaterThan(0);
  });

  it('crawls at sneakSpeedMps, babbling all the way, and goes quiet on entering the zone box', async () => {
    const sim = await newSim();
    const budgetM = (FEEL.sneakSpeedMps * STEP_MS) / 1000;
    let enteredAt: number | null = null;
    for (let i = 0; i < 2000 && enteredAt === null; i++) {
      const { baby } = sim.world;
      const fromX = baby.xM;
      const fromZ = baby.zM;
      sim.step();
      const { baby: after } = sim.world;
      expect(Math.hypot(after.xM - fromX, after.zM - fromZ)).toBeLessThanOrEqual(budgetM + 1e-9);
      if (sim.world.silence.zoneEnteredAt !== null) enteredAt = sim.world.silence.zoneEnteredAt;
      else expect(after.babbling).toBe(true);
    }
    expect(enteredAt).not.toBeNull();
    const { baby } = sim.world;
    expect(baby.babbling).toBe(false);
    expect(Math.abs(baby.xM - zone.centerM[0])).toBeLessThanOrEqual(zone.halfExtentsM[0]);
    expect(Math.abs(baby.zM - zone.centerM[2])).toBeLessThanOrEqual(zone.halfExtentsM[2]);
    expect(baby.path).toEqual([]);
    expect(baby.state).toBe('mischiefSilent');
  });

  it('emits SilenceStarted exactly silenceAlertMs after the zone entry, once', async () => {
    const sim = await newSim();
    const events = runUntil(sim, () => sim.world.silence.startedAt !== null);
    const { zoneEnteredAt, startedAt } = sim.world.silence;
    expect(startedAt).toBe((zoneEnteredAt as number) + FEEL.silenceAlertMs);
    const startedEvents = ofType(events, 'SilenceStarted');
    expect(startedEvents).toEqual([
      expect.objectContaining({ t: startedAt, threatId: sim.world.threats[0]?.id }),
    ]);
    // Nothing more is announced while the baby stays hidden.
    const later = runUntil(sim, () => sim.world.time.sim >= (startedAt as number) + 1000);
    expect(ofType(later, 'SilenceStarted')).toEqual([]);
  });

  it('never locks on another threat while hiding', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ waves: [testWave([SILENCE, OUTLET], { maxSimultaneous: 2 })] }),
      seed: 3,
    });
    const events = runUntil(sim, () => sim.world.silence.startedAt !== null);
    const lock = ofType(events, 'BabyStateChanged').filter((event) => event.to === 'targetLocked');
    // Whichever the director drew first, the baby is on the silence while it is hidden.
    if (sim.world.silence.threatId !== null) {
      expect(sim.world.baby.targetThreatId).toBe(sim.world.silence.threatId);
      expect(sim.world.baby.state).toBe('mischiefSilent');
    }
    expect(lock.length).toBeLessThanOrEqual(1);
  });
});

describe('runSilence: finding the baby', () => {
  it('a TapBaby after SilenceStarted ends it: found, babbling, targetLocked, then the telegraph', async () => {
    const { sim } = await started();
    const startedAt = sim.world.silence.startedAt as number;
    tapBaby(sim);
    const events = runUntil(sim, () => sim.world.silence.threatId === null, 5);
    const order = events
      .map((event) => event.type)
      .filter((type) => ['SilenceEnded', 'BabyStateChanged', 'ThreatTelegraphed'].includes(type));
    expect(order).toEqual(['SilenceEnded', 'BabyStateChanged', 'ThreatTelegraphed']);
    expect(ofType(events, 'SilenceEnded')).toEqual([
      expect.objectContaining({ reason: 'found', threatId: sim.world.threats[0]?.id }),
    ]);
    const { baby, silence } = sim.world;
    expect(silence).toEqual({ threatId: null, zoneEnteredAt: null, startedAt: null });
    expect(baby.babbling).toBe(true);
    expect(baby.state).toBe('targetLocked');
    expect(baby.targetThreatId).toBe(sim.world.threats[0]?.id);
    expect(sim.world.threats[0]?.state).toBe('telegraph');
    expect(sim.world.time.sim).toBeLessThanOrEqual(startedAt + 2 * STEP_MS);
  });

  it('opens the window telegraphDelayMs after the find, like any other threat', async () => {
    const { sim } = await started();
    tapBaby(sim);
    const events = runUntil(sim, () => sim.world.threats[0]?.state === 'windowOpen', 500);
    const [telegraphed] = ofType(events, 'ThreatTelegraphed');
    const [opened] = ofType(events, 'WindowOpened');
    expect(telegraphed).toBeDefined();
    expect(opened).toBeDefined();
    // The window opens at the first step at or after the delay.
    const delayMs = def.telegraphDelayMs as number;
    expect((opened?.t as number) - (telegraphed?.t as number)).toBeGreaterThanOrEqual(delayMs);
    expect((opened?.t as number) - (telegraphed?.t as number)).toBeLessThan(delayMs + STEP_MS);
  });

  it('a TapBaby before SilenceStarted does not find him: Papa only walks to the baby', async () => {
    const sim = await newSim();
    stepN(sim, 5);
    tapBaby(sim);
    const events = runUntil(sim, () => sim.world.time.sim >= 100);
    expect(ofType(events, 'SilenceEnded')).toEqual([]);
    expect(ofType(events, 'PapaPathPlanned').length).toBe(1);
    expect(sim.world.papa.state).toBe('walkPath');
    expect(sim.world.silence.threatId).not.toBeNull();
  });

  it('Papa walking into the box finds him, with no tap', async () => {
    const { sim } = await started();
    const papa = sim.world.papa as PapaSlice;
    papa.xM = zoneXM;
    papa.zM = zoneZM;
    const events = runUntil(sim, () => sim.world.silence.threatId === null, 5);
    expect(ofType(events, 'SilenceEnded')).toEqual([expect.objectContaining({ reason: 'found' })]);
    expect(sim.world.threats[0]?.state).toBe('telegraph');
  });

  it('Papa outside the box finds nothing', async () => {
    const { sim } = await started();
    const events = runUntil(
      sim,
      () => sim.world.time.sim >= (sim.world.silence.startedAt as number) + 1000,
    );
    expect(ofType(events, 'SilenceEnded')).toEqual([]);
    expect(sim.world.silence.threatId).not.toBeNull();
  });

  it('a TapBaby while Papa is busy does not find him', async () => {
    const { sim } = await started();
    const papa = sim.world.papa as PapaSlice;
    papa.state = 'drink';
    papa.busyUntil = asSimMs(sim.world.time.sim + 60_000);
    tapBaby(sim);
    const events = runUntil(
      sim,
      () => sim.world.time.sim >= (sim.world.silence.startedAt as number) + 500,
    );
    expect(ofType(events, 'SilenceEnded')).toEqual([]);
    expect(sim.world.silence.threatId).not.toBeNull();
  });
});

describe('runSilence: not found in time', () => {
  it('plays the surprise mischief at startedAt + findMaxMs: timedOut, a late gag from the list, mess', async () => {
    const { sim } = await started();
    const startedAt = sim.world.silence.startedAt as number;
    const events = runUntil(sim, () => sim.world.silence.threatId === null);
    const ended = ofType(events, 'SilenceEnded');
    expect(ended).toEqual([
      expect.objectContaining({ reason: 'timedOut', t: startedAt + findMaxMs }),
    ]);
    const threatId = sim.world.threats[0]?.id;
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ threatId, quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
    const gags = ofType(events, 'GagTriggered');
    expect(gags).toHaveLength(1);
    expect(surpriseGags).toContain(gags[0]?.gag);
    expect(ofType(events, 'NearMiss')).toEqual([]);
    expect(sim.world.mess.mischiefs).toBe(1);
    expect(sim.world.baby.babbling).toBe(true);
    expect(sim.world.threats[0]?.state).toBe('gag');
    // The baby plays the mischief out, then babbles again.
    run(sim, 1);
    expect(sim.world.baby.state).toBe('act');
    const after = runUntil(sim, () => sim.world.baby.state === 'babble');
    expect(after.length).toBeGreaterThan(0);
  });

  it('draws the gag with exactly one nextFloat', async () => {
    const { sim } = await started();
    const startedAt = sim.world.silence.startedAt as number;
    runUntil(sim, () => sim.world.time.sim >= startedAt + findMaxMs - STEP_MS);
    const expected = createRng(0);
    Object.assign(expected, structuredClone(sim.world.rng));
    sim.step();
    nextFloat(expected);
    expect(sim.world.silence.threatId).toBeNull();
    expect(sim.world.rng).toEqual(expected);
  });

  it('a find and the deadline in one step: the find wins', async () => {
    const { sim } = await started();
    const startedAt = sim.world.silence.startedAt as number;
    runUntil(sim, () => sim.world.time.sim >= startedAt + findMaxMs - STEP_MS);
    // Papa stands in the box as the deadline step runs.
    (sim.world.papa as PapaSlice).xM = zoneXM;
    (sim.world.papa as PapaSlice).zM = zoneZM;
    sim.step();
    const events = sim.drainEvents();
    expect(ofType(events, 'SilenceEnded')).toEqual([
      expect.objectContaining({ reason: 'found', t: startedAt + findMaxMs }),
    ]);
    expect(ofType(events, 'GagTriggered')).toEqual([]);
    expect(sim.world.mess.mischiefs).toBe(0);
  });
});

describe('runSilence: the level', () => {
  it('stops with the level: nothing moves once it has ended, a silence under way included', async () => {
    const sim = await newSim({ durationMs: 4000 });
    const events = runUntil(sim, () => sim.world.flow.state === 'ended');
    expect(ofType(events, 'LevelEnded')).toHaveLength(1);
    const frozen = structuredClone(sim.world.silence);
    const baby = structuredClone(sim.world.baby);
    const later = runUntil(sim, () => sim.world.time.sim >= 12_000);
    expect(later).toEqual([]);
    expect(sim.world.silence).toEqual(frozen);
    expect(sim.world.baby).toEqual(baby);
  });

  it('is deterministic: the same seed gives the same silence', async () => {
    const first = await newSim({ seed: 9 });
    const second = await newSim({ seed: 9 });
    const a = runUntil(first, () => first.world.time.sim >= 12_000);
    const b = runUntil(second, () => second.world.time.sim >= 12_000);
    expect(b).toEqual(a);
    expect(ofType(a, 'GagTriggered')).toHaveLength(1);
  });
});

function run(sim: Sim, steps: number): void {
  stepN(sim, steps);
  sim.drainEvents();
}
