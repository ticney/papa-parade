import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestFakeSleepDuel,
  createTestFakeSleepRound,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
} from '../../../tests/support/testContent.ts';
import { createSim, createSimWithSystems, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { SYSTEMS } from '../step.ts';
import type { ThreatInstance, World } from '../world.ts';

// The fake sleep as the last round of a duel (story 4.7), driving the real sim with the frozen
// `tests/support/testFakeSleepDuel.sequence.json`: the eyes, then the fake sleep, 12 s each, 1 s of
// rest, three retreats to lose. The frozen fake sleep gives its feint 1200 to 2600 ms after its
// telegraph delay (800 ms) and its signal 3500 to 7000 ms after it.
const content = createTestContent();
const geometry = createTestGeometry();
const DUEL = createTestFakeSleepDuel();
const ROUND = createTestFakeSleepRound();

const worldOf = (sim: Sim) => sim.world as World;
const ofType = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);
const typesOf = (events: readonly SimEvent[]) => events.map((event) => event.type);
const threatOf = (sim: Sim, defId: string): ThreatInstance => {
  const found = worldOf(sim).threats.find((threat) => threat.defId === defId);
  if (found === undefined) throw new Error(`the level has no ${defId}`);
  return found;
};

/** A sim and the log of every event it has produced since the sequence started. */
async function started(
  def = DUEL,
  options: { hasNoise?: boolean; seed?: number } = {},
): Promise<{ sim: Sim; log: SimEvent[] }> {
  const { hasNoise = false, seed = 1 } = options;
  const sim = await createSim({
    content,
    geometry,
    level: createTestLevel({
      gauges: hasNoise ? NOISE_GAUGES : {},
      carry: CARRY,
      sequences: [def.id],
      sequenceDefs: { [def.id]: def },
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
  const log: SimEvent[] = [];
  sim.step();
  log.push(...sim.drainEvents());
  return { sim, log };
}

/** Steps until `isDone` (bounded: a hang fails the test), logging what happens. */
function runUntil(sim: Sim, log: SimEvent[], isDone: () => boolean, maxSteps = 3000): void {
  for (let i = 0; i < maxSteps && !isDone(); i++) {
    sim.step();
    log.push(...sim.drainEvents());
  }
  expect(isDone()).toBe(true);
}

function runFor(sim: Sim, log: SimEvent[], ms: number): void {
  const until = worldOf(sim).time.sim + ms;
  runUntil(sim, log, () => worldOf(sim).time.sim >= until);
}

/** Presses the open round dead centre, as the player would, once its window is known. */
function pressCentre(sim: Sim, round: ThreatInstance): void {
  const centre = round.windowOpenAt + (round.responseWindow?.windowMs ?? 0) / 2;
  sim.enqueue({ type: 'PressThreat', t: asSimMs(centre), threatId: round.id });
  sim.enqueue({ type: 'Release', t: asSimMs(centre + 50) });
}

/** Plays the eyes' round to a win. */
function winEyes(sim: Sim, log: SimEvent[]): void {
  const eyes = threatOf(sim, 'bedtime_eyes');
  runUntil(sim, log, () => eyes.state === 'telegraph');
  pressCentre(sim, eyes);
  runUntil(sim, log, () => eyes.state === 'resolved' || eyes.state === 'gag');
  expect(eyes.state).toBe('resolved');
}

describe('the fake sleep as the last round of a duel (story 4.7)', () => {
  it('is won through the feint: the eyes, then the fake sleep answered at its signal, no retreat', async () => {
    const { sim, log } = await started();
    winEyes(sim, log);
    const fake = threatOf(sim, 'fake_sleep');
    runUntil(sim, log, () => fake.state === 'telegraph');
    // The step is the second one: it came after the eyes, with the eyes' round settled.
    expect(worldOf(sim).sequence.stepIndex).toBe(1);
    runUntil(sim, log, () => fake.state === 'windowOpen');
    expect(fake.isFeintGiven).toBe(true);
    pressCentre(sim, fake);
    runUntil(sim, log, () => worldOf(sim).sequence.id === null);
    expect(ofType(log, 'WaitFeintGiven')).toHaveLength(1);
    expect(ofType(log, 'SequenceStepRetreated')).toEqual([]);
    expect(ofType(log, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: DUEL.id, outcome: 'succeeded' }),
    ]);
    expect(ofType(log, 'ResponseResolved').map((event) => event.quality)).toEqual([
      'perfect',
      'perfect',
    ]);
    expect(ofType(log, 'GagTriggered')).toEqual([]);
  });

  it('retreats to the eyes’ step on a press on the feint: early, counted, a cry, the combo lost', async () => {
    const { sim, log } = await started(DUEL, { hasNoise: true });
    winEyes(sim, log);
    const world = worldOf(sim);
    expect(world.combo.multiplier).toBeGreaterThan(content.feel.combo.minMultiplier);
    const fake = threatOf(sim, 'fake_sleep');
    runUntil(sim, log, () => fake.state === 'telegraph');
    const before = log.length;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(fake.feintAt as number), threatId: fake.id });
    runUntil(sim, log, () => fake.state === 'gag');
    runFor(sim, log, 2500);
    const events = log.slice(before);
    expect(ofType(events, 'WaitFeintGiven')).toEqual([]);
    expect(ofType(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'wait', quality: 'fail', reason: 'early' }),
    ]);
    expect(ofType(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_sat_up', reason: 'early' }),
    ]);
    // The retreat: back to the eyes' step, counted once, named by the early press.
    expect(ofType(events, 'SequenceStepRetreated')).toEqual([
      expect.objectContaining({
        id: DUEL.id,
        fromStepIndex: 1,
        stepIndex: 0,
        retreats: 1,
        reason: 'early',
      }),
    ]);
    expect(world.sequence.stepIndex).toBe(0);
    expect(world.sequence.duel.retreats).toBe(1);
    // The cry of the def (`gagCryMs`), the baby in the arms: two `BabyCrying`, and noise with them.
    expect(ofType(events, 'BabyCrying')).toHaveLength(2);
    expect(world.gauges.noisePct).toBeGreaterThan(0);
    // The combo went with the gag.
    expect(ofType(events, 'ComboChanged')).toContainEqual(
      expect.objectContaining({ reason: 'gag', multiplier: content.feel.combo.minMultiplier }),
    );
    expect(world.combo.multiplier).toBe(content.feel.combo.minMultiplier);
  });

  it('plays the eyes’ round after the retreat on its own instance, with no feint of its own', async () => {
    const { sim, log } = await started();
    winEyes(sim, log);
    const fake = threatOf(sim, 'fake_sleep');
    const eyes = threatOf(sim, 'bedtime_eyes');
    expect(eyes.id).not.toBe(fake.id);
    runUntil(sim, log, () => fake.state === 'telegraph');
    sim.enqueue({ type: 'PressThreat', t: asSimMs(fake.feintAt as number), threatId: fake.id });
    runUntil(sim, log, () => fake.state === 'gag');
    const mark = log.length;
    runUntil(sim, log, () => eyes.state === 'telegraph');
    expect(eyes).toMatchObject({ feintAt: null, isFeintGiven: false });
    runUntil(sim, log, () => eyes.state === 'windowOpen');
    expect(typesOf(log.slice(mark))).not.toContain('WaitFeintGiven');
    // The fake sleep's own instance has been rearmed and holds no feint while the eyes play.
    expect(fake).toMatchObject({ state: 'idle', feintAt: null, isFeintGiven: false });
  });
});

