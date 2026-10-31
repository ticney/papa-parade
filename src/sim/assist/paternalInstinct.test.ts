import type { LevelContent } from '@content/contentBundle';
import type { LevelWaveThreat } from '@content/schemas/level';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestMicroSleep,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  SILENCE,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import { startSlowMo, updateTimeScale } from '../time/slowMo.ts';
import {
  INSTINCT_STATES,
  INSTINCT_STATES_ARE_COMPLETE,
  SLOW_MO_SOURCES,
  SLOW_MO_SOURCES_ARE_COMPLETE,
  type World,
} from '../world.ts';
import { instinctWindowModifier } from './paternalInstinct.ts';

// Story 2.9: Fatherly Instinct. The trigger tests play real gags (a threat nobody answers), so
// they cover `recordMiss` at its source; the others start the instinct with the debug command.
// Literals on purpose: the expectations must not be computed with the production formula.

const content = createTestContent();
const geometry = createTestGeometry();

/** Five outlets on five anchors, drawn by nobody (the wave is far away): the tests start them with `ForceThreat`. */
const FIVE: readonly LevelWaveThreat[] = [
  OUTLET,
  { def: 'outlet', anchor: 'door' },
  { def: 'outlet', anchor: 'coffee_machine' },
  { def: 'outlet', anchor: 'phone' },
  { def: 'outlet', anchor: 'toilet' },
];
const FAR_AWAY_WAVE = testWave(FIVE, { fromMs: 500_000, maxSimultaneous: 5 });

/** An unanswered outlet: 1200 ms of delay, a 300 ms window and 60 ms of tolerance, judged at the next step. */
const GAG_AFTER_MS = 1570;

interface Rig {
  sim: Sim;
  /** Every event so far, in order. */
  log: SimEvent[];
  /** `world.time.scale` after each step, as `[t, scale]`. */
  scales: [number, number][];
  runTo(untilMs: number): void;
  force(t: number, threatId: number): void;
  forceInstinct(t: number): void;
  setTier(t: number, tier: 'assistance' | 'normal' | 'experienced'): void;
}

async function newRig(level: LevelContent = createTestLevel({ waves: [FAR_AWAY_WAVE] }), seed = 1) {
  const sim = await createSim({ content, geometry, level, seed });
  return rigOf(sim);
}

function rigOf(sim: Sim): Rig {
  const log: SimEvent[] = [];
  const scales: [number, number][] = [];
  return {
    sim,
    log,
    scales,
    runTo(untilMs) {
      while (sim.world.time.sim < untilMs) {
        sim.step();
        log.push(...sim.drainEvents());
        scales.push([sim.world.time.sim, sim.world.time.scale]);
      }
    },
    force: (t, threatId) => sim.enqueue({ type: 'ForceThreat', t: asSimMs(t), threatId }),
    forceInstinct: (t) => sim.enqueue({ type: 'ForceInstinct', t: asSimMs(t) }),
    setTier: (t, tier) => sim.enqueue({ type: 'SetDifficultyTier', t: asSimMs(t), tier }),
  };
}

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

describe('the frozen feel these tests read (story 2.9)', () => {
  it('holds the numbers the literals below are written against', () => {
    expect(content.feel.instinct).toEqual({
      timeScale: 0.8,
      windowBonusPct: 30,
      durationMs: 4000,
      returnMs: 300,
      cooldownMs: 30000,
      minActiveThreatsCount: 3,
      missesCount: 2,
      missesWithinMs: 10000,
    });
    expect(content.feel.timing).toMatchObject({ windowMs: 300, toleranceMs: 60 });
  });

  it('lists every state and every slow-mo source', () => {
    expect(INSTINCT_STATES).toEqual(['ready', 'active', 'cooldown']);
    expect(INSTINCT_STATES_ARE_COMPLETE).toBe(true);
    expect(SLOW_MO_SOURCES).toContain('instinct');
    expect(SLOW_MO_SOURCES_ARE_COMPLETE).toBe(true);
  });

  it('starts ready, with no miss', async () => {
    const { sim } = await newRig();
    expect(sim.world.instinct).toEqual({
      state: 'ready',
      enteredAt: 0,
      untilAt: 0,
      missAts: [],
    });
  });
});

