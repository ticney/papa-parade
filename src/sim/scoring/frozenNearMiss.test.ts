import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  NOISE_GAUGES,
  STAIRS,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { System } from '../context.ts';
import { createSim, createSimWithSystems, type Sim } from '../createSim.ts';
import type { LevelEndReason, SimEvent } from '../events.ts';
import { SYSTEMS } from '../step.ts';
import { enterThreatState, type ThreatState } from '../threats/threatFsm.ts';
import type { World } from '../world.ts';

const CONTENT = createTestContent();
const { frozenNearMissReachM: REACH_M } = CONTENT.feel.endOfLevel;
const MAMA = CONTENT.feel.mama;
const DURATION_MS = 3000;
const RUSH_DURATION_MS = 15_000;
/** The stairs threat's point in the frozen room (`stairs_top`). */
const STAIRS_AT = { xM: 3.9, zM: -1.25 };
/** Well away from the stairs: the baby's spawn. */
const FAR_AT = { xM: -0.5, zM: 1.2 };
/** Past the reach by a hand's width, and just inside it. */
const JUST_OUTSIDE = { xM: STAIRS_AT.xM - (REACH_M + 0.1), zM: STAIRS_AT.zM };
const JUST_INSIDE = { xM: STAIRS_AT.xM - (REACH_M - 0.1), zM: STAIRS_AT.zM };
/** Well inside: for a threat that is up, whose baby walks to it while the test places him. */
const AT_THE_STAIRS = { xM: STAIRS_AT.xM - 0.2, zM: STAIRS_AT.zM };

type Point = { xM: number; zM: number };

interface Scenario {
  /** Where the baby stands in the step before the end; his spawn when absent. */
  babyAt?: Point;
  /** Papa takes him in his arms there (a `TapBaby` within reach), then the level ends. */
  carried?: boolean;
  /** How the level ends. */
  reason?: LevelEndReason;
  /** Force the stairs threat at 0 ms, and end the level at `endMs` to catch it in a given state. */
  force?: boolean;
  endMs?: number;
  /** Plan a stairs threat (the default) or a coffee table object, which has no near-miss gag. */
  threat?: 'stairs' | 'coffee_table';
  /** The level plans no waves at all (`chambre_night` has no near-miss threat). */
  noThreat?: boolean;
  /** The level has a final rush, so that its timer ends on `photo` (story 3.5). */
  rush?: boolean;
  /** The stairs threat is `resolved` (a parry) when the level ends. */
  resolved?: boolean;
}

interface Played {
  events: SimEvent[];
  world: World;
  sim: Sim;
}

function levelOf(scenario: Scenario) {
  const threats =
    scenario.noThreat === true ? [] : [scenario.threat === 'coffee_table' ? COFFEE_TABLE : STAIRS];
  return createTestLevel({
    // The wave opens after the level ends: the director draws nothing, unless the scenario forces it.
    waves: threats.length === 0 ? [] : [testWave(threats, { fromMs: 100_000 })],
    durationMs: endMsOf(scenario),
    gauges: scenario.reason === 'mamaWoke' ? NOISE_GAUGES : {},
    carry: CARRY,
    ...(scenario.rush === true ? { finalRush: { spillAnchor: 'coffee_table' } } : {}),
  });
}

/** The level is over: `ended`, or `photo` for the timer of a level with a final rush. */
const isOver = (world: Readonly<World>): boolean =>
  world.flow.state === 'ended' || world.flow.state === 'photo';

/** A rush needs the level to outlast it: the default length is not enough. */
function endMsOf(scenario: Scenario): number {
  if (scenario.endMs !== undefined) return scenario.endMs;
  return scenario.rush === true ? RUSH_DURATION_MS : DURATION_MS;
}

