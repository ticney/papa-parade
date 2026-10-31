import type { ContentBundle, LevelContent } from '@content/contentBundle';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import type { BeatsStep } from '@content/schemas/sequence';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { beatTimelineOf, createSim, type Journal, type SimCommand, type SimEvent } from '@sim';
import {
  CARRY,
  COFFEE_TABLE,
  createTestContent,
  createTestLevel,
  createTestLullabyWalk,
  createTestStayAwake,
  FATIGUE_GAUGES,
  NEED_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  STAIRS,
  TEST_TOILET,
  testWave,
} from '../support/testContent.ts';

/** A recorded live game: commands are enqueued at given steps, as the client would. */
export interface Scenario {
  name: string;
  /** What the level plans: `createTestLevel()` for a scenario without threats. */
  level: LevelContent;
  seed: number;
  untilSimMs: number;
  /** Enqueued just before step number `atStep` (0 = before the first step). */
  actions: { atStep: number; command: SimCommand }[];
}

const scale = (t: number, value: number): SimCommand => ({
  type: 'SetTimeScale',
  t: asSimMs(t),
  scale: value,
});

const tapFloor = (t: number, xM: number, zM: number): SimCommand => ({
  type: 'TapFloor',
  t: asSimMs(t),
  xM,
  zM,
});
const walk = (t: number, dirX: number, dirZ: number): SimCommand => ({
  type: 'Move',
  t: asSimMs(t),
  dirX,
  dirZ,
});
const walkStop = (t: number): SimCommand => ({ type: 'MoveStop', t: asSimMs(t) });
const pressOutlet = (t: number): SimCommand => ({
  type: 'PressThreat',
  t: asSimMs(t),
  threatId: 1,
});
const release = (t: number): SimCommand => ({ type: 'Release', t: asSimMs(t) });
const tapBaby = (t: number): SimCommand => ({ type: 'TapBaby', t: asSimMs(t) });
const pushProp = (t: number, propId: string, impulseXNs: number): SimCommand => ({
  type: 'PushProp',
  t: asSimMs(t),
  propId,
  impulseXNs,
  impulseYNs: 0,
  impulseZNs: 0,
});

const setNoise = (t: number, pct: number): SimCommand => ({
  type: 'SetNoise',
  t: asSimMs(t),
  pct,
});

const setFeel = (
  t: number,
  patch: Extract<SimCommand, { type: 'SetFeel' }>['patch'],
): SimCommand => ({
  type: 'SetFeel',
  t: asSimMs(t),
  patch,
});

/** The frozen feel's window: the scenario below widens it, then puts it back, relative to this. */
const { windowMs: testWindowMs } = createTestContent().feel.timing;

/**
 * The frozen « Rester éveillé » cut short for the goldens (story 4.4): two steps of 4 s, a micro-sleep
 * every 2.5 s in each. 8 s long: the first micro-sleep is telegraphed at 2.51 s, the second at 5.01 s.
 */
const SHORT_STAY_AWAKE = (() => {
  const def = createTestStayAwake();
  def.steps = def.steps.slice(0, 2).map((step) => ({
    ...step,
    durationMs: 4000,
    gapMinMs: 2500,
    gapMaxMs: 2500,
  }));
  return def;
})();

/** The level of the two `stay_awake` scenarios: an outlet from 1 s, fatigue, noise, the arms and the sequence. */
const stayAwakeLevel = () =>
  createTestLevel({
    waves: [testWave([OUTLET], { gapMinMs: 1000, gapMaxMs: 1000 })],
    gauges: { ...FATIGUE_GAUGES, ...NOISE_GAUGES },
    carry: CARRY,
    sequences: ['stay_awake'],
    sequenceDefs: { stay_awake: SHORT_STAY_AWAKE },
  });

const startStayAwake = (t: number): SimCommand => ({
  type: 'StartSequence',
  t: asSimMs(t),
  sequenceId: 'stay_awake',
});
/** A press on a threat, at `t`, enqueued at the step that reaches `t`. */
const pressAt = (t: number, threatId: number): { atStep: number; command: SimCommand } => ({
  atStep: t / STEP_MS,
  command: { type: 'PressThreat', t: asSimMs(t), threatId },
});
const releaseAt = (t: number): { atStep: number; command: SimCommand } => ({
  atStep: t / STEP_MS,
  command: release(t),
});
const WIDER_MS = 200;