describe('what counts as a miss', () => {
  it('records every gag, at the step it is emitted', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.runTo(100 + GAG_AFTER_MS + 50);
    const gags = only(rig.log, 'GagTriggered');
    expect(gags).toHaveLength(1);
    expect(rig.sim.world.instinct.missAts).toEqual([gags[0]?.t]);
    expect(gags[0]?.t).toBe(100 + GAG_AFTER_MS);
  });

  it('keeps no more than missesCount of them, the latest', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.force(200, 2);
    rig.force(300, 3);
    rig.runTo(300 + GAG_AFTER_MS + 50);
    expect(rig.sim.world.instinct.missAts).toEqual([100 + GAG_AFTER_MS + 100, 300 + GAG_AFTER_MS]);
  });

  it('counts a silence nobody found (the surprise gag)', async () => {
    const level = createTestLevel({ waves: [testWave([SILENCE], { fromMs: 500_000 })] });
    const rig = await newRig(level);
    rig.force(100, 1);
    rig.runTo(12_000);
    expect(only(rig.log, 'SilenceEnded').map((event) => event.reason)).toEqual(['timedOut']);
    expect(rig.sim.world.instinct.missAts).toHaveLength(1);
  });

  it('counts a micro-sleep nobody woke', async () => {
    const level = createTestLevel({ gauges: FATIGUE_GAUGES, waves: [FAR_AWAY_WAVE] });
    const rig = await newRig(level);
    rig.sim.enqueue({ type: 'SetFatigue', t: asSimMs(100), points: 90 });
    rig.runTo(30_000);
    const gags = only(rig.log, 'GagTriggered').filter((event) => event.gag === 'papa_asleep');
    expect(gags.length).toBeGreaterThan(0);
    expect(rig.sim.world.instinct.missAts.length).toBeGreaterThan(0);
  });

  it('does not count a cancelled threat (ThreatCancelled has no result)', async () => {
    // As the `baby_carry` golden: the outlet is telegraphed while Papa waits next to the baby, who
    // is then taken in the arms; the outlet is cancelled with no gag.
    const level = createTestLevel({
      waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
      carry: CARRY,
    });
    const rig = await newRig(level, 11);
    rig.sim.enqueue({ type: 'TapFloor', t: asSimMs(0), xM: -0.2, zM: 1.2 });
    rig.sim.enqueue({ type: 'TapBaby', t: asSimMs(2320) });
    rig.runTo(2600);
    expect(only(rig.log, 'ThreatCancelled')).toHaveLength(1);
    expect(only(rig.log, 'GagTriggered')).toHaveLength(0);
    expect(rig.sim.world.instinct.missAts).toEqual([]);
  });
});

describe('the trigger', () => {
  /**
   * Threats 1 and 2 are missed `gapMs` apart; threats 3, 4 and 5 are telegraphed 800 ms into the
   * second one's life, so they are the three active threats when it gags.
   */
  async function twoMissesGapMs(gapMs: number, tier?: 'assistance' | 'normal' | 'experienced') {
    const rig = await newRig();
    if (tier !== undefined) rig.setTier(0, tier);
    const secondAt = 100 + gapMs;
    rig.force(100, 1);
    rig.force(secondAt, 2);
    rig.force(secondAt + 800, 3);
    rig.force(secondAt + 810, 4);
    rig.force(secondAt + 820, 5);
    rig.runTo(secondAt + 2100);
    return { rig, secondGagAt: secondAt + GAG_AFTER_MS };
  }

  it('fires when 2 misses fall within 10 s with 3 threats active, at the step of the second miss', async () => {
    const { rig, secondGagAt } = await twoMissesGapMs(1000);
    const triggered = only(rig.log, 'InstinctTriggered');
    expect(triggered).toEqual([
      { type: 'InstinctTriggered', t: secondGagAt, untilAt: secondGagAt + 4000 },
    ]);
    expect(rig.sim.world.instinct).toMatchObject({
      state: 'active',
      enteredAt: secondGagAt,
      untilAt: secondGagAt + 4000,
      missAts: [],
    });
  });

  it('puts InstinctTriggered before TimeScaleChanged{to: 0.8}, in the same step', async () => {
    const { rig, secondGagAt } = await twoMissesGapMs(1000);
    const step = rig.log.filter((event) => event.t === secondGagAt).map((event) => event.type);
    expect(step.indexOf('ResponseResolved')).toBeLessThan(step.indexOf('InstinctTriggered'));
    expect(step.indexOf('InstinctTriggered')).toBeLessThan(step.indexOf('TimeScaleChanged'));
    expect(only(rig.log, 'TimeScaleChanged')).toEqual([
      { type: 'TimeScaleChanged', t: secondGagAt, from: 1, to: 0.8 },
    ]);
  });

  it('counts the gap strictly: 9990 ms triggers, 10 000 ms does not', async () => {
    const near = await twoMissesGapMs(9990);
    expect(only(near.rig.log, 'InstinctTriggered')).toHaveLength(1);
    const far = await twoMissesGapMs(10_000);
    expect(only(far.rig.log, 'GagTriggered').length).toBeGreaterThanOrEqual(2);
    expect(only(far.rig.log, 'InstinctTriggered')).toHaveLength(0);
    expect(far.rig.sim.world.instinct.state).toBe('ready');
  });

  it('needs 3 active threats: 2 are not enough', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.force(200, 2);
    // Only two threats are up when the second one is missed.
    rig.force(1000, 3);
    rig.force(1010, 4);
    rig.runTo(6000);
    expect(only(rig.log, 'GagTriggered').length).toBeGreaterThanOrEqual(4);
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(0);
  });

  it('needs 2 misses: one is not enough', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.force(800, 3);
    rig.force(810, 4);
    rig.force(820, 5);
    // Threat 1 is missed at 1660 with 3 others up; the others are missed later with fewer up.
    rig.runTo(1700);
    expect(only(rig.log, 'GagTriggered')).toHaveLength(1);
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(0);
  });

  it('reads the condition at every step: a third threat 5 s after the misses triggers at that step', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.force(200, 2);
    rig.force(5000, 3);
    rig.force(5010, 4);
    rig.force(5020, 5);
    rig.runTo(1900);
    expect(rig.sim.world.instinct.missAts).toHaveLength(2);
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(0);
    rig.runTo(5100);
    expect(only(rig.log, 'InstinctTriggered').map((event) => event.t)).toEqual([5020]);
  });

  it('counts a hidden silence and a threat on Papa as active', async () => {
    // Three active threats: two outlets and the silence, which the baby has taken (hidden).
    const level = createTestLevel({
      waves: [testWave([OUTLET, { def: 'outlet', anchor: 'door' }, SILENCE], { fromMs: 500_000 })],
    });
    const rig = await newRig(level);
    rig.force(100, 1);
    rig.force(200, 2);
    // Two misses first (threats 1 and 2), then nothing happens until the baby takes the silence.
    rig.runTo(1900);
    expect(rig.sim.world.instinct.missAts).toHaveLength(2);
    rig.runTo(8000);
    // The baby takes the silence (it must be free to, hence first), then both outlets are up.
    rig.force(8010, 3);
    rig.force(8020, 1);
    rig.force(8030, 2);
    rig.runTo(8100);
    const hidden = rig.sim.world.threats.filter((threat) => threat.state === 'hidden');
    expect(hidden).toHaveLength(1);
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(1);
  });

  it('does not count a threat in gag or resolved', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.force(200, 2);
    // Both are in `gag` (or cooldown) from 1660 on; two more up is only two active.
    rig.force(1700, 3);
    rig.force(1710, 4);
    rig.runTo(1800);
    expect(rig.sim.world.instinct.missAts).toHaveLength(2);
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(0);
  });

  it('does not fire at the experienced tier, which has no instinct, but still records the misses', async () => {
    const { rig } = await twoMissesGapMs(1000, 'experienced');
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(0);
    expect(rig.sim.world.instinct.state).toBe('ready');
    expect(rig.sim.world.instinct.missAts.length).toBeGreaterThanOrEqual(2);
  });

  it('fires at assistance too', async () => {
    const { rig } = await twoMissesGapMs(1000, 'assistance');
    // Windows are 450 ms at this tier, so the gag comes later: only count it.
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(1);
  });

  it('draws nothing from world.rng', async () => {
    const withInstinct = await newRig();
    const without = await newRig();
    withInstinct.forceInstinct(100);
    withInstinct.runTo(6000);
    without.runTo(6000);
    expect(withInstinct.sim.world.rng).toEqual(without.sim.world.rng);
  });
});