/** Plays the scenario to the step the level ends, and returns what that step and the ones before it emitted. */
async function play(scenario: Scenario = {}): Promise<Played> {
  // A hidden hand, right before `runFlow`, completes the bedtime cycle of a level that has none (the
  // snapshot would refuse the field, and playing a whole cycle is not what these tests are about), and
  // leaves the stairs threat `resolved` as a parry would (a parry's choreography is not either).
  let isCycleDone = false;
  let isResolved = false;
  const hand: System = (world) => {
    if (isCycleDone && world.cycle.completedAt === null) world.cycle.completedAt = world.time.sim;
    if (!isResolved) return;
    const stairs = world.threats.find((threat) => threat.defId === 'stairs');
    if (stairs !== undefined && stairs.state !== 'resolved') {
      enterThreatState(world, stairs, 'resolved');
    }
  };
  const content = createTestContent();
  // The frozen room's props can all break: the door's spill has nothing to knock over here.
  content.feel.endOfLevel.doorSpillCount = 0;
  const sim = await createSimWithSystems(
    {
      content,
      geometry: createTestGeometry(),
      level: levelOf(scenario),
      seed: 7,
    },
    [...SYSTEMS.slice(0, -1), hand, ...SYSTEMS.slice(-1)],
  );
  const events: SimEvent[] = [];
  const stepOnce = () => {
    sim.step();
    events.push(...sim.drainEvents());
  };
  const endMs = endMsOf(scenario);
  if (scenario.force === true) {
    const stairs = sim.world.threats.find((threat) => threat.defId === 'stairs');
    if (stairs === undefined) throw new Error('the level plans no stairs');
    sim.enqueue({ type: 'ForceThreat', t: asSimMs(0), threatId: stairs.id });
  }
  // Stop two steps short of the end to put the baby where the scenario wants him.
  const placeAtMs = endMs - 3 * STEP_MS;
  while (sim.world.time.sim < placeAtMs) stepOnce();
  if (scenario.babyAt !== undefined || scenario.carried === true) {
    const snapshot = sim.snapshot();
    const at = scenario.babyAt ?? FAR_AT;
    snapshot.world.baby.xM = at.xM;
    snapshot.world.baby.zM = at.zM;
    snapshot.world.baby.prevXM = at.xM;
    snapshot.world.baby.prevZM = at.zM;
    if (scenario.carried === true) {
      snapshot.world.papa.xM = at.xM;
      snapshot.world.papa.zM = at.zM;
      snapshot.world.papa.prevXM = at.xM;
      snapshot.world.papa.prevZM = at.zM;
    }
    sim.restore(snapshot);
    if (scenario.carried === true) {
      sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });
      stepOnce();
      expect(sim.world.baby.state).toBe('carried');
    }
  }
  if (scenario.reason === 'mamaWoke') {
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: 100 });
  }
  isCycleDone = scenario.reason === 'cycleDone';
  isResolved = scenario.resolved === true;
  for (let guard = 0; guard < 10 && !isOver(sim.world); guard++) stepOnce();
  return { events, world: sim.world as World, sim };
}

const of = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

