import type { ContentBundle } from '@content/contentBundle';
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
];

export interface Recording {
  journal: Journal;
  worldHash: string;
  events: SimEvent[];
}

export async function recordScenario(
  content: ContentBundle,
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
  const sim = await createSim({ content, seed: scenario.seed });
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