describe('the length of the instinct', () => {
  it('holds exactly 0.8 for 4000 sim ms, returns over returnMs, then 1', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.runTo(5000);
    const untilAt = 100 + 4000;
    for (const [t, scale] of rig.scales) {
      if (t < 100) expect(scale).toBe(1);
      else if (t <= untilAt) expect(scale).toBe(0.8);
    }
    const back = rig.scales.filter(([t]) => t > untilAt && t < untilAt + 300);
    expect(back.length).toBe(29);
    // Rising strictly, between 0.8 and 1.
    for (let i = 0; i < back.length; i++) {
      const scale = (back[i] as [number, number])[1];
      expect(scale).toBeGreaterThan(0.8);
      expect(scale).toBeLessThan(1);
      if (i > 0) expect(scale).toBeGreaterThan((back[i - 1] as [number, number])[1]);
    }
    for (const [t, scale] of rig.scales) if (t >= untilAt + 300) expect(scale).toBe(1);
  });

  it('ends at exactly trigger + 4000 with InstinctEnded{timer}, and recharges from there', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.runTo(4090);
    expect(rig.sim.world.instinct.state).toBe('active');
    expect(only(rig.log, 'InstinctEnded')).toHaveLength(0);
    rig.runTo(4100);
    expect(only(rig.log, 'InstinctEnded')).toEqual([
      { type: 'InstinctEnded', t: 4100, reason: 'timer' },
    ]);
    expect(rig.sim.world.instinct).toMatchObject({
      state: 'cooldown',
      enteredAt: 4100,
      untilAt: 34_100,
    });
  });

  it('is ready again after the recharge, with no event', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.runTo(34_090);
    expect(rig.sim.world.instinct.state).toBe('cooldown');
    const before = rig.log.length;
    rig.runTo(34_100);
    expect(rig.sim.world.instinct).toMatchObject({ state: 'ready', untilAt: 0 });
    expect(rig.log.slice(before)).toEqual([]);
  });
});

