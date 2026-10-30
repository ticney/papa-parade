import type { DisruptionDef } from '@content/schemas/disruption';
import type { Feel } from '@content/schemas/feel';
import type { ObjectKind } from '@content/schemas/level';
import type { ThreatDef } from '@content/schemas/threat';
import type { InvariantContext } from '@shared/invariant';
import type { CommandQueue } from './commandQueue.ts';
import type { SimCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import type { NavGrid } from './nav/navGrid.ts';
import type { PhysicsPort } from './physics/physicsPort.ts';
import type { World } from './world.ts';

/** Navigation grids, one per kind of agent, built once from the level geometry. Outside `World`. */
export interface NavContext {
  /** Papa's: eroded by `feel.movement.papaRadiusM` (read once, when the sim is created). */
  readonly papa: NavGrid;
  /** The baby's: eroded by `feel.baby.bodyRadiusM` (read once, when the sim is created). */
  readonly baby: NavGrid;
}

/**
 * What the level plans, built once by `createSim`, outside `World` (it is constant data). `threats`
 * is index-aligned with `world.threats`: entry `i` is the def, the anchor and the first wave that
 * can draw instance `i` (one instance per planned anchor, in order of first appearance across the waves).
 */
export interface SimLevel {
  readonly threats: readonly SimPlannedThreat[];
  /**
   * The planned disruptions (story 1.20), the waves' flattened in wave order, index-aligned with
   * `world.disruptions`. Empty: the level plans none.
   */
  readonly disruptions: readonly SimPlannedDisruption[];
  /** The waves, in order. Empty: the level plans nothing. */
  readonly waves: readonly SimWave[];
  /** How long the level lasts, in sim ms: the flow ends it then. */
  readonly durationMs: number;
  /** Index-aligned with `world.props`. */
  readonly props: readonly SimPropSpec[];
  /** The level's interactive objects, each at the floor point of its anchor (story 1.17). */
  readonly objects: readonly SimObjectSpec[];
  /**
   * The index, in `threats` and `world.threats`, of the micro-sleep (`gauges.fatigue`, story 1.19),
   * or -1 when the level has no fatigue. It is the last entry, after the wave ones.
   */
  readonly microSleepIndex: number;
  /**
   * The index, in `threats` and `world.threats`, of the cry in the arms (`carry.armsCryDef`, story
   * 4.1), or -1 when the level has none. It stands after the micro-sleep, which keeps its own index.
   */
  readonly armsCryIndex: number;
  /** Whether the level lets Papa carry the baby (`carry`, story 4.1). Without it `TapBaby` only walks. */
  readonly hasCarry: boolean;
  /** The level's `kind: "safe"` zones as floor rectangles (story 4.1); empty without carrying. */
  readonly safeZones: readonly SimSafeZone[];
  /** Whether the level has the noise gauge (`gauges.noise`, story 3.1). Without it: no value, no event. */
  readonly hasNoise: boolean;
}

/**
 * One planned threat: what, where, and from which wave the director may draw it (waves are
 * cumulative). `firstWaveIndex` is -1 for a threat the sim spawns itself (the micro-sleep): no wave
 * draws it, and its `anchorId` is `PAPA_TARGET_ANCHOR_ID`.
 */
export interface SimPlannedThreat {
  readonly def: ThreatDef;
  /** The anchor, or for a hidden-zone threat the id of its `ZONE_hidden_*`. */
  readonly anchorId: string;
  readonly firstWaveIndex: number;
  /** The box of the hidden zone; non-null exactly for a `hiddenZone` def (story 1.21). */
  readonly zone: SimHiddenZone | null;
}

/** A zone of the room as a floor rectangle (a box of the geometry seen from above). */
export interface SimZoneRect {
  readonly id: string;
  readonly centerXM: number;
  readonly centerZM: number;
  /** Half the size of the box along x and z, in metres. */
  readonly halfXM: number;
  readonly halfZM: number;
}

/** A `ZONE_hidden_*` of the room: where a hidden baby is out of sight. */
export type SimHiddenZone = SimZoneRect;

/** A `ZONE_safe_*` of the room: where putting the baby down is safe (story 4.1). */
export type SimSafeZone = SimZoneRect;

/** One planned disruption: what, at which object, when, and the wave that planned it. */
export interface SimPlannedDisruption {
  readonly def: DisruptionDef;
  /** The `id` of the level object it rings at (an entry of `SimLevel.objects`). */
  readonly objectId: string;
  /** It starts at the first step at or after this sim time, in sim ms. */
  readonly atMs: number;
  readonly waveIndex: number;
}

/**
 * A wave as the director reads it. `endMs` is the next wave's `fromMs`, or the level's `durationMs`
 * for the last wave; `closesAtMs` is `endMs − lullMs`: from then on, no new telegraph.
 */
export interface SimWave {
  readonly fromMs: number;
  readonly endMs: number;
  readonly closesAtMs: number;
  readonly maxSimultaneous: number;
  readonly gapMinMs: number;
  readonly gapMaxMs: number;
}

/** An interactive object of the level: constant data (`Sim.objects` hands it to the client). */
export interface SimObjectSpec {
  readonly id: string;
  /** What it is: the action Papa runs on arriving (story 1.19, D7). */
  readonly kind: ObjectKind;
  /** Where Papa walks to, on the floor (the anchor's x and z), in metres. */
  readonly xM: number;
  readonly zM: number;
  /** The anchor's height, in metres: the client projects the object's icon point from it. */
  readonly yM: number;
}

/** What a prop is, apart from where it is: constant data, built once from the geometry and the feel. */
export interface SimPropSpec {
  readonly id: string;
  readonly kind: string;
  /** Half the size of the prop's box along x, y and z, in metres. */
  readonly halfExtentsM: readonly [number, number, number];
  /** Its lowest point started above the floor: it counts as mess once it lies on it. */
  readonly spawnedAboveFloor: boolean;
  /** The kind's entry of `feel.physics.kinds`. */
  readonly physics: Feel['physics']['kinds'][string];
}

export interface StepContext extends InvariantContext {
  /**
   * The effective feel: `world.feel` of the current world (a getter, so `restore()` and a
   * `SetFeel` are seen at once). Read it each time; never keep the object across steps.
   */
  readonly feel: Feel;
  /** Systems push here; the sim drains it. */
  readonly events: SimEvent[];
  /** Internal: only `applyCommands` touches it. */
  readonly queue: CommandQueue;
  /** Commands applied at this step, in order. Reused array: do not keep it. */
  readonly commands: SimCommand[];
  readonly nav: NavContext;
  readonly level: SimLevel;
  /** The props' physics (Rapier), outside `World` like the grids; `Sim.dispose()` frees it. */
  readonly physics: PhysicsPort;
  /** The sanctioned hitstop channel: it writes outside `World`, in real ms. */
  requestFreezeRealMs(ms: number): void;
}

export type System = (world: World, ctx: StepContext) => void;
