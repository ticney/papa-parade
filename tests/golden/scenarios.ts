import type { ContentBundle, LevelContent } from '@content/contentBundle';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { createSim, type Journal, type SimCommand, type SimEvent } from '@sim';
import {
  COFFEE_TABLE,
  createTestLevel,
  NOISE_GAUGES,
  OUTLET,
  STAIRS,
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
];

export interface Recording {
  journal: Journal;
  worldHash: string;
  events: SimEvent[];
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
  const recording = { journal: sim.journal(), worldHash: hashJson(sim.world), events };
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