describe('the recharge', () => {
  /** The first instinct is forced; two misses and three threats up are then arranged to be met at `thirdAt`. */
  async function rechargeCase(thirdAt: number) {
    const rig = await newRig();
    rig.forceInstinct(100);
    // Misses well before (they are recorded during the cooldown, and a trigger emptied the list).
    rig.force(30_000, 1);
    rig.force(30_100, 2);
    rig.force(thirdAt - 20, 3);
    rig.force(thirdAt - 10, 4);
    rig.force(thirdAt, 5);
    rig.runTo(thirdAt + 200);
    return rig;
  }

  it('empties the misses at a trigger', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.force(200, 2);
    rig.force(900, 3);
    rig.force(910, 4);
    rig.force(920, 5);
    rig.runTo(1800);
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(1);
    expect(rig.sim.world.instinct.missAts).toEqual([]);
  });

  it('does not trigger at end + 29 990, triggers at end + 30 000', async () => {
    const end = 4100;
    const rig = await rechargeCase(end + 29_990);
    expect(only(rig.log, 'InstinctTriggered').map((event) => event.t)).toEqual([100, end + 30_000]);
    expect(rig.sim.world.instinct.state).toBe('active');
  });

  it('drops the misses made during the instinct: with no cooldown, the next one does not start from them', async () => {
    const rig = await newRig();
    rig.sim.enqueue({ type: 'SetFeel', t: asSimMs(50), patch: { instinct: { cooldownMs: 0 } } });
    rig.forceInstinct(100);
    // Two misses inside the instinct (they gag at about 1800), then three threats up when it ends.
    rig.force(200, 1);
    rig.force(300, 2);
    rig.force(3500, 3);
    rig.force(3510, 4);
    rig.force(3520, 5);
    rig.runTo(4090);
    expect(rig.sim.world.instinct.missAts).toHaveLength(2);
    rig.runTo(4300);
    expect(only(rig.log, 'InstinctEnded').map((event) => event.t)).toEqual([4100]);
    expect(only(rig.log, 'InstinctTriggered').map((event) => event.t)).toEqual([100]);
    expect(rig.sim.world.instinct).toMatchObject({ state: 'ready', missAts: [] });
  });

  it('keeps recording misses during the cooldown', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.force(10_000, 1);
    rig.runTo(10_000 + GAG_AFTER_MS + 10);
    expect(rig.sim.world.instinct.state).toBe('cooldown');
    expect(rig.sim.world.instinct.missAts).toHaveLength(1);
  });
});

