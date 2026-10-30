import { readFileSync } from 'node:fs';
import { parseContentFile } from '@content/parseContentFile';
import type { Feel } from '@content/schemas/feel';
import { ThreatDefSchema } from '@content/schemas/threat';
import { STEP_MS } from '@shared/constants';
import { nextFloat, type RngState } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  SILENCE,
  stepN,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { createNavGrid } from '../nav/navGrid.ts';
import type { World } from '../world.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const babyGrid = createNavGrid(geometry, content.feel.baby.bodyRadiusM);
const playpen = geometry.zones.find((zone) => zone.id === 'playpen');
if (playpen === undefined) throw new Error('the frozen room has no playpen zone');
const [playpenXM, , playpenZM] = playpen.centerM;

interface Options {
  waves?: ReturnType<typeof testWave>[];
  carry?: boolean;
  fatigue?: boolean;
  durationMs?: number;
  seed?: number;
  feel?: (feel: Feel) => Feel;
}

async function newSim({
  waves = [],
  carry = true,
  fatigue = false,
  durationMs,
  seed = 1,
  feel,
}: Options = {}): Promise<Sim> {
  return createSim({
    content: feel === undefined ? content : { ...content, feel: feel(content.feel) },
    geometry,
    level: createTestLevel({
      waves,
      ...(carry ? { carry: CARRY } : {}),
      ...(fatigue ? { gauges: FATIGUE_GAUGES } : {}),
      ...(durationMs === undefined ? {} : { durationMs }),
    }),
    seed,
  });
}

const withCarry = (patch: Partial<Feel['carry']>) => (feel: Feel) => ({
  ...feel,
  carry: { ...feel.carry, ...patch },
});

const worldOf = (sim: Sim) => sim.world as World;

/** Steps `n` times and returns every event emitted. */
function stepEvents(sim: Sim, n = 1): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

/** Steps (bounded) until `isDone`, returning every event emitted. */
function runUntil(sim: Sim, isDone: () => boolean, maxSteps = 3000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !isDone(); i++) events.push(...stepEvents(sim));
  return events;
}

const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

const tapBaby = (sim: Sim) => sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });
const tapFloor = (sim: Sim, xM: number, zM: number) =>
  sim.enqueue({ type: 'TapFloor', t: asSimMs(sim.world.time.sim), xM, zM });

/** The baby sits `distM` from Papa, still (his next wander is far off), on an open cell. */
function placeBaby(sim: Sim, distM: number): void {
  const world = worldOf(sim);
  world.baby.xM = world.papa.xM - distM;
  world.baby.zM = world.papa.zM;
  world.baby.prevXM = world.baby.xM;
  world.baby.prevZM = world.baby.zM;
  world.baby.wanderAt = asSimMs(1_000_000);
}

/** The baby is taken at once, and the sim has stepped over it. */
async function carriedSim(options: Options = {}): Promise<{ sim: Sim; events: SimEvent[] }> {
  const sim = await newSim(options);
  placeBaby(sim, 0.5);
  tapBaby(sim);
  const events = stepEvents(sim);
  expect(worldOf(sim).baby.state).toBe('carried');
  return { sim, events };
}

/** How many `nextFloat` the rng went through between two states of it (bounded). */
function drawsBetween(before: RngState, after: RngState): number {
  const probe = structuredClone(before);
  for (let draws = 0; draws <= 8; draws++) {
    if (JSON.stringify(probe) === JSON.stringify(after)) return draws;
    nextFloat(probe);
  }
  return -1;
}

