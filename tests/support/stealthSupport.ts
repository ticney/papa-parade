import type { SequenceDef } from '@content/schemas/sequence';
import type { RngState } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { SimEvent } from '@sim';
import { createSim, type Sim } from '../../src/sim/createSim.ts';
import type { ThreatInstance, World } from '../../src/sim/world.ts';
import {
  CARRY,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestStealthExit,
  NOISE_GAUGES,
  type TestLevelOptions,
} from './testContent.ts';

// Shared by the stealth exit's tests (story 4.9): a sim of the frozen room that can run
// `stealth_exit`, with the helpers that make an alert come when the test wants it.

/** An rng state whose next `nextFloat` is exactly 0: with `realWakePct` >= 1, a real wake. */
export const FLOAT_ZERO: RngState = { a: 0, b: 0, c: 0, d: 0 };
/** An rng state whose next `nextFloat` is the largest float below 1: with `realWakePct` < 100, a false alarm. */
export const FLOAT_MAX: RngState = { a: -1, b: 0, c: 0, d: 0 };

/** The far future: an alert set for then never comes in a test that is not about it. */
export const NEVER_MS = 100_000_000;

export type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
export const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

export interface StealthSimOptions {
  /** Replaces the frozen sequence (a tuned `realWakePct`, a short `durationMs`…). */
  readonly sequence?: SequenceDef;
  /** The level's noise gauge (none by default). */
  readonly hasNoise?: boolean;
  readonly durationMs?: number;
  readonly seed?: number;
  readonly lagMs?: number;
  /** Extra boards, as `[centerX, centerZ, halfX, halfZ]` in metres: the frozen room has none. */
  readonly creakBoxes?: readonly (readonly [number, number, number, number])[];
  readonly feelOverrides?: TestLevelOptions['feelOverrides'];
}

/**
 * The frozen room with its own boards taken out and `creakBoxes` added in their place (ids
 * `creak_test_<n>`): a test that walks "the real path" puts a board where the path goes, so the
 * room's three boards must not creak under it. `createTestGeometry()` itself keeps them.
 */
export function createCreakGeometry(creakBoxes: StealthSimOptions['creakBoxes'] = []) {
  const geometry = createTestGeometry();
  return {
    ...geometry,
    zones: [
      ...geometry.zones.filter((zone) => zone.kind !== 'creak'),
      ...creakBoxes.map(([x, z, halfX, halfZ], i) => ({
        id: `creak_test_${i}`,
        kind: 'creak' as const,
        centerM: [x, 0.05, z] as [number, number, number],
        halfExtentsM: [halfX, 0.05, halfZ] as [number, number, number],
      })),
    ],
  };
}

export async function createStealthSim(options: StealthSimOptions = {}) {
  const sequence = options.sequence ?? createTestStealthExit();
  const content = createTestContent();
  const sim = await createSim({
    content,
    geometry: createCreakGeometry(options.creakBoxes),
    level: createTestLevel({
      carry: CARRY,
      sequences: [sequence.id],
      sequenceDefs: { [sequence.id]: sequence },
      ...(options.hasNoise ? { gauges: NOISE_GAUGES } : {}),
      ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
      ...(options.feelOverrides === undefined ? {} : { feelOverrides: options.feelOverrides }),
    }),
    seed: options.seed ?? 1,
  });
  // `restore` replaces the world: always read it through the sim.
  const currentWorld = (): World => sim.world as World;
  if (options.lagMs !== undefined && options.lagMs > 0) {
    sim.enqueue({ type: 'SetInputLag', t: currentWorld().time.sim, lagMs: options.lagMs });
  }
  const events: SimEvent[] = [];
  const runTo = (untilMs: number): SimEvent[] => {
    const seen: SimEvent[] = [];
    while (currentWorld().time.sim < untilMs) {
      sim.step();
      seen.push(...sim.drainEvents());
    }
    events.push(...seen);
    return seen;
  };
  const stepOnce = (): SimEvent[] => runTo(currentWorld().time.sim + 10);
  const threatOf = (defId: string): ThreatInstance => {
    const threat = currentWorld().threats.find((candidate) => candidate.defId === defId);
    if (threat === undefined) throw new Error(`no ${defId} instance`);
    return threat;
  };
  return {
    sim,
    get world(): World {
      return currentWorld();
    },
    content,
    sequence,
    events,
    runTo,
    stepOnce,
    falseAlarm: () => threatOf('false_alarm_sigh'),
    realWake: () => threatOf('real_wake'),
    /** Starts the sequence at the next step and runs that step. */
    start(): SimEvent[] {
      sim.enqueue({ type: 'StartSequence', t: currentWorld().time.sim, sequenceId: sequence.id });
      return stepOnce();
    },
    /** Puts the next alert out of the way (`NEVER_MS`), so that only the test's own come. */
    holdAlerts(): void {
      currentWorld().sequence.stealth.nextAlertAt = asSimMs(NEVER_MS);
    },
    /**
     * Makes the next step telegraph an alert of this kind: the rng is set so that the kind's draw is
     * extreme, the alert is due now, and then the following one is held away. Returns the events of
     * the step.
     */
    alertNow(kind: 'falseAlarm' | 'realWake'): SimEvent[] {
      const world = currentWorld();
      world.rng = { ...(kind === 'realWake' ? FLOAT_ZERO : FLOAT_MAX) };
      world.sequence.stealth.nextAlertAt = asSimMs(world.time.sim);
      const seen = stepOnce();
      currentWorld().sequence.stealth.nextAlertAt = asSimMs(NEVER_MS);
      return seen;
    },
    /** Puts Papa at a floor point, as if he had walked there (not a command). */
    teleportPapa(xM: number, zM: number): void {
      const world = currentWorld();
      world.papa.xM = xM;
      world.papa.zM = zM;
      world.papa.prevXM = xM;
      world.papa.prevZM = zM;
    },
  };
}

export type StealthSim = Awaited<ReturnType<typeof createStealthSim>>;
export type { Sim };