describe('the windows', () => {
  // A pure setup like `tierWindows.test.ts`: the world is edited, then a threat is telegraphed.
  async function setup(tier: 'assistance' | 'normal' | 'experienced', fatigued = false) {
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({ waves: [testWave([OUTLET])] }),
      seed: 1,
    });
    const world = sim.world as World;
    world.time.sim = asSimMs(500);
    // Where an instinct entered by hand would end: well after the telegraphs these cases make.
    world.instinct.untilAt = asSimMs(5000);
    world.difficultyTier = tier;
    if (fatigued) world.gauges.fatigue = content.feel.fatigue.thresholdPoints + 1;
    const ctx = {
      feel: content.feel,
      events: [],
      strictInvariants: true,
      t: world.time.sim,
      level: { microSleepIndex: fatigued ? 0 : -1, durationMs: 100_000 },
      requestFreezeRealMs: () => undefined,
    } as unknown as StepContext;
    const def = createTestLevel({ waves: [testWave([OUTLET])] }).threats.outlet;
    if (def === undefined) throw new Error('no outlet');
    const threat = world.threats[0] as World['threats'][number];
    return { world, ctx, def, threat };
  }

  it.each([
    ['normal', 390],
    ['assistance', 585],
  ] as const)('a base of 300 gives %s a window of %i while active', async (tier, windowMs) => {
    const { world, ctx, def, threat } = await setup(tier);
    world.instinct.state = 'active';
    telegraphThreat(world, ctx, threat, def, 0);
    expect(threat.responseWindow?.windowMs).toBeCloseTo(windowMs, 9);
  });

  it.each([
    [4990, 390],
    [5000, 300],
  ] as const)(
    'a telegraph at %i (untilAt 5000) has a window of %i: the end instant is outside',
    async (nowMs, windowMs) => {
      const { world, ctx, def, threat } = await setup('normal');
      world.instinct.state = 'active';
      world.time.sim = asSimMs(nowMs);
      telegraphThreat(world, ctx, threat, def, 0);
      expect(threat.responseWindow?.windowMs).toBeCloseTo(windowMs, 9);
    },
  );

  it('gives 312 at normal with a fatigue penalty of 20 %', async () => {
    const { world, ctx, def, threat } = await setup('normal', true);
    world.instinct.state = 'active';
    telegraphThreat(world, ctx, threat, def, 0);
    expect(threat.responseWindow?.windowMs).toBeCloseTo(312, 9);
  });

  it('gives experienced 225: no instinct, no bonus', async () => {
    const rig = await newRig();
    rig.setTier(0, 'experienced');
    rig.forceInstinct(100);
    rig.force(200, 1);
    rig.runTo(300);
    expect(rig.sim.world.instinct.state).toBe('ready');
    expect(rig.sim.world.threats[0]?.responseWindow?.windowMs).toBeCloseTo(225, 9);
  });

  it('is neutral outside `active`', async () => {
    const { world, ctx } = await setup('normal');
    expect(instinctWindowModifier(world, ctx)).toBe(1);
    world.instinct.state = 'cooldown';
    expect(instinctWindowModifier(world, ctx)).toBe(1);
    world.instinct.state = 'active';
    expect(instinctWindowModifier(world, ctx)).toBeCloseTo(1.3, 12);
  });

  it('leaves the perfect zone, the tolerance and the buffer unscaled', async () => {
    const { world, ctx, def, threat } = await setup('normal');
    world.instinct.state = 'active';
    telegraphThreat(world, ctx, threat, def, 0);
    expect(threat.responseWindow).toMatchObject({ perfectMs: 100, toleranceMs: 60, bufferMs: 100 });
  });

  it('freezes a window at the telegraph: one already up keeps its length, one telegraphed during the instinct keeps +30 % after it', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.forceInstinct(200);
    rig.force(3500, 2);
    rig.runTo(300);
    // Telegraphed before the instinct: it keeps 300.
    expect(rig.sim.world.threats[0]?.responseWindow?.windowMs).toBe(300);
    rig.runTo(3600);
    // Telegraphed during it: 390.
    expect(rig.sim.world.threats[1]?.responseWindow?.windowMs).toBeCloseTo(390, 9);
    // The instinct ends at 4200; the second window is still there, still 390, and open at 4700.
    rig.runTo(4300);
    expect(rig.sim.world.instinct.state).toBe('cooldown');
    expect(rig.sim.world.threats[1]?.state).toBe('telegraph');
    expect(rig.sim.world.threats[1]?.responseWindow?.windowMs).toBeCloseTo(390, 9);
    // And a threat telegraphed after the end has the plain window.
    rig.force(4400, 3);
    rig.runTo(4500);
    expect(rig.sim.world.threats[2]?.responseWindow?.windowMs).toBe(300);
  });

  it('has the next telegraph read a new windowBonusPct (SetFeel during the instinct)', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.sim.enqueue({
      type: 'SetFeel',
      t: asSimMs(200),
      patch: { instinct: { windowBonusPct: 100 } },
    });
    rig.force(1000, 1);
    rig.runTo(1100);
    expect(rig.sim.world.threats[0]?.responseWindow?.windowMs).toBeCloseTo(600, 9);
  });

  describe('isJudgeableBeforeEnd', () => {
    it('multiplies the window by the instinct too: the boundary', async () => {
      const microSleep = createTestMicroSleep();
      const { world, ctx } = await setup('normal');
      const { toleranceMs, windowMs, telegraphDelayDefaultMs } = content.feel.timing;
      const delayMs = microSleep.telegraphDelayMs ?? telegraphDelayDefaultMs;
      const now = 1000;
      // The level ends just after a normal window would be judged, and before an instinct one.
      (ctx.level as { durationMs: number }).durationMs = now + delayMs + windowMs + toleranceMs;
      expect(isJudgeableBeforeEnd(world, ctx, microSleep, now)).toBe(true);
      world.instinct.state = 'active';
      expect(isJudgeableBeforeEnd(world, ctx, microSleep, now)).toBe(false);
      // The bonus is 90 ms (30 % of 300): that much more room and it passes again, one ms less and it does not.
      (ctx.level as { durationMs: number }).durationMs += 90;
      expect(isJudgeableBeforeEnd(world, ctx, microSleep, now)).toBe(true);
      (ctx.level as { durationMs: number }).durationMs -= 1;
      expect(isJudgeableBeforeEnd(world, ctx, microSleep, now)).toBe(false);
    });

    it('adds nothing from untilAt on, like the telegraph it announces', async () => {
      const microSleep = createTestMicroSleep();
      const { world, ctx } = await setup('normal');
      const { toleranceMs, windowMs, telegraphDelayDefaultMs } = content.feel.timing;
      const delayMs = microSleep.telegraphDelayMs ?? telegraphDelayDefaultMs;
      (ctx.level as { durationMs: number }).durationMs = 1000 + delayMs + windowMs + toleranceMs;
      world.instinct.state = 'active';
      world.time.sim = asSimMs(4990);
      expect(isJudgeableBeforeEnd(world, ctx, microSleep, 1000)).toBe(false);
      world.time.sim = world.instinct.untilAt;
      expect(isJudgeableBeforeEnd(world, ctx, microSleep, 1000)).toBe(true);
    });
  });
});