describe('TapBaby: what it does (story 4.1, rule 6)', () => {
  it('in a level without carry only walks Papa to the baby, as before', async () => {
    const sim = await newSim({ carry: false });
    placeBaby(sim, 0.5);
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'BabyPickedUp')).toEqual([]);
    expect(worldOf(sim).baby.state).toBe('babble');
    expect(ofType(events, 'PapaPathPlanned')).toHaveLength(1);
    expect(worldOf(sim).papa.intent).toBe('none');
  });

  it('takes a baby within reach at once: BabyStateChanged, then BabyPickedUp', async () => {
    const { sim, events } = await carriedSim();
    const world = worldOf(sim);
    const kinds = events
      .map((event) => event.type)
      .filter((type) => type === 'BabyStateChanged' || type === 'BabyPickedUp');
    expect(kinds).toEqual(['BabyStateChanged', 'BabyPickedUp']);
    expect(ofType(events, 'BabyStateChanged')).toEqual([
      { type: 'BabyStateChanged', t: world.time.sim, from: 'babble', to: 'carried' },
    ]);
    expect(ofType(events, 'BabyPickedUp')).toEqual([{ type: 'BabyPickedUp', t: world.time.sim }]);
    expect(ofType(events, 'PapaPathPlanned')).toEqual([]);
    expect(world.baby).toMatchObject({
      xM: world.papa.xM,
      zM: world.papa.zM,
      targetThreatId: null,
    });
    expect(world.baby.gazeX).toBe(world.papa.headingX);
    expect(world.baby.gazeZ).toBe(world.papa.headingZ);
  });

  it('walks to a baby out of reach, then takes him on arrival', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    world.baby.wanderAt = asSimMs(1_000_000);
    tapBaby(sim);
    const planned = stepEvents(sim);
    expect(ofType(planned, 'PapaPathPlanned')).toHaveLength(1);
    expect(world.papa.state).toBe('walkPath');
    expect(world.papa.intent).toBe('takeBaby');
    const events = runUntil(sim, () => world.baby.state === 'carried');
    expect(ofType(events, 'PapaArrived')).toHaveLength(1);
    expect(ofType(events, 'BabyPickedUp')).toHaveLength(1);
    expect(world.papa).toMatchObject({ state: 'idle', intent: 'none', objectId: null });
    expect(world.baby).toMatchObject({ xM: world.papa.xM, zM: world.papa.zM });
  });

  it('takes nothing when the baby has crawled out of reach by the time Papa arrives', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    world.baby.wanderAt = asSimMs(1_000_000);
    tapBaby(sim);
    stepEvents(sim);
    // He crawled off to the far corner of the room meanwhile.
    world.baby.xM = -3.5;
    world.baby.zM = 2.5;
    const events = runUntil(sim, () => world.papa.state === 'idle');
    expect(ofType(events, 'PapaArrived')).toHaveLength(1);
    expect(ofType(events, 'BabyPickedUp')).toEqual([]);
    expect(world.baby.state).toBe('babble');
    expect(world.papa.intent).toBe('none');
  });

  it('does not take a baby who is hiding (mischiefSilent): Papa only walks to where he is', async () => {
    const sim = await newSim({ waves: [testWave([SILENCE])] });
    stepEvents(sim);
    const world = worldOf(sim);
    expect(world.baby.state).toBe('mischiefSilent');
    // Within reach, and still not takeable.
    world.baby.xM = world.papa.xM - 0.3;
    world.baby.zM = world.papa.zM;
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'BabyPickedUp')).toEqual([]);
    expect(ofType(events, 'PapaPathPlanned')).toHaveLength(1);
    expect(world.baby.state).toBe('mischiefSilent');
    expect(world.papa.intent).toBe('none');
  });

  it('spends the tap that found the hidden baby: Papa stays and nothing is taken', async () => {
    const sim = await newSim({ waves: [testWave([SILENCE])] });
    const world = worldOf(sim);
    runUntil(sim, () => world.silence.startedAt !== null);
    const before = { xM: world.papa.xM, zM: world.papa.zM };
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'SilenceEnded')).toEqual([expect.objectContaining({ reason: 'found' })]);
    expect(ofType(events, 'BabyPickedUp')).toEqual([]);
    expect(ofType(events, 'PapaPathPlanned')).toEqual([]);
    expect(world.papa).toMatchObject({ ...before, state: 'idle' });
    expect(world.baby.state).toBe('targetLocked');
  });

  it('is ignored by a busy Papa', async () => {
    const sim = await newSim();
    placeBaby(sim, 0.5);
    const world = worldOf(sim);
    world.papa.state = 'asleep';
    world.papa.busyUntil = asSimMs(5000);
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'BabyPickedUp')).toEqual([]);
    expect(world.baby.state).toBe('babble');
  });

  it('puts the baby down where Papa stands when he is carried, and stops a walk', async () => {
    const { sim } = await carriedSim();
    const world = worldOf(sim);
    tapFloor(sim, 0, 1.5);
    stepEvents(sim, 3);
    expect(world.papa.state).toBe('walkPath');
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'BabyPutDown')).toHaveLength(1);
    expect(world.papa).toMatchObject({ state: 'idle', path: [], intent: 'none' });
    expect(world.baby.state).toBe('babble');
  });

  it('ignores a second TapBaby in the step that took or put down the baby', async () => {
    const sim = await newSim();
    const world = worldOf(sim);
    placeBaby(sim, 0.5);
    const rng = structuredClone(world.rng);
    // A pointer tap and Space in the same step: one take, not a take and a put-down.
    tapBaby(sim);
    tapBaby(sim);
    const taken = stepEvents(sim);
    expect(ofType(taken, 'BabyPickedUp')).toHaveLength(1);
    expect(ofType(taken, 'BabyPutDown')).toEqual([]);
    expect(world.baby.state).toBe('carried');
    expect(drawsBetween(rng, world.rng)).toBe(1);
    tapBaby(sim);
    tapBaby(sim);
    const putDown = stepEvents(sim);
    expect(ofType(putDown, 'BabyPutDown')).toHaveLength(1);
    expect(ofType(putDown, 'BabyPickedUp')).toEqual([]);
    expect(world.baby.state).toBe('babble');
  });

  it('puts the baby down only where the walk ends: a tap on a closed cell of a safe zone is not enough', async () => {
    // A strip of safe floor that starts inside the sofa (closed cells for Papa) and reaches open
    // floor beyond it: a tap on its closed end walks to the nearest open cell, which is outside it.
    const strip = {
      id: 'sofa_strip',
      kind: 'safe' as const,
      centerM: [0.9, 0.3, -1.75] as [number, number, number],
      halfExtentsM: [1.1, 0.3, 0.2] as [number, number, number],
    };
    const sim = await createSim({
      content,
      geometry: { ...geometry, zones: [...geometry.zones, strip] },
      level: createTestLevel({ carry: CARRY }),
      seed: 1,
    });
    const world = worldOf(sim);
    placeBaby(sim, 0.5);
    tapBaby(sim);
    stepEvents(sim);
    expect(world.baby.state).toBe('carried');
    tapFloor(sim, -0.1, -1.75);
    const planned = stepEvents(sim);
    const [path] = ofType(planned, 'PapaPathPlanned');
    if (path === undefined) throw new Error('no walk was planned');
    const [stripXM, , stripZM] = strip.centerM;
    const [stripHalfXM, , stripHalfZM] = strip.halfExtentsM;
    const isGoalInStrip =
      Math.abs(path.targetXM - stripXM) <= stripHalfXM &&
      Math.abs(path.targetZM - stripZM) <= stripHalfZM;
    expect(isGoalInStrip).toBe(false);
    // The tap itself is inside the strip: only the walk's end tells.
    expect(Math.abs(-0.1 - stripXM)).toBeLessThanOrEqual(stripHalfXM);
    expect(world.papa.intent).toBe('none');
    runUntil(sim, () => world.papa.state === 'idle');
    expect(world.baby.state).toBe('carried');
  });
});

