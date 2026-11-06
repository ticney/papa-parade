import type { ChoreDef } from '@content/schemas/chore';
import type { DisruptionDef } from '@content/schemas/disruption';
import type { Feel } from '@content/schemas/feel';
import type { ObjectKind } from '@content/schemas/level';
import type { SequenceDef } from '@content/schemas/sequence';
import type { ThreatDef } from '@content/schemas/threat';
import type { InvariantContext } from '@shared/invariant';
import type { CommandQueue } from './commandQueue.ts';
import type { SimCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import type { NavGrid } from './nav/navGrid.ts';
import type { PhysicsPort } from './physics/physicsPort.ts';
import type { BeatEntry } from './sequences/beatClock.ts';
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
  /**
   * The house chores (story 9.4), index-aligned with `world.chores`: each def and the station it is
   * played at. Empty: the level has no station.
   */
  readonly chores: readonly SimPlannedChore[];
  /**
   * The special sequences the level can run (story 4.4), in the level's order. Empty: it has none.
   * `StartSequence` starts any of them, and the level's `cycle` chains them (story 4.10).
   */
  readonly sequences: readonly SimSequence[];
  /** The bedtime cycle (story 4.10), or null in a level that has none. */
  readonly cycle: SimCycle | null;
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
  /**
   * The level's `kind: "creak"` zones as floor rectangles (story 4.9), every level (empty when the
   * geometry has none). They creak only under a stealth step, so the other levels' sequences and bots
   * are not touched by them.
   */
  readonly creakZones: readonly SimCreakZone[];
  /** Whether the level has the noise gauge (`gauges.noise`, story 3.1). Without it: no value, no event. */
  readonly hasNoise: boolean;
  /** Whether the level has the need gauge (`gauges.need`, story 4.3). Without it: no value, no event, no toilet. */
  readonly hasBladder: boolean;
  /**
   * Whether the level opts into the final rush (`finalRush`, story 3.5): the door opens
   * `feel.endOfLevel.finalRushMs` before the end and the timer ends the level on `photo`. Without it
   * the level behaves as it always did and ends on `ended`.
   */
  readonly hasFinalRush: boolean;
  /**
   * The floor point the door's shock lands at (`finalRush.spillAnchor`'s x and z, story 3.5): the props that
   * cannot break and stand nearest to it are knocked over when the door opens. Null in a level with no rush.
   */
  readonly spillPointM: { readonly xM: number; readonly zM: number } | null;
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

/** A `ZONE_creak_*` of the room: a board that creaks when Papa steps on it in a stealth step (story 4.9). */
export type SimCreakZone = SimZoneRect;

/** One planned disruption: what, at which object, when, and the wave that planned it. */
export interface SimPlannedDisruption {
  readonly def: DisruptionDef;
  /** The `id` of the level object it rings at (an entry of `SimLevel.objects`). */
  readonly objectId: string;
  /** It starts at the first step at or after this sim time, in sim ms. */
  readonly atMs: number;
  readonly waveIndex: number;
}

/** One planned house chore (story 9.4): its def, its station object, and where that stands. */
export interface SimPlannedChore {
  readonly def: ChoreDef;
  /** The `id` of the level object that is its station (an entry of `SimLevel.objects`). */
  readonly objectId: string;
  /** The station's floor point, the anchor of its object. */
  readonly xM: number;
  readonly zM: number;
  /**
   * The pot of an abandoned chore (story 9.5), or null for a chore with no `abandonedThreat`:
   * `threatIndex` is its instance in `SimLevel.threats` and `world.threats` (planned after every
   * other threat, with `firstWaveIndex` -1), `afterMs` how long the chore must stay `paused` before
   * the sim telegraphs it.
   */
  readonly abandoned: { readonly threatIndex: number; readonly afterMs: number } | null;
}

/** One special sequence a level can run (story 4.4): its id and its def. */
export interface SimSequence {
  readonly id: string;
  readonly def: SequenceDef;
  /**
   * The beat timeline of each step (story 4.5), index-aligned with `def.steps`: `null` for a step
   * that is not a `beats` step. Derived from the def by `simLevelOf`, so it is not in the snapshot.
   */
  readonly beatTimelines: readonly (readonly BeatEntry[] | null)[];
  /**
   * The index, in `SimLevel.threats` and `world.threats`, of the instance each step spawns (story
   * 4.6), index-aligned with `def.steps`: `null` for a step that is not a `duel` step. One instance
   * per distinct def, shared by the steps (and the sequences) that name it. Derived from the def by
   * `simLevelOf`, so it is not in the snapshot.
   */
  readonly duelThreatIndexes: readonly (number | null)[];
  /**
   * The two instances each step spawns (story 4.9), index-aligned with `def.steps`: `null` for a step
   * that is not a `stealth` step. One instance per distinct def, through the map the duel's indices
   * use. Derived from the def by `simLevelOf`, so it is not in the snapshot.
   */
  readonly stealthThreatIndexes: readonly (SimStealthStep | null)[];
}

/** The bedtime cycle of a level (story 4.10): its entries, each def resolved. */
export interface SimCycle {
  readonly entries: readonly SimCycleEntry[];
  readonly retryInterludeMs: number;
  readonly gatherMaxMs: number;
}

/** One entry of the bedtime cycle. */
export interface SimCycleEntry {
  readonly sequenceId: string;
  readonly def: SequenceDef;
  readonly interludeMs: number;
}

/** What a `stealth` step runs on: its false alarm and its real wake (indices in `world.threats`), and the floor point of its exit. */
export interface SimStealthStep {
  readonly falseAlarmIndex: number;
  readonly realWakeIndex: number;
  readonly exitXM: number;
  readonly exitZM: number;
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
  /** Where its centre starts, in metres: tidying puts it back there (story 3.5). */
  readonly spawnM: readonly [number, number, number];
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