describe('the instances of a duel with the fake sleep (story 4.7)', () => {
  /** The level the sim plans (`ctx.level`), seen by a system that runs once. */
  async function plannedOf(gauges: NonNullable<Parameters<typeof createTestLevel>[0]>['gauges']) {
    let ctxLevel: unknown = null;
    const sim = await createSimWithSystems(
      {
        content,
        geometry,
        level: createTestLevel({
          gauges,
          carry: CARRY,
          sequences: [DUEL.id],
          sequenceDefs: { [DUEL.id]: DUEL },
        }),
        seed: 1,
      },
      [
        ...SYSTEMS,
        (_world, ctx) => {
          ctxLevel = ctx.level;
        },
      ],
    );
    sim.step();
    const defIds = sim.world.threats.map((threat) => threat.defId);
    sim.dispose();
    if (ctxLevel === null) throw new Error('the spy never ran');
    return {
      defIds,
      level: ctxLevel as {
        microSleepIndex: number;
        armsCryIndex: number;
        sequences: { duelThreatIndexes: (number | null)[] }[];
      },
    };
  }

  it('makes one instance per def, the duel’s after the cry in the arms, with the right indices', async () => {
    const { defIds, level } = await plannedOf({});
    expect(defIds).toEqual(['arms_cry', 'bedtime_eyes', 'fake_sleep']);
    expect(level.microSleepIndex).toBe(-1);
    expect(level.armsCryIndex).toBe(0);
    expect(level.sequences[0]?.duelThreatIndexes).toEqual([1, 2]);
  });

  it('leaves the micro-sleep and the cry in the arms where they were', async () => {
    const { defIds, level } = await plannedOf(FATIGUE_GAUGES);
    expect(defIds).toEqual(['papa_microsleep', 'arms_cry', 'bedtime_eyes', 'fake_sleep']);
    expect(level.microSleepIndex).toBe(0);
    expect(level.armsCryIndex).toBe(1);
    expect(level.sequences[0]?.duelThreatIndexes).toEqual([2, 3]);
  });
});