describe('takeBaby', () => {
  it('draws exactly one nextFloat in a level with a cry in the arms, whatever the tuning', async () => {
    for (const tuning of [{}, { armsCryMinMs: 0, armsCryMaxMs: 0 }]) {
      const sim = await newSim({ feel: withCarry(tuning) });
      placeBaby(sim, 0.5);
      const before = structuredClone(worldOf(sim).rng);
      tapBaby(sim);
      stepEvents(sim);
      expect(drawsBetween(before, worldOf(sim).rng)).toBe(1);
    }
  });

  it('sets the first cry in the arms between min and max after the pick-up', async () => {
    const sim = await newSim();
    placeBaby(sim, 0.5);
    tapBaby(sim);
    stepEvents(sim);
    const world = worldOf(sim);
    const { armsCryMinMs, armsCryMaxMs } = content.feel.carry;
    const at = world.carry.armsCryAt as number;
    expect(at).toBeGreaterThanOrEqual(world.time.sim + armsCryMinMs);
    expect(at).toBeLessThanOrEqual(world.time.sim + armsCryMaxMs);
  });

  it('draws nothing in a level without a cry in the arms', async () => {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ carry: {} }),
      seed: 1,
    });
    placeBaby(sim, 0.5);
    const before = structuredClone(worldOf(sim).rng);
    tapBaby(sim);
    stepEvents(sim);
    expect(worldOf(sim).baby.state).toBe('carried');
    expect(drawsBetween(before, worldOf(sim).rng)).toBe(0);
    expect(worldOf(sim).carry.armsCryAt).toBeNull();
  });
});