// « Les 100 pas en rythme » (story 4.5): the frozen 10 s def, started at t = 0, so the sequence starts
// at 10 ms (the first step that sees the command) and every note falls at `10 + offsetMs`.
const LULLABY_STARTED_AT = STEP_MS;
const LULLABY_STEP = createTestLullabyWalk().steps[0] as BeatsStep;
const LULLABY_TIMELINE = beatTimelineOf(LULLABY_STEP);
const LULLABY_BEATS = LULLABY_TIMELINE.filter((entry) => entry.kind === 'beat');
const lullabyLevel = () => createTestLevel({ carry: CARRY, sequences: ['lullaby_walk'] });
const startLullaby: SimCommand = {
  type: 'StartSequence',
  t: asSimMs(0),
  sequenceId: 'lullaby_walk',
};
/** A tap to the beat `deltaMs` after the instant `offsetMs` of the step, enqueued at the step that reaches it. */
const tapBeatAt = (offsetMs: number, deltaMs = 0): { atStep: number; command: SimCommand } => {
  const t = LULLABY_STARTED_AT + offsetMs + deltaMs;
  return { atStep: Math.floor(t / STEP_MS), command: { type: 'TapBeat', t: asSimMs(t) } };
};
const beatOffsetMs = (judgedIndex: number): number => LULLABY_BEATS[judgedIndex]?.offsetMs ?? 0;
const decoyOffsetMs = LULLABY_TIMELINE.find((entry) => entry.kind === 'decoy')?.offsetMs ?? 0;

