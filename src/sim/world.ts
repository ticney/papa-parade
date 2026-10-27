import { createRng, type RngState } from '@shared/rng';
import { asSimMs, type SimMs } from '@shared/time';
import type { BabyState } from './baby/babyFsm.ts';
import type { PapaState } from './papa/papaFsm.ts';

/** Papa: a point on the floor plane (y = 0) that walks on the navigation grid. */
export interface PapaSlice {
  state: PapaState;
  /** Sim time of the last state change. */
  enteredAt: SimMs;
  xM: number;
  zM: number;
  /** Position at the start of the last step, so that the view can interpolate between two steps. */
  prevXM: number;
  prevZM: number;
  /** Unit vector of the last direction of travel; (0, 1) at spawn. */
  headingX: number;
  headingZ: number;
  /** Waypoints still ahead as a flat `[x0, z0, x1, z1, …]`; empty unless `walkPath`. */
  path: number[];
  /** Next waypoint, counted in points (not in numbers). */
  pathIndex: number;
  /** Unit vector of the pushed direction; (0, 0) unless `walkDir`. */
  dirX: number;
  dirZ: number;
  /** A direction walk that cannot move at all. */
  isBlocked: boolean;
}

/** The baby: a point on the floor plane (y = 0) that crawls on its own grid and babbles. */
export interface BabySlice {
  state: BabyState;
  /** Sim time of the last state change. */
  enteredAt: SimMs;
  xM: number;
  zM: number;
  /** Position at the start of the last step, so that the view can interpolate between two steps. */
  prevXM: number;
  prevZM: number;
  /** Unit vector of the last direction of travel; (0, 1) at spawn. */
  headingX: number;
  headingZ: number;
  /** Unit vector of where the eyes look; (0, 1) at spawn. It follows the heading while wandering. */
  gazeX: number;
  gazeZ: number;
  /** Waypoints still ahead as a flat `[x0, z0, x1, z1, …]`; empty unless `wander`. */
  path: number[];
  /** Next waypoint, counted in points (not in numbers). */
  pathIndex: number;
  /** Sim time at which a babbling baby sets off again; only read in `babble`. */
  wanderAt: SimMs;
  /** True while the baby makes its babble: wander and babble. Only a silent mischief clears it. */
  babbling: boolean;
}

/**
 * The whole simulated state: plain serializable data (no classes, functions, Map/Set, Three or
 * Rapier handles). Later stories add their slice (baby, threats…).
 */
export interface World {
  time: {
    /** Sim time, in ms. Advances by exactly `STEP_MS` per step, whatever `scale` is. */
    sim: SimMs;
    /** `timeScale`: how fast the client loop feeds steps (1 = real time). Never 0. */
    scale: number;
  };
  rng: RngState;
  /** Next entity id. Ids come from {@link allocateId}, never from a UUID or a global counter. */
  nextId: number;
  papa: PapaSlice;
  baby: BabySlice;
}

export interface WorldOptions {
  seed: number;
  papaSpawn: { xM: number; zM: number };
  babySpawn: { xM: number; zM: number };
  /** When the baby first sets off, in sim ms. */
  firstWanderAt: SimMs;
}

export function createWorld({ seed, papaSpawn, babySpawn, firstWanderAt }: WorldOptions): World {
  return {
    time: { sim: asSimMs(0), scale: 1 },
    rng: createRng(seed),
    nextId: 1,
    papa: {
      state: 'idle',
      enteredAt: asSimMs(0),
      xM: papaSpawn.xM,
      zM: papaSpawn.zM,
      prevXM: papaSpawn.xM,
      prevZM: papaSpawn.zM,
      headingX: 0,
      headingZ: 1,
      path: [],
      pathIndex: 0,
      dirX: 0,
      dirZ: 0,
      isBlocked: false,
    },
    baby: {
      state: 'babble',
      enteredAt: asSimMs(0),
      xM: babySpawn.xM,
      zM: babySpawn.zM,
      prevXM: babySpawn.xM,
      prevZM: babySpawn.zM,
      headingX: 0,
      headingZ: 1,
      gazeX: 0,
      gazeZ: 1,
      path: [],
      pathIndex: 0,
      wanderAt: firstWanderAt,
      babbling: true,
    },
  };
}

export function allocateId(world: World): number {
  return world.nextId++;
}