describe('taking the baby cancels the threats aimed at him (rule 7)', () => {
  const outletWave = [testWave([OUTLET])];

  async function outletSim(options: Options = {}) {
    // The baby crawls to the outlet once it is telegraphed: a long reach keeps him takeable.
    const sim = await newSim({ waves: outletWave, feel: withCarry({ reachM: 100 }), ...options });
    placeBaby(sim, 0.5);
    return sim;
  }

  it('cancels a telegraphed threat with no gag, no result, no rearm, no slow-mo and no hitstop', async () => {
    const sim = await outletSim();
    const world = worldOf(sim);
    stepEvents(sim);
    const threat = world.threats[0];
    expect(threat?.state).toBe('telegraph');
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'ThreatCancelled')).toEqual([
      { type: 'ThreatCancelled', t: world.time.sim, threatId: threat?.id, reason: 'carried' },
    ]);
    for (const type of ['ResponseResolved', 'GagTriggered', 'ThreatRearmed', 'NearMiss'] as const) {
      expect(ofType(events, type), type).toEqual([]);
    }
    expect(threat).toMatchObject({
      state: 'idle',
      press: null,
      responseWindow: null,
      waveIndex: -1,
    });
    expect(world.time.slowMos).toEqual([]);
    expect(sim.freezeRealMs).toBe(0);
  });

  it('cancels an open window and drops its pending press', async () => {
    const sim = await outletSim();
    const world = worldOf(sim);
    stepEvents(sim);
    const threat = world.threats[0];
    if (threat === undefined) throw new Error('no outlet');
    runUntil(sim, () => threat.state === 'windowOpen');
    // A finger that stays down: the press is pending, nothing is decided.
    sim.enqueue({ type: 'PressThreat', t: asSimMs(world.time.sim), threatId: threat.id });
    stepEvents(sim);
    expect(threat.press).not.toBeNull();
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'ThreatCancelled')).toEqual([
      expect.objectContaining({ reason: 'carried' }),
    ]);
    expect(threat).toMatchObject({ state: 'idle', press: null });
  });

  it('leaves a gagged threat and an idle one alone', async () => {
    // A gag: the window runs out. The cooldown (6000 ms) is still running at the take.
    const gagged = await outletSim();
    const world = worldOf(gagged);
    const threat = world.threats[0];
    if (threat === undefined) throw new Error('no outlet');
    runUntil(gagged, () => threat.state === 'gag');
    tapBaby(gagged);
    const events = stepEvents(gagged);
    expect(ofType(events, 'BabyPickedUp')).toHaveLength(1);
    expect(ofType(events, 'ThreatCancelled')).toEqual([]);
    expect(threat.state).toBe('gag');

    // Nothing is up: nothing to cancel.
    const quiet = await newSim();
    placeBaby(quiet, 0.5);
    tapBaby(quiet);
    expect(ofType(stepEvents(quiet), 'ThreatCancelled')).toEqual([]);
  });

  it('leaves a resolved threat alone', async () => {
    const sim = await outletSim();
    const world = worldOf(sim);
    stepEvents(sim);
    const threat = world.threats[0];
    if (threat === undefined) throw new Error('no outlet');
    runUntil(sim, () => threat.state === 'windowOpen');
    const t = world.time.sim + 150;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: threat.id });
    sim.enqueue({ type: 'Release', t: asSimMs(t + 50) });
    runUntil(sim, () => threat.state === 'resolved');
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'ThreatCancelled')).toEqual([]);
    expect(threat.state).toBe('resolved');
  });

  it('does not cancel a threat on Papa (the micro-sleep)', async () => {
    const sim = await newSim({
      fatigue: true,
      feel: (feel) => ({
        ...feel,
        fatigue: { ...feel.fatigue, startPoints: 100, microSleepMinMs: 0, microSleepMaxMs: 0 },
      }),
    });
    placeBaby(sim, 0.5);
    const world = worldOf(sim);
    const microSleep = world.threats[0];
    stepEvents(sim);
    expect(microSleep?.state).toBe('telegraph');
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'BabyPickedUp')).toHaveLength(1);
    expect(ofType(events, 'ThreatCancelled')).toEqual([]);
    expect(microSleep?.state).toBe('telegraph');
  });

  it('cancels the threat of a found silence too, so that it cannot gag a carried baby', async () => {
    const sim = await newSim({ waves: [testWave([SILENCE])], feel: withCarry({ reachM: 100 }) });
    const world = worldOf(sim);
    runUntil(sim, () => world.silence.startedAt !== null);
    // The tap that finds the baby is spent; he is then locked on the revealed threat.
    tapBaby(sim);
    stepEvents(sim);
    const threat = world.threats[0];
    if (threat === undefined) throw new Error('no silence threat');
    expect(world.baby.state).toBe('targetLocked');
    expect(threat.state).toBe('telegraph');
    const mischiefs = world.mess.mischiefs;
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'BabyPickedUp')).toHaveLength(1);
    expect(ofType(events, 'ThreatCancelled')).toEqual([
      { type: 'ThreatCancelled', t: world.time.sim, threatId: threat.id, reason: 'carried' },
    ]);
    expect(threat).toMatchObject({ state: 'idle', press: null, responseWindow: null });
    expect(world.baby.targetThreatId).toBeNull();
    // Long after the window would have closed, nothing was gagged.
    const later = stepEvents(sim, 600);
    expect(ofType(later, 'GagTriggered')).toEqual([]);
    expect(world.mess.mischiefs).toBe(mischiefs);
    expect(world.baby.state).toBe('carried');
  });

  it('cancels a threat the director telegraphs in the very step of the pick-up (rule 10)', async () => {
    const sim = await outletSim();
    tapBaby(sim);
    const events = stepEvents(sim);
    const kinds = events
      .map((event) => event.type)
      .filter((type) => type === 'ThreatTelegraphed' || type === 'ThreatCancelled');
    expect(kinds).toEqual(['ThreatTelegraphed', 'ThreatCancelled']);
  });
});