describe('overlapping slow-mos (rule D5 of story 1.14)', () => {
  const { timing, combo } = content.feel;

  /** A bare world and a fake context, as `slowMo.test.ts`. */
  async function bare() {
    const sim = await createSim({ content, geometry, level: createTestLevel(), seed: 1 });
    const world = sim.world as World;
    const events: SimEvent[] = [];
    const ctx = {
      feel: content.feel,
      strictInvariants: true,
      get t() {
        return world.time.sim;
      },
      events,
    } as unknown as StepContext;
    const run = (untilMs: number) => {
      const out: [number, number][] = [];
      while (world.time.sim < untilMs) {
        world.time.sim = asSimMs(world.time.sim + STEP_MS);
        updateTimeScale(world, ctx);
        out.push([world.time.sim, world.time.scale]);
      }
      return out;
    };
    return { world, ctx, run };
  }

  it.each([
    ['perfect', timing.slowMoPerfect, 0.3, 1200],
    ['lastThreat', timing.slowMoLastThreat, 0.2, 1500],
    ['comboCashIn', combo.slowMoCashIn, 0.25, 1000],
  ] as const)(
    '%s then instinct: the slower wins, then back to 0.8, then 1',
    async (source, feel, scale, holdMs) => {
      const { world, ctx, run } = await bare();
      startSlowMo(world, ctx, source, feel);
      run(500);
      startSlowMo(world, ctx, 'instinct', content.feel.instinct);
      const out = run(6000);
      // The faster source still rules while it holds...
      expect(out.filter(([t]) => t > 500 && t <= holdMs).every(([, s]) => s === scale)).toBe(true);
      // ...then the scale rises to 0.8 and stays there while the instinct holds (until 500 + 4000).
      const during = out.filter(([t]) => t >= holdMs + 300 && t <= 4500);
      expect(during.length).toBeGreaterThan(0);
      expect(during.every(([, s]) => s === 0.8)).toBe(true);
      expect(out.find(([t]) => t === 4500)?.[1]).toBe(0.8);
      // Then 1 after the instinct's return.
      expect(out.filter(([t]) => t >= 4800).every(([, s]) => s === 1)).toBe(true);
      expect(world.time.slowMos).toEqual([]);
    },
  );

  it.each([
    ['perfect', timing.slowMoPerfect, 0.3, 1200],
    ['lastThreat', timing.slowMoLastThreat, 0.2, 1500],
    ['comboCashIn', combo.slowMoCashIn, 0.25, 1000],
  ] as const)('instinct then %s: each keeps its own timer', async (source, feel, scale, holdMs) => {
    const { world, ctx, run } = await bare();
    startSlowMo(world, ctx, 'instinct', content.feel.instinct);
    run(1000);
    startSlowMo(world, ctx, source, feel);
    const startedAt = world.time.sim;
    const out = run(6000);
    expect(world.time.slowMos).toEqual([]);
    expect(out.filter(([t]) => t < startedAt + holdMs).every(([, s]) => s === scale)).toBe(true);
    const after = out.filter(([t]) => t >= startedAt + holdMs + 300 && t <= 4000);
    expect(after.every(([, s]) => s === 0.8)).toBe(true);
    expect(out.filter(([t]) => t >= 4300).every(([, s]) => s === 1)).toBe(true);
  });

  it('in the sim: instinct then a perfect Parry, and InstinctEnded does not move with the perfect', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.force(300, 1);
    rig.runTo(400);
    const threat = rig.sim.world.threats[0];
    if (threat === undefined || threat.responseWindow === null) throw new Error('not telegraphed');
    const center = threat.windowOpenAt + threat.responseWindow.windowMs / 2;
    rig.sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: 1 });
    rig.sim.enqueue({ type: 'Release', t: asSimMs(center + 50) });
    rig.runTo(6000);
    const resolved = only(rig.log, 'ResponseResolved')[0];
    expect(resolved?.quality).toBe('perfect');
    const at = resolved?.t ?? 0;
    expect(rig.scales.find(([t]) => t === at)?.[1]).toBe(0.3);
    // Back to 0.8 and not to 1 while the instinct holds.
    expect(rig.scales.find(([t]) => t === 3500)?.[1]).toBe(0.8);
    expect(rig.scales.find(([t]) => t === 6000)?.[1]).toBe(1);
    expect(only(rig.log, 'InstinctEnded').map((event) => event.t)).toEqual([4100]);
  });

  it('in the sim: a perfect Parry then the instinct', async () => {
    const rig = await newRig();
    rig.force(100, 1);
    rig.runTo(200);
    const threat = rig.sim.world.threats[0];
    if (threat === undefined || threat.responseWindow === null) throw new Error('not telegraphed');
    const center = threat.windowOpenAt + threat.responseWindow.windowMs / 2;
    rig.sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: 1 });
    rig.sim.enqueue({ type: 'Release', t: asSimMs(center + 50) });
    rig.forceInstinct(center + 100);
    rig.runTo(center + 100 + 6000);
    const resolved = only(rig.log, 'ResponseResolved')[0];
    expect(resolved?.quality).toBe('perfect');
    expect(rig.scales.find(([t]) => t === center + 100)?.[1]).toBe(0.3);
    expect(rig.scales.find(([t]) => t === center + 3000)?.[1]).toBe(0.8);
    expect(only(rig.log, 'InstinctEnded').map((event) => event.t)).toEqual([center + 100 + 4000]);
    expect(rig.sim.world.time.scale).toBe(1);
  });
});