describe('a round of the fake sleep that is cancelled or restarted (story 4.7)', () => {
  it('has a fresh feint at each telegraph, never given at the start of it', async () => {
    const { sim, log } = await started(ROUND);
    const fake = threatOf(sim, 'fake_sleep');
    const feintsDrawn: number[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      runUntil(sim, log, () => fake.state === 'telegraph');
      expect(fake.isFeintGiven).toBe(false);
      expect(fake.feintAt).not.toBeNull();
      // Relative to its own telegraph: an absolute instant would grow with the clock alone.
      feintsDrawn.push((fake.feintAt as number) - fake.enteredAt);
      // A press on the feint: the round is lost, the step is played again (the only step).
      runUntil(sim, log, () => fake.isFeintGiven);
      sim.enqueue({ type: 'PressThreat', t: asSimMs(worldOf(sim).time.sim), threatId: fake.id });
      runUntil(sim, log, () => fake.state === 'gag');
      runUntil(sim, log, () => fake.state === 'idle');
      expect(fake).toMatchObject({ feintAt: null, isFeintGiven: false });
    }
    expect(ofType(log, 'WaitFeintGiven')).toHaveLength(2);
    // Two draws, two telegraphs: the second feint is a new one, relative to its own telegraph.
    expect(feintsDrawn[1]).not.toBe(feintsDrawn[0]);
  });

  it('is closed by a level end mid-round: the sequence ends, the feint is cleared, none comes after', async () => {
    const { sim, log } = await started(ROUND, { hasNoise: true });
    const fake = threatOf(sim, 'fake_sleep');
    runUntil(sim, log, () => fake.state === 'telegraph');
    expect(fake.feintAt).not.toBeNull();
    const mark = log.length;
    // Mama wakes before the feint: the level ends, the sequence with it.
    sim.enqueue({ type: 'SetNoise', t: asSimMs(worldOf(sim).time.sim), pct: 100 });
    runFor(sim, log, 200);
    const events = log.slice(mark);
    expect(ofType(events, 'SequenceEnded')).toEqual([
      expect.objectContaining({ id: ROUND.id, outcome: 'levelEnded' }),
    ]);
    expect(typesOf(events)).not.toContain('WaitFeintGiven');
    // The level is over: the round is closed (the sim steps no more threats), so the feint drawn for it
    // never comes, even once its instant has passed.
    expect(worldOf(sim).flow.state).toBe('ended');
    const drawnAt = fake.feintAt as number;
    runUntil(sim, log, () => worldOf(sim).time.sim > drawnAt + 3000);
    expect(typesOf(log.slice(mark))).not.toContain('WaitFeintGiven');
    expect(fake.isFeintGiven).toBe(false);
    expect(worldOf(sim).sequence.duel).toEqual({
      isRunning: false,
      nextRoundAt: null,
      retreats: 0,
    });
  });
});