describe('while carried (rule 8)', () => {
  it('follows Papa along a walk, every step', async () => {
    const { sim } = await carriedSim();
    const world = worldOf(sim);
    tapFloor(sim, 0, 1.5);
    for (let i = 0; i < 200 && world.papa.state !== 'idle'; i++) {
      stepEvents(sim);
      expect(world.baby).toMatchObject({ xM: world.papa.xM, zM: world.papa.zM });
    }
    expect(world.papa.state).toBe('idle');
    expect(world.baby.state).toBe('carried');
  });

  it('never leaves the arms on his own, over 1 000 steps, whatever the room throws', async () => {
    const { sim } = await carriedSim({
      waves: [testWave([OUTLET], { gapMinMs: 500, gapMaxMs: 1000 })],
    });
    const world = worldOf(sim);
    for (let i = 0; i < 1000; i++) {
      const events = stepEvents(sim);
      expect(ofType(events, 'BabyStateChanged'), `step ${i}`).toEqual([]);
      expect(world.baby.state).toBe('carried');
    }
  });

  it('makes the director draw nothing and spend no random number', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET], { gapMinMs: 100, gapMaxMs: 300 })] });
    placeBaby(sim, 0.5);
    tapBaby(sim);
    stepEvents(sim);
    const world = worldOf(sim);
    // Armed with no cry in the arms due before the end of the check: only the director could draw.
    world.carry.armsCryAt = asSimMs(1_000_000);
    const before = structuredClone(world.rng);
    const events = stepEvents(sim, 300);
    expect(ofType(events, 'ThreatTelegraphed')).toEqual([]);
    expect(drawsBetween(before, world.rng)).toBe(0);
  });

  it('lets the director draw again once he is put down', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET])] });
    placeBaby(sim, 0.5);
    tapBaby(sim);
    stepEvents(sim);
    stepEvents(sim, 20);
    const world = worldOf(sim);
    expect(world.threats[0]?.state).toBe('idle');
    tapBaby(sim);
    const events = stepEvents(sim, 3);
    expect(ofType(events, 'BabyPutDown')).toHaveLength(1);
    expect(ofType(events, 'ThreatTelegraphed')).toHaveLength(1);
  });

  it('makes fatigue grow exactly carriedMultiplier times as fast', async () => {
    const rate = async (isCarried: boolean) => {
      const sim = await newSim({ fatigue: true });
      placeBaby(sim, 0.5);
      if (isCarried) {
        tapBaby(sim);
        stepEvents(sim);
      }
      const world = worldOf(sim);
      const start = world.gauges.fatigue;
      stepEvents(sim, 100);
      return world.gauges.fatigue - start;
    };
    const free = await rate(false);
    const carried = await rate(true);
    expect(carried).toBeCloseTo(free * content.feel.fatigue.carriedMultiplier, 9);
  });

  it('lets a micro-sleep come earlier while carried', async () => {
    const firstMicroSleepAtMs = async (isCarried: boolean) => {
      const sim = await newSim({
        fatigue: true,
        feel: (feel) => ({
          ...feel,
          fatigue: { ...feel.fatigue, startPoints: 60, microSleepMinMs: 0, microSleepMaxMs: 0 },
        }),
      });
      placeBaby(sim, 0.5);
      if (isCarried) tapBaby(sim);
      const world = worldOf(sim);
      const microSleep = world.threats[0];
      const events = runUntil(sim, () => microSleep?.state === 'telegraph', 6000);
      expect(
        ofType(events, 'ThreatTelegraphed').filter((event) => event.kind === 'papa_microsleep'),
      ).toHaveLength(1);
      return world.time.sim;
    };
    expect(await firstMicroSleepAtMs(true)).toBeLessThan(await firstMicroSleepAtMs(false));
  });
});