describe('recordFrozenNearMisses (story 3.6, D2)', () => {
  it('counts the baby standing within reach of the stairs, and no one else', async () => {
    const { events, world } = await play({ babyAt: JUST_INSIDE });
    const frozen = of(events, 'NearMissFrozen');
    expect(frozen).toHaveLength(1);
    expect(frozen[0]).toMatchObject({ gag: 'stairs_slide' });
    expect(world.score.nearMisses).toBe(1);
  });

  it('counts nothing beyond the reach, by squared distance', async () => {
    const { events, world } = await play({ babyAt: JUST_OUTSIDE });
    expect(of(events, 'NearMissFrozen')).toEqual([]);
    expect(world.score.nearMisses).toBe(0);
  });

  it('counts nothing for a baby far from the stairs, at his spawn', async () => {
    const { events } = await play({ babyAt: FAR_AT });
    expect(of(events, 'NearMissFrozen')).toEqual([]);
  });

  it('reads the reach from the live feel, not from a literal', async () => {
    const content = createTestContent();
    content.feel.endOfLevel.frozenNearMissReachM = REACH_M + 1;
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: levelOf({}),
      seed: 7,
    });
    const events: SimEvent[] = [];
    while (sim.world.time.sim < DURATION_MS - 3 * STEP_MS) sim.step();
    const snapshot = sim.snapshot();
    snapshot.world.baby.xM = JUST_OUTSIDE.xM;
    snapshot.world.baby.zM = JUST_OUTSIDE.zM;
    snapshot.world.baby.prevXM = JUST_OUTSIDE.xM;
    snapshot.world.baby.prevZM = JUST_OUTSIDE.zM;
    sim.restore(snapshot);
    for (let guard = 0; guard < 10 && !isOver(sim.world); guard++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(of(events, 'NearMissFrozen')).toHaveLength(1);
  });

  it('counts nothing for a carried baby, even at the stairs', async () => {
    const { events, world } = await play({ babyAt: JUST_INSIDE, carried: true });
    expect(of(events, 'NearMissFrozen')).toEqual([]);
    expect(world.score.nearMisses).toBe(0);
  });

  it('counts nothing in a level with no near-miss threat', async () => {
    const none = await play({ noThreat: true, babyAt: STAIRS_AT });
    expect(of(none.events, 'NearMissFrozen')).toEqual([]);
    const table = await play({ threat: 'coffee_table', babyAt: STAIRS_AT });
    expect(of(table.events, 'NearMissFrozen')).toEqual([]);
  });

  it.each<[ThreatState, number]>([
    ['idle', DURATION_MS],
    ['telegraph', 500],
    ['windowOpen', 1200],
  ])('does not look at the threat state: %s', async (state, endMs) => {
    const { events, world } = await play({
      force: state !== 'idle',
      endMs,
      babyAt: AT_THE_STAIRS,
    });
    const stairs = world.threats.find((threat) => threat.defId === 'stairs');
    expect(stairs?.state).toBe(state);
    expect(of(events, 'NearMissFrozen')).toHaveLength(1);
  });

  it('does not look at the threat state: a parried threat (`resolved`) counts too', async () => {
    const { events, world } = await play({ resolved: true, babyAt: AT_THE_STAIRS });
    const stairs = world.threats.find((threat) => threat.defId === 'stairs');
    expect(stairs?.state).toBe('resolved');
    expect(of(events, 'NearMissFrozen')).toHaveLength(1);
    expect(world.score.nearMisses).toBe(1);
  });

  it('does not look at the threat state: a threat that already ended in its gag counts too', async () => {
    const { events, world } = await play({ force: true, endMs: 2900, babyAt: AT_THE_STAIRS });
    const stairs = world.threats.find((threat) => threat.defId === 'stairs');
    expect(stairs?.state).toBe('gag');
    // The slide during play is one `NearMiss`, the photo's is one `NearMissFrozen`: two different things.
    expect(of(events, 'NearMiss')).toHaveLength(1);
    expect(of(events, 'NearMissFrozen')).toHaveLength(1);
    expect(world.score.nearMisses).toBe(2);
  });

  it.each<LevelEndReason>(['timer', 'mamaWoke', 'cycleDone'])(
    'counts on a %s end',
    async (reason) => {
      const { events, world } = await play({ reason, babyAt: JUST_INSIDE });
      expect(of(events, 'LevelEnded')[0]?.reason).toBe(reason);
      expect(of(events, 'NearMissFrozen')).toHaveLength(1);
      expect(world.score.nearMisses).toBe(1);
    },
  );

  it('sits between LevelEnded and LevelScored, at the same t', async () => {
    const { events } = await play({ babyAt: JUST_INSIDE });
    const ended = events.findIndex((event) => event.type === 'LevelEnded');
    const frozen = events.findIndex((event) => event.type === 'NearMissFrozen');
    const scored = events.findIndex((event) => event.type === 'LevelScored');
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(frozen).toBe(ended + 1);
    expect(scored).toBe(frozen + 1);
    expect(events[frozen]?.t).toBe(events[ended]?.t);
  });

  it('draws nothing from world.rng', async () => {
    const without = await play({ babyAt: FAR_AT });
    const within = await play({ babyAt: JUST_INSIDE });
    expect(within.world.rng).toEqual(without.world.rng);
  });

  it("lowers Mama's note by the scream a near miss costs, through the feel's values", async () => {
    const away = await play({ babyAt: FAR_AT });
    const near = await play({ babyAt: JUST_INSIDE });
    const scoreOf = (events: readonly SimEvent[]) => of(events, 'LevelScored')[0];
    const lostScreamPoints = Math.round(
      Math.min(MAMA.screamPerNearMissPoints, MAMA.screamMaxPoints),
    );
    expect(scoreOf(near.events)?.screamPoints).toBe(
      (scoreOf(away.events)?.screamPoints ?? 0) + lostScreamPoints,
    );
    expect(scoreOf(near.events)?.scorePoints).toBe(
      (scoreOf(away.events)?.scorePoints ?? 0) - lostScreamPoints,
    );
  });
});

describe('the end snapshot of a frozen world (story 3.6 AC 2)', () => {
  it.each<[string, Scenario, string]>([
    ['an ended world', { babyAt: JUST_INSIDE }, 'ended'],
    ['a mamaWoke world', { reason: 'mamaWoke' }, 'ended'],
    ['a photo world, the timer ending a final rush', { rush: true }, 'photo'],
  ])('restores %s with the same hash', async (_name, scenario, flowState) => {
    const { sim } = await play(scenario);
    expect(sim.world.flow.state).toBe(flowState);
    const hashBefore = hashJson(sim.world);
    const snapshot = sim.snapshot();
    sim.restore(snapshot);
    expect(hashJson(sim.world)).toBe(hashBefore);
    // This story adds no world field: the snapshot stays at the version 3.5 left.
    expect(snapshot.version).toBe(29);
  });
});