export const SCENARIOS: readonly Scenario[] = [
  {
    // Time and commands only (no gameplay system exists yet). It still covers a late command
    // (t older than the sim time at enqueue), an off-grid t and a future command. Later stories
    // add scenarios with real gameplay (the first one in story 1.10).
    name: 'core_basic',
    level: createTestLevel(),
    seed: 42,
    untilSimMs: 30000,
    actions: [
      { atStep: 0, command: scale(500, 0.3) },
      { atStep: 0, command: scale(6003.7, 1) },
      { atStep: 800, command: scale(7900, 0.5) },
      { atStep: 1500, command: scale(15000, 0.2) },
      { atStep: 1600, command: scale(25000, 1) },
    ],
  },
  {
    // Papa on the frozen living-room geometry: a tap that needs a detour (the centre of the
    // `behind_sofa` zone), a MoveStop during that path (ignored), a tap on the sofa (a blocked
    // cell) and one outside the grid (both snap to the nearest open cell), a Move into the right
    // wall (the one PapaBlocked), a diagonal Move that walks away from it (sliding along a wall is
    // pinned in `papaSystem.test.ts`), a TapFloor during a direction walk, and a command with an off-grid, already past `t`.
    name: 'papa_walk',
    level: createTestLevel(),
    seed: 7,
    untilSimMs: 15000,
    actions: [
      { atStep: 0, command: tapFloor(0, 0.5, -2.6) },
      { atStep: 60, command: walkStop(600) },
      { atStep: 300, command: tapFloor(3000, 0.5, -1.7) },
      { atStep: 450, command: tapFloor(4500, 10, 10) },
      { atStep: 800, command: walk(8000, 1, 0) },
      { atStep: 850, command: walk(8500, -1, 1) },
      { atStep: 950, command: walkStop(9500) },
      { atStep: 1000, command: tapFloor(10000, -2, 0) },
      { atStep: 1040, command: walkStop(10400) },
      { atStep: 1100, command: walk(11000, 0, -1) },
      { atStep: 1140, command: tapFloor(11400, 2.5, 1.5) },
      { atStep: 1300, command: walk(12987.3, -1, -0.5) },
      { atStep: 1340, command: walkStop(13400) },
    ],
  },
  {
    // The baby on its own: no command at all. It sits and babbles, crawls to a drawn destination,
    // sits again (the first `world.rng` draws of the sim), for several cycles.
    name: 'baby_wander',
    level: createTestLevel(),
    seed: 3,
    untilSimMs: 30000,
    actions: [],
  },
  {
    // The outlet, planned from 2 s, over four cycles; the first scenario that draws from the rng
    // (the baby wanders and babbles between cycles) and allocates ids. The times are read from a
    // first recording (telegraphs at 2000, 9410, 16320 and 23900; the window opens 1200 ms later,
    // its centre 150 ms after that) and written down as literals:
    //  1. a perfect Parry (press at the centre of the window, released 50 ms later);
    //  2. a press far too early: gag `early`, Papa already at the wall (a zero-length glide);
    //  3. nothing pressed: gag `late`; Papa is sent away with a tap (he is far for the next cycle);
    //  4. a perfect Parry whose press reaches the sim 150 ms after its own `t` (late enqueue: judged
    //     on `t`), then a TapFloor in the middle of the glide, which cancels it.
    name: 'outlet_parry',
    level: createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })] }),
    seed: 11,
    untilSimMs: 30000,
    actions: [
      { atStep: 200, command: pressOutlet(3350) },
      { atStep: 200, command: release(3400) },
      { atStep: 1030, command: pressOutlet(10300) },
      { atStep: 1800, command: tapFloor(18000, 2.5, 1.5) },
      { atStep: 2540, command: pressOutlet(25250) },
      { atStep: 2540, command: release(25300) },
      { atStep: 2548, command: tapFloor(25500, 0.5, -2.6) },
    ],
  },
  {
    // The chain accident of story 1.15, on the frozen living room: the mug is pushed along +x off the
    // coffee table (0.72 N·s, calibrated: between about 0.68 and 0.78 it lands on the vase), falls
    // on the vase, which breaks, and ends on the floor. Props only: no threat, no command but the push.
    // The calibration and the measured impulses are in the story's Debug Log.
    name: 'prop_fall',
    level: createTestLevel(),
    seed: 42,
    untilSimMs: 3000,
    actions: [{ atStep: 10, command: pushProp(100, 'mug_01', 0.72) }],
  },
  {
    // The feel tuned while playing (story 2.1): the outlet over two cycles, with a `SetFeel` before
    // each telegraph. Cycle 1: the window is widened by 200 ms at 1500 ms, so the window frozen at
    // the telegraph (2000) is 200 ms longer and its centre 100 ms later; a press at the OLD centre
    // is then 100 ms early of the new one, a `success` and not the `perfect` it would be with the
    // unchanged feel. Cycle 2: the window is put back, and `earlyPress` goes to `guard`, so a press
    // far too early (9600) is ignored (no gag) and the next one, at the centre (10760), is a `perfect`.
    name: 'feel_change',
    level: createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })] }),
    seed: 11,
    untilSimMs: 20000,
    actions: [
      { atStep: 150, command: setFeel(1500, { timing: { windowMs: testWindowMs + WIDER_MS } }) },
      { atStep: 200, command: pressOutlet(3350) },
      { atStep: 200, command: release(3400) },
      {
        atStep: 500,
        command: setFeel(5000, {
          timing: { windowMs: testWindowMs },
          input: { earlyPress: 'guard' },
        }),
      },
      // The second telegraph is at 9410, the window opens at 10610 and its centre is 10760.
      { atStep: 960, command: pressOutlet(9600) },
      { atStep: 960, command: release(9650) },
      { atStep: 1076, command: pressOutlet(10760) },
      { atStep: 1076, command: release(10810) },
    ],
  },
  {
    // `prop_fall` in a level with the noise gauge (story 3.1): pins how much noise the fall of the mug
    // off the coffee table, onto the vase and the floor, makes in all (Open point 3 of the story).
    // Same seed, same push: the physics is the same, only the `NoiseChanged` events are new.
    name: 'prop_fall_noise',
    level: createTestLevel({ gauges: NOISE_GAUGES }),
    seed: 42,
    untilSimMs: 3000,
    actions: [{ atStep: 10, command: pushProp(100, 'mug_01', 0.72) }],
  },
  {
    // Mama wakes (story 3.2): a level with the noise gauge, quiet until a debug `SetNoise` takes it to
    // 100 % at 1 s. The next step ends the level: `MamaWoke`, `LevelEnded{mamaWoke}` and `LevelScored`
    // with one lost star (a quiet start has stars to lose), then 1 s of a frozen world. The level lasts
    // much longer than this: the early end is what pins the golden. `mamaWoke.test.ts` pins what it covers.
    name: 'mama_woke',
    level: createTestLevel({ gauges: NOISE_GAUGES }),
    seed: 42,
    untilSimMs: 2000,
    actions: [{ atStep: 100, command: setNoise(1000, 100) }],
  },
  {
    // The three threats of the prototype, planned together in one wave from 0 ms (outlet, stairs,
    // coffee table; one at a time, no gap), none of them answered: the director picks them with the
    // PRNG (story 1.18, no longer in array order), and each ends in its gag. The stairs gag adds a `NearMiss`; the coffee-table gag pushes the mug off the
    // table onto the vase (a `PropImpact` for the mug, the vase's `PropBroken`, and the mess).
    // No command at all: `threatTrio.test.ts` pins what it covers.
    name: 'threat_trio',
    level: createTestLevel({ waves: [testWave([OUTLET, STAIRS, COFFEE_TABLE])] }),
    seed: 42,
    untilSimMs: 40000,
    actions: [],
  },
  {
    // Carrying the baby (story 4.1), on the frozen living room with a cry in the arms. The outlet,
    // planned from 2 s, is telegraphed while Papa waits next to the baby (a TapFloor at 0 walks him
    // there). The baby is locked on the outlet and crawling to it when a TapBaby at 2320 takes him
    // (within reach): `BabyStateChanged{carried}`, `BabyPickedUp`, and the outlet, still in its
    // telegraph, is cancelled (`ThreatCancelled{carried}`: no gag, no result). A TapFloor at the
    // playpen's centre walks Papa there with the baby, who is put down on arrival: `BabyPutDown{safe}`.
    // The director then draws the outlet again (4000) and a perfect Parry resolves it. The times are
    // read from a first recording (telegraph 2000, pick-up 2330, put-down 3120, second telegraph
    // 4000, its window opens 5200, centre 5350). `babyCarry.test.ts` pins what it covers.
    name: 'baby_carry',
    level: createTestLevel({
      waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
      carry: CARRY,
    }),
    seed: 11,
    untilSimMs: 8000,
    actions: [
      { atStep: 0, command: tapFloor(0, -0.2, 1.2) },
      { atStep: 232, command: tapBaby(2320) },
      { atStep: 250, command: tapFloor(2500, -2, 1.6) },
      { atStep: 530, command: pressOutlet(5350) },
      { atStep: 530, command: release(5400) },
    ],
  },
  {
    // The combo cashed in (story 4.2), on the frozen living room with a cry in the arms and no wave.
    // A TapBaby at 0 walks Papa to the baby and takes him (pick-up 1010). The first carry tick comes
    // 10 s later (11010, x2); the cry in the arms, telegraphed at 9940, opens its window at 11140 and
    // a perfect Parry at its centre resolves it (11340, x3, 1 base point). A TapFloor at the playpen's
    // centre walks Papa there and the baby is put down safe (11920): the combo is cashed in (3 x 1 = 3
    // points), the cash-in slow-mo runs out, and the level ends at 16000 with the points in the Rire
    // (1 perfect + 3 combo points). The times are read from a first recording.
    // `comboCashIn.test.ts` pins what it covers.
    name: 'combo_cash_in',
    level: createTestLevel({ waves: [], carry: CARRY, durationMs: 16000 }),
    seed: 21,
    untilSimMs: 16000,
    actions: [
      { atStep: 0, command: tapBaby(0) },
      { atStep: 1120, command: { type: 'PressThreat', t: asSimMs(11290), threatId: 1 } },
      { atStep: 1120, command: release(11340) },
      { atStep: 1140, command: tapFloor(11400, -2, 1.6) },
    ],
  },
  {
    // The pressing need (story 4.3), on the frozen living room with the toilet and one outlet planned
    // from 2 s that nobody answers. A debug `SetFeel` shortens the visit to 1.5 s and a `SetBladder`
    // fills the need at once (`BladderFilled`): the walk to the door is slowed by 30 %. Papa goes in
    // (`ToiletStarted`), the outlet ends in its `late` gag meanwhile with nobody to answer it, and the
    // visit ends exactly `toiletDurationMs` later (`ToiletFinished`, the need back to 0, `BladderFilled`
    // can fire again). The times are read from a first recording. `toiletVisit.test.ts` pins what it covers.
    name: 'toilet_visit',
    level: createTestLevel({
      waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
      objects: [TEST_TOILET],
      gauges: NEED_GAUGES,
    }),
    seed: 31,
    untilSimMs: 10000,
    actions: [
      {
        atStep: 0,
        command: {
          type: 'SetFeel',
          t: asSimMs(0),
          patch: { bladder: { toiletDurationMs: 1500 } },
        },
      },
      { atStep: 0, command: { type: 'SetBladder', t: asSimMs(0), pct: 100 } },
      { atStep: 1, command: { type: 'TapObject', t: asSimMs(STEP_MS), objectId: 'toilet' } },
    ],
  },
  {
    // « Rester éveillé » won (story 4.4), on the frozen living room: the sequence starts at once and
    // takes the baby (10 ms); the micro-sleeps are telegraphed at 2510 and 5010 (the cadence of the
    // short def) and each is parried at the centre of its window (a perfect: 3860, 6360); the
    // sequence ends at 8010 (`SequenceEnded{succeeded}`, the clocks pushed by `resumeGapMs`),
    // the player puts the baby down (8500, applied at 8510), the director returns at 10010 (the outlet, parried at 11360).
    // The times are read from a first recording. `stayAwake.test.ts` pins what it covers.
    name: 'stay_awake_held',
    level: stayAwakeLevel(),
    seed: 41,
    untilSimMs: 14000,
    actions: [
      { atStep: 0, command: startStayAwake(0) },
      pressAt(3860, 2),
      releaseAt(3910),
      pressAt(6360, 2),
      releaseAt(6410),
      { atStep: 850, command: tapBaby(8500) },
      pressAt(11360, 1),
      releaseAt(11410),
    ],
  },
  {
    // « Les 100 pas en rythme » won (story 4.5): the player walks in time, a little early then a little
    // late, misses judged beat 6 (+25 % wake) and taps once between two beats (+10 %), so the baby
    // stirs twice and sleeps on; the sequence ends `succeeded` at 10 s with the baby still carried.
    // `lullabyWalk.test.ts` (golden) pins what it covers.
    name: 'lullaby_walk_kept',
    level: lullabyLevel(),
    seed: 45,
    untilSimMs: 13000,
    actions: [
      { atStep: 0, command: startLullaby },
      ...LULLABY_BEATS.flatMap((entry, i) =>
        i === 6 ? [] : [tapBeatAt(entry.offsetMs, i % 2 === 0 ? -30 : 30)],
      ),
      // Between two beats, in whole ms (the offsets can differ by an odd number).
      tapBeatAt(Math.round((beatOffsetMs(2) + beatOffsetMs(3)) / 2)),
    ],
  },
  {
    // « Les 100 pas en rythme » lost (story 4.5): beats 0 to 4 are tapped, then the decoy between 4 and
    // 5 is tapped (+40 %), beats 5 and 6 are missed (+50 %), and a stray tap after them (+10 %) takes the
    // wake to 100: `BabyWoke`, `SequenceEnded{failed}`, the baby stays carried.
    name: 'lullaby_walk_woken',
    level: lullabyLevel(),
    seed: 45,
    untilSimMs: 9000,
    actions: [
      { atStep: 0, command: startLullaby },
      ...[0, 1, 2, 3, 4].map((i) => tapBeatAt(beatOffsetMs(i))),
      tapBeatAt(decoyOffsetMs),
      tapBeatAt(beatOffsetMs(7) - 300),
    ],
  },
  {
    // « Rester éveillé » lost (story 4.4): nobody answers the first micro-sleep (telegraphed at 2510,
    // gagged `late` at 4080), Papa falls asleep with the baby in his arms, snores (+15 % noise) and the
    // baby wakes (`PapaSnored`, `BabyWoke`), the sequence ends (`failed`) and Papa wakes 3 s later.
    // `stayAwake.test.ts` pins what it covers.
    name: 'stay_awake_dozed',
    level: stayAwakeLevel(),
    seed: 41,
    untilSimMs: 12000,
    actions: [{ atStep: 0, command: startStayAwake(0) }],
  },
];