describe('putDownBaby (rule 9)', () => {
  it('puts the baby down in front of Papa on bare floor: unsafe, babbling again, one draw', async () => {
    const { sim } = await carriedSim();
    const world = worldOf(sim);
    const { putDownOffsetM } = content.feel.carry;
    const papa = { ...world.papa };
    const before = structuredClone(world.rng);
    tapBaby(sim);
    const events = stepEvents(sim);
    const kinds = events
      .map((event) => event.type)
      .filter((type) => type === 'BabyStateChanged' || type === 'BabyPutDown');
    expect(kinds).toEqual(['BabyStateChanged', 'BabyPutDown']);
    expect(ofType(events, 'BabyStateChanged')).toEqual([
      { type: 'BabyStateChanged', t: world.time.sim, from: 'carried', to: 'babble' },
    ]);
    expect(ofType(events, 'BabyPutDown')).toEqual([
      { type: 'BabyPutDown', t: world.time.sim, safe: false },
    ]);
    expect(world.baby.xM).toBeCloseTo(papa.xM + papa.headingX * putDownOffsetM, 9);
    expect(world.baby.zM).toBeCloseTo(papa.zM + papa.headingZ * putDownOffsetM, 9);
    expect(world.baby.babbling).toBe(true);
    expect(world.baby.wanderAt).toBeGreaterThan(world.time.sim);
    expect(world.carry.armsCryAt).toBeNull();
    expect(drawsBetween(before, world.rng)).toBe(1);
  });

  it('puts him down safe when Papa walked into the playpen', async () => {
    const { sim } = await carriedSim();
    const world = worldOf(sim);
    tapFloor(sim, playpenXM, playpenZM);
    stepEvents(sim);
    expect(world.papa.intent).toBe('putDownBaby');
    const events = runUntil(sim, () => world.baby.state !== 'carried');
    expect(ofType(events, 'BabyPutDown')).toEqual([expect.objectContaining({ safe: true })]);
    expect(world.papa).toMatchObject({ state: 'idle', intent: 'none' });
    expect(world.baby.state).toBe('babble');
  });

  it('keeps the baby in his arms for a walk on bare floor, and for any other command', async () => {
    const { sim } = await carriedSim();
    const world = worldOf(sim);
    tapFloor(sim, playpenXM, playpenZM);
    stepEvents(sim);
    expect(world.papa.intent).toBe('putDownBaby');
    // Each of these cancels the intent: the baby is still in his arms.
    tapFloor(sim, 0, 1.5);
    stepEvents(sim);
    expect(world.papa.intent).toBe('none');
    tapFloor(sim, playpenXM, playpenZM);
    stepEvents(sim);
    sim.enqueue({ type: 'Move', t: asSimMs(world.time.sim), dirX: 1, dirZ: 0 });
    stepEvents(sim);
    expect(world.papa).toMatchObject({ state: 'walkDir', intent: 'none' });
    expect(world.baby.state).toBe('carried');
    sim.enqueue({ type: 'MoveStop', t: asSimMs(world.time.sim) });
    stepEvents(sim);
    tapFloor(sim, playpenXM, playpenZM);
    stepEvents(sim);
    sim.enqueue({ type: 'TapObject', t: asSimMs(world.time.sim), objectId: 'nope' });
    stepEvents(sim, 3);
    expect(world.baby.state).toBe('carried');
  });

  it('is unsafe when Papa put him down just outside the playpen', async () => {
    const { sim } = await carriedSim();
    const world = worldOf(sim);
    world.papa.xM = playpenXM + playpen.halfExtentsM[0] + 0.3;
    world.papa.zM = playpenZM;
    world.baby.xM = world.papa.xM;
    world.baby.zM = world.papa.zM;
    tapBaby(sim);
    expect(ofType(stepEvents(sim), 'BabyPutDown')).toEqual([
      expect.objectContaining({ safe: false }),
    ]);
  });

  it('sets him on an open cell even when the point in front of Papa is a wall', async () => {
    const { sim } = await carriedSim();
    const world = worldOf(sim);
    // Next to the west wall, facing it.
    world.papa.xM = -3.45;
    world.papa.zM = 1;
    world.papa.headingX = -1;
    world.papa.headingZ = 0;
    world.baby.xM = world.papa.xM;
    world.baby.zM = world.papa.zM;
    tapBaby(sim);
    stepEvents(sim);
    expect(world.baby.state).toBe('babble');
    expect(babyGrid.isOpenAt(world.baby.xM, world.baby.zM)).toBe(true);
  });

  it('leaves other active threats alone (a forced one stays up)', async () => {
    const { sim } = await carriedSim({ waves: [testWave([OUTLET])] });
    const world = worldOf(sim);
    const outlet = world.threats[0];
    if (outlet === undefined) throw new Error('no outlet');
    sim.enqueue({ type: 'ForceThreat', t: asSimMs(world.time.sim), threatId: outlet.id });
    stepEvents(sim);
    expect(outlet.state).toBe('telegraph');
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'BabyPutDown')).toHaveLength(1);
    expect(ofType(events, 'ThreatCancelled')).toEqual([]);
    expect(outlet.state).toBe('telegraph');
  });
});