describe('the end of the level during the instinct', () => {
  it('closes it with InstinctEnded{levelEnded} before LevelEnded (timer)', async () => {
    const rig = await newRig(createTestLevel({ durationMs: 3000, waves: [FAR_AWAY_WAVE] }));
    rig.forceInstinct(1000);
    rig.runTo(3100);
    const types = rig.log.filter((event) => event.t === 3000).map((event) => event.type);
    expect(types).toContain('InstinctEnded');
    expect(types.indexOf('InstinctEnded')).toBeLessThan(types.indexOf('LevelEnded'));
    expect(only(rig.log, 'InstinctEnded')).toEqual([
      { type: 'InstinctEnded', t: 3000, reason: 'levelEnded' },
    ]);
    expect(rig.sim.world.instinct.state).toBe('cooldown');
    // The slow-mo winds down by itself.
    rig.runTo(10_000);
    expect(rig.sim.world.time.scale).toBe(1);
  });

  it('closes it when Mama wakes too', async () => {
    const level = createTestLevel({ gauges: NOISE_GAUGES, waves: [FAR_AWAY_WAVE] });
    const rig = await newRig(level);
    rig.forceInstinct(1000);
    rig.sim.enqueue({ type: 'SetNoise', t: asSimMs(2000), pct: 100 });
    rig.runTo(2100);
    expect(only(rig.log, 'LevelEnded')[0]?.reason).toBe('mamaWoke');
    expect(only(rig.log, 'InstinctEnded')).toEqual([
      { type: 'InstinctEnded', t: 2000, reason: 'levelEnded' },
    ]);
  });

  it('gives a trigger that falls in the last step its end in the same step', async () => {
    const rig = await newRig(createTestLevel({ durationMs: 3000, waves: [FAR_AWAY_WAVE] }));
    rig.forceInstinct(3000);
    rig.runTo(3100);
    const types = rig.log.filter((event) => event.t === 3000).map((event) => event.type);
    expect(types.indexOf('InstinctTriggered')).toBeLessThan(types.indexOf('InstinctEnded'));
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(1);
    expect(only(rig.log, 'InstinctEnded')).toHaveLength(1);
  });

  it('does nothing when the instinct is not on', async () => {
    const rig = await newRig(createTestLevel({ durationMs: 1000, waves: [] }));
    rig.runTo(1100);
    expect(only(rig.log, 'InstinctEnded')).toHaveLength(0);
    expect(rig.sim.world.instinct.state).toBe('ready');
  });
});

describe('a live SetFeel during the instinct', () => {
  it('changes neither the end nor the slow-mo hold, and the recharge is read at the end', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.sim.enqueue({
      type: 'SetFeel',
      t: asSimMs(1000),
      patch: { instinct: { durationMs: 500, cooldownMs: 1000 } },
    });
    rig.runTo(1100);
    expect(rig.sim.world.instinct.untilAt).toBe(4100);
    rig.runTo(4100);
    expect(only(rig.log, 'InstinctEnded').map((event) => event.t)).toEqual([4100]);
    expect(rig.scales.filter(([t]) => t >= 100 && t <= 4100).every(([, s]) => s === 0.8)).toBe(
      true,
    );
    // The recharge was not frozen at the trigger: it reads the feel at the end.
    expect(rig.sim.world.instinct.untilAt).toBe(5100);
  });
});

describe('ForceInstinct', () => {
  it('starts it from ready, ignoring the threats and the misses', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.runTo(110);
    expect(only(rig.log, 'InstinctTriggered')).toEqual([
      { type: 'InstinctTriggered', t: 100, untilAt: 4100 },
    ]);
  });

  it('is ignored while active, with no event', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.forceInstinct(1000);
    rig.runTo(2000);
    expect(only(rig.log, 'InstinctTriggered')).toHaveLength(1);
    expect(rig.sim.world.instinct.untilAt).toBe(4100);
  });

  it('starts it from the cooldown too', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.forceInstinct(5000);
    rig.runTo(5100);
    expect(only(rig.log, 'InstinctTriggered').map((event) => event.t)).toEqual([100, 5000]);
    expect(rig.sim.world.instinct.state).toBe('active');
  });

  it('is ignored when the tier has no instinct', async () => {
    const rig = await newRig();
    rig.setTier(0, 'experienced');
    rig.forceInstinct(100);
    rig.runTo(500);
    expect(rig.log.filter((event) => event.type.startsWith('Instinct'))).toEqual([]);
    expect(rig.sim.world.instinct.state).toBe('ready');
  });

  it('is a valid command for the journal', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    expect(rig.sim.journal().entries.map((entry) => entry.command.type)).toEqual(['ForceInstinct']);
  });

  it('reads hasInstinct at the trigger only: a running instinct ends normally', async () => {
    const rig = await newRig();
    rig.forceInstinct(100);
    rig.setTier(1000, 'experienced');
    rig.runTo(4200);
    expect(only(rig.log, 'InstinctEnded').map((event) => event.reason)).toEqual(['timer']);
  });
});

