import type { Feel } from '@content/schemas/feel';
import type { InvariantContext } from '@shared/invariant';
import type { CommandQueue } from './commandQueue.ts';
import type { SimCommand } from './commands.ts';
import type { SimEvent } from './events.ts';
import type { NavGrid } from './nav/navGrid.ts';
import type { World } from './world.ts';

/** Navigation grids, one per kind of agent, built once from the level geometry. Outside `World`. */
export interface NavContext {
  /** Papa's: eroded by `feel.movement.papaRadiusM` (read once, when the sim is created). */
  readonly papa: NavGrid;
  /** The baby's: eroded by `feel.baby.bodyRadiusM` (read once, when the sim is created). */
  readonly baby: NavGrid;
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
  /** The sanctioned hitstop channel: it writes outside `World`, in real ms. */
  requestFreezeRealMs(ms: number): void;
}

export type System = (world: World, ctx: StepContext) => void;