describe('the cry in the arms (rule 11)', () => {
  const armsCryAfter = (ms: number) => withCarry({ armsCryMinMs: ms, armsCryMaxMs: ms });

  async function cryingSim(options: Options = {}) {
    const sim = await newSim({ feel: armsCryAfter(2000), ...options });
    placeBaby(sim, 0.5);
    tapBaby(sim);
    stepEvents(sim);
    const world = worldOf(sim);
    const armsCry = world.threats[0];
    if (armsCry === undefined) throw new Error('no cry in the arms');
    return { sim, world, armsCry, takenAt: world.time.sim };
  }

  it('stands on Papa, after the micro-sleep, and is telegraphed when it is due', async () => {
    const { sim, world, armsCry, takenAt } = await cryingSim();
    expect(armsCry.defId).toBe('arms_cry');
    expect(world.carry.armsCryAt).toBe(takenAt + 2000);
    const events = runUntil(sim, () => armsCry.state === 'telegraph');
    const telegraphed = ofType(events, 'ThreatTelegraphed');
    expect(telegraphed).toEqual([
      expect.objectContaining({ t: takenAt + 2000, kind: 'arms_cry', waveIndex: -1 }),
    ]);
    expect(armsCry).toMatchObject({ xM: world.papa.xM, zM: world.papa.zM });
    expect(world.carry.armsCryAt).toBe(takenAt + 4000);
  });

  it('puts the instance after the micro-sleep in a level that has both', async () => {
    const sim = await newSim({ fatigue: true });
    expect(worldOf(sim).threats.map((threat) => threat.defId)).toEqual([
      'papa_microsleep',
      'arms_cry',
    ]);
  });

  it('waits for Papa to stop being busy', async () => {
    const { sim, world, armsCry } = await cryingSim();
    world.papa.state = 'drink';
    world.papa.busyUntil = asSimMs(world.time.sim + 3000);
    const busy = stepEvents(sim, 250);
    expect(ofType(busy, 'ThreatTelegraphed')).toEqual([]);
    expect(armsCry.state).toBe('idle');
    const events = runUntil(sim, () => armsCry.state === 'telegraph', 200);
    expect(ofType(events, 'ThreatTelegraphed')).toHaveLength(1);
  });

  it('is not telegraphed when it could not be judged before the level ends', async () => {
    const { sim, armsCry } = await cryingSim({ durationMs: 3500 });
    const events = stepEvents(sim, 300);
    expect(ofType(events, 'ThreatTelegraphed')).toEqual([]);
    expect(armsCry.state).toBe('idle');
  });

  it('is cancelled when the baby is put down, and armsCryAt is null after', async () => {
    const { sim, world, armsCry } = await cryingSim();
    runUntil(sim, () => armsCry.state === 'telegraph');
    tapBaby(sim);
    const events = stepEvents(sim);
    expect(ofType(events, 'ThreatCancelled')).toEqual([
      expect.objectContaining({ threatId: armsCry.id, reason: 'putDown' }),
    ]);
    expect(armsCry.state).toBe('idle');
    expect(world.carry.armsCryAt).toBeNull();
    // Nothing comes back while he is on the floor.
    expect(ofType(stepEvents(sim, 500), 'ThreatTelegraphed')).toEqual([]);
  });

  it('is judged like any threat: a Parry resolves it, and another cry follows the result', async () => {
    const { sim, world, armsCry } = await cryingSim();
    runUntil(sim, () => armsCry.state === 'windowOpen');
    const window = armsCry.responseWindow;
    if (window === null) throw new Error('no window');
    const t = armsCry.windowOpenAt + window.windowMs / 2;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: armsCry.id });
    sim.enqueue({ type: 'Release', t: asSimMs(t + 50) });
    const events = runUntil(sim, () => armsCry.state === 'resolved');
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'perfect', response: 'parry' }),
    ]);
    expect(world.baby.state).toBe('carried');
    // Papa does not glide to a threat that stands on him.
    expect(ofType(events, 'PapaGlideStarted')).toEqual([]);
    const next = runUntil(sim, () => armsCry.state === 'telegraph');
    expect(ofType(next, 'ThreatTelegraphed')).toHaveLength(1);
  });

  it('wails when missed: the gag, then the baby cries, and he stays in the arms', async () => {
    const { sim, world, armsCry } = await cryingSim();
    const events = runUntil(sim, () => armsCry.state === 'gag');
    expect(ofType(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'arms_wail', reason: 'late' }),
    ]);
    expect(world.baby.cryEndsAt).not.toBeNull();
    expect(world.baby.state).toBe('carried');
  });
});