describe('snapshot and restore', () => {
  async function replayFrom(untilBeforeMs: number, untilMs: number) {
    const live = await newRig();
    live.forceInstinct(100);
    live.force(10_000, 1);
    live.force(10_100, 2);
    live.runTo(untilBeforeMs);
    const snapshot = JSON.parse(JSON.stringify(live.sim.snapshot()));
    const tail = live.sim.journal().entries.filter((entry) => entry.applyAt > untilBeforeMs);
    const copy = await newRig();
    copy.sim.restore(snapshot, tail);
    live.runTo(untilMs);
    copy.runTo(untilMs);
    return { live, copy, snapshot };
  }

  it('round-trips in the middle of the instinct (the same hash at the end)', async () => {
    const { live, copy, snapshot } = await replayFrom(2000, 40_000);
    expect(snapshot.world.instinct.state).toBe('active');
    expect(hashJson(copy.sim.world)).toBe(hashJson(live.sim.world));
  });

  it('round-trips in the middle of the recharge (the same hash at the end)', async () => {
    const { live, copy, snapshot } = await replayFrom(12_000, 40_000);
    expect(snapshot.world.instinct.state).toBe('cooldown');
    expect(snapshot.world.instinct.missAts.length).toBeGreaterThan(0);
    expect(hashJson(copy.sim.world)).toBe(hashJson(live.sim.world));
  });

  it.each<[string, (w: Record<string, unknown>) => void]>([
    ['no slice', (w) => delete w.instinct],
    ['an unknown state', (w) => ((w.instinct as Record<string, unknown>).state = 'sleeping')],
    ['a non-finite enteredAt', (w) => ((w.instinct as Record<string, unknown>).enteredAt = null)],
    [
      'an enteredAt in the future',
      (w) => ((w.instinct as Record<string, unknown>).enteredAt = 1e9),
    ],
    ['a ready slice with an untilAt', (w) => ((w.instinct as Record<string, unknown>).untilAt = 5)],
    [
      'an active slice that ends before it began',
      (w) => {
        Object.assign(w.instinct as object, { state: 'active', enteredAt: 20, untilAt: 10 });
      },
    ],
    [
      'a cooldown slice that ends before it began',
      (w) => {
        Object.assign(w.instinct as object, { state: 'cooldown', enteredAt: 20, untilAt: 10 });
      },
    ],
    ['misses that are not a list', (w) => ((w.instinct as Record<string, unknown>).missAts = 3)],
    [
      'misses that are not ascending',
      (w) => ((w.instinct as Record<string, unknown>).missAts = [20, 10]),
    ],
    [
      'a miss that is not a number',
      (w) => ((w.instinct as Record<string, unknown>).missAts = ['x']),
    ],
  ])('refuses %s', async (_name, damage) => {
    const live = await newRig();
    live.runTo(30);
    const snapshot = JSON.parse(JSON.stringify(live.sim.snapshot()));
    damage(snapshot.world);
    const target = await newRig();
    expect(() => target.sim.restore(snapshot)).toThrow(/world\.instinct/);
  });

  it('refuses an active instinct once the level has ended (endLevel closes it)', async () => {
    const level = createTestLevel({ waves: [FAR_AWAY_WAVE], durationMs: 3000 });
    const live = await newRig(level);
    live.forceInstinct(100);
    live.runTo(3100);
    expect(live.sim.world.flow.state).toBe('ended');
    const snapshot = JSON.parse(JSON.stringify(live.sim.snapshot()));
    expect(snapshot.world.instinct.state).toBe('cooldown');
    Object.assign(snapshot.world.instinct, { state: 'active', untilAt: 1e9 });
    const target = await newRig(level);
    expect(() => target.sim.restore(snapshot)).toThrow(/world\.instinct/);
  });

  it('refuses an active instinct that should have ended already', async () => {
    const live = await newRig();
    live.forceInstinct(10);
    live.runTo(500);
    const snapshot = JSON.parse(JSON.stringify(live.sim.snapshot()));
    snapshot.world.instinct.untilAt = 100;
    const target = await newRig();
    expect(() => target.sim.restore(snapshot)).toThrow(/world\.instinct/);
  });

  it('refuses a slow-mo of an unknown source', async () => {
    const live = await newRig();
    live.forceInstinct(10);
    live.runTo(50);
    const snapshot = JSON.parse(JSON.stringify(live.sim.snapshot()));
    snapshot.world.time.slowMos[0].source = 'instinctt';
    const target = await newRig();
    expect(() => target.sim.restore(snapshot)).toThrow(/slowMos/);
  });

  it('accepts the instinct slow-mo source', async () => {
    const live = await newRig();
    live.forceInstinct(10);
    live.runTo(50);
    const snapshot = JSON.parse(JSON.stringify(live.sim.snapshot()));
    expect(snapshot.world.time.slowMos[0].source).toBe('instinct');
    const target = await newRig();
    target.sim.restore(snapshot);
    expect(target.sim.world.time.slowMos[0]?.source).toBe('instinct');
  });
});