export interface Recording {
  journal: Journal;
  worldHash: string;
  events: SimEvent[];
  /** The need at the end of the run, for the scenarios that care (`toilet_visit`). */
  finalBladderPct: number;
}

export async function recordScenario(
  content: ContentBundle,
  geometry: LevelGeometry,
  scenario: Scenario,
): Promise<Recording> {
  const steps = scenario.untilSimMs / STEP_MS;
  if (!Number.isInteger(steps)) {
    throw new Error(`${scenario.name}: untilSimMs must be a multiple of ${STEP_MS}`);
  }
  for (const { atStep } of scenario.actions) {
    if (!Number.isInteger(atStep) || atStep < 0 || atStep >= steps) {
      throw new Error(`${scenario.name}: action at step ${atStep} is outside [0, ${steps})`);
    }
  }
  const sim = await createSim({ content, geometry, level: scenario.level, seed: scenario.seed });
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    for (const action of scenario.actions) if (action.atStep === i) sim.enqueue(action.command);
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  const recording = {
    journal: sim.journal(),
    worldHash: hashJson(sim.world),
    events,
    finalBladderPct: sim.world.gauges.bladderPct,
  };
  sim.dispose();
  return recording;
}

export interface Expected {
  untilSimMs: number;
  worldHash: string;
  eventTypes: string[];
  eventsHash: string;
}

export function summarize(
  untilSimMs: number,
  worldHash: string,
  events: readonly SimEvent[],
): Expected {
  return {
    untilSimMs,
    worldHash,
    eventTypes: events.map((event) => event.type),
    eventsHash: hashJson(events),
  };
}