describe('the Firmness is impossible while carried (rule 12)', () => {
  it('turns a held press on a firm threat into a wrongResponse gag', async () => {
    const path = 'tests/threats/fixtures/test_firm.json';
    const parsed = parseContentFile(path, readFileSync(path, 'utf8'), ThreatDefSchema);
    if (!parsed.ok) throw new Error('test_firm.json is invalid');
    const firm = parsed.value;
    const base = createTestLevel({
      waves: [testWave([{ def: 'outlet', anchor: 'outlet_01' }])],
      carry: CARRY,
    });
    const level = {
      ...base,
      level: {
        ...base.level,
        waves: [testWave([{ def: firm.id, anchor: 'door' }])],
      },
      threats: { ...base.threats, [firm.id]: firm },
    };
    const sim = await createSim({ content, geometry, level, seed: 1 });
    placeBaby(sim, 0.5);
    tapBaby(sim);
    stepEvents(sim);
    const world = worldOf(sim);
    const threat = world.threats.find((candidate) => candidate.defId === firm.id);
    if (threat === undefined) throw new Error('no firm threat');
    sim.enqueue({ type: 'ForceThreat', t: asSimMs(world.time.sim), threatId: threat.id });
    runUntil(sim, () => threat.state === 'windowOpen');
    const pressT = world.time.sim + STEP_MS;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(pressT), threatId: threat.id });
    const events = runUntil(sim, () => threat.state === 'gag', 400);
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'wrongResponse', response: 'firm' }),
    ]);
    expect(ofType(events, 'GagTriggered')).toHaveLength(1);
  });
});

describe('a held press on a Parry threat (rule 12)', () => {
  it('is a wrongResponse whether or not the baby is carried: the Firmness ban changes nothing for a parry def', async () => {
    const sim = await newSim({ waves: [testWave([OUTLET])], feel: withCarry({ reachM: 100 }) });
    placeBaby(sim, 0.5);
    tapBaby(sim);
    stepEvents(sim);
    const world = worldOf(sim);
    expect(world.baby.state).toBe('carried');
    const threat = world.threats[0];
    if (threat === undefined) throw new Error('no outlet');
    sim.enqueue({ type: 'ForceThreat', t: asSimMs(world.time.sim), threatId: threat.id });
    runUntil(sim, () => threat.state === 'windowOpen');
    // Pressed and never released: the ring closes (a Firmness) on a def that asks for a Parry.
    sim.enqueue({ type: 'PressThreat', t: asSimMs(world.time.sim + STEP_MS), threatId: threat.id });
    const events = runUntil(sim, () => threat.state === 'gag', 400);
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'wrongResponse' }),
    ]);
  });
});

describe('time passes', () => {
  it('keeps world.carry empty and the baby free in a level without carry', async () => {
    const sim = await newSim({ carry: false });
    stepN(sim, 10);
    expect(worldOf(sim).carry).toEqual({ armsCryAt: null });
    expect(worldOf(sim).baby.state).not.toBe('carried');
  });
});
