import type { Feel } from '@content/schemas/feel';
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
 * is index-aligned with `world.threats`: entry `i` is the def and the start time of instance `i`.
 */
export interface SimLevel {
  readonly threats: readonly { readonly def: ThreatDef; readonly fromMs: number }[];
  /** Index-aligned with `world.props`. */
  readonly props: readonly SimPropSpec[];
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
  /** The effective feel as given to `createSim` (callers pass the already merged feel). */
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
