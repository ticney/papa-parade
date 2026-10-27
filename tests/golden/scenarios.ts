import type { ContentBundle } from '@content/contentBundle';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { createSim, type Journal, type SimCommand, type SimEvent } from '@sim';

/** A recorded live game: commands are enqueued at given steps, as the client would. */
export interface Scenario {
  name: string;
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

export const SCENARIOS: readonly Scenario[] = [
  {
    // Time and commands only (no gameplay system exists yet). It still covers a late command
    // (t older than the sim time at enqueue), an off-grid t and a future command. Later stories
    // add scenarios with real gameplay (the first one in story 1.10).
    name: 'core_basic',
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
  const sim = await createSim({ content, geometry, seed: scenario.seed });
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    for (const action of scenario.actions) if (action.atStep === i) sim.enqueue(action.command);
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return { journal: sim.journal(), worldHash: hashJson(sim.world), events };
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
