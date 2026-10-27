import { createRng, type RngState } from '@shared/rng';
import { asSimMs, type SimMs } from '@shared/time';
import type { BabyState } from './baby/babyFsm.ts';
import type { PapaState } from './papa/papaFsm.ts';
import type { ThreatState } from './threats/threatFsm.ts';
import type { EffectiveWindow } from './timing/effectiveWindow.ts';

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
  /** The glide towards a threat that was pressed; non-null exactly in `glide`. Choreography only (P3). */
  glide: PapaGlide | null;
}

/** Papa's glide to a pressed threat: it ends by `arriveAt` and never decides a judgement. */
export interface PapaGlide {
  threatId: number;
  toXM: number;
  toZM: number;
  startedAt: SimMs;
  /** May be off the step grid; Papa arrives at the first step at or after it. */
  arriveAt: SimMs;
  speedMps: number;
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
  /** The threat it locked on, from `targetLocked` to the end of the threat (`runBaby`'s own memory). */
  targetThreatId: number | null;
  /** Speed of the current approach, in metres per second; 0 outside `approach`. */
  approachSpeedMps: number;
}

/** A response that was judged `perfect` or `success` and waits to be classified (Parry or Firmness). */
export interface PendingPress {
  t: SimMs;
  quality: 'perfect' | 'success';
  offsetMs: number;
  /** The `Release` that ended it, or null while the finger is down. */
  releasedAt: SimMs | null;
}

/**
 * One planned threat (story 1.10 D5): created at `createSim`, one per entry of the level, and
 * re-armed after each result. The def and `fromMs` stay in `ctx.level`, index-aligned with
 * `world.threats`.
 */
export interface ThreatInstance {
  id: number;
  defId: string;
  anchorId: string;
  /** The anchor's position on the floor plane. */
  xM: number;
  zM: number;
  state: ThreatState;
  /** Sim time of the last state change. */
  enteredAt: SimMs;
  /** Telegraph entry plus the delay; 0 when idle. May be off the step grid. */
  windowOpenAt: SimMs;
  /** Frozen when the threat is telegraphed (a window that moves while read would be unfair); null when idle. */
  responseWindow: EffectiveWindow | null;
  press: PendingPress | null;
}

/** What started a slow-mo. Story 1.18 triggers `lastThreat`; story 2.9 adds `instinct`. */
export type SlowMoSource = 'perfect' | 'lastThreat';

/** Every `SlowMoSource`, as data: a snapshot is checked against it. */
export const SLOW_MO_SOURCES = ['perfect', 'lastThreat'] as const satisfies readonly SlowMoSource[];

type UnlistedSlowMoSource = Exclude<SlowMoSource, (typeof SLOW_MO_SOURCES)[number]>;

/** Compile-time proof that `SLOW_MO_SOURCES` holds every member of the union (see `THREAT_STATES_ARE_COMPLETE`). */
export const SLOW_MO_SOURCES_ARE_COMPLETE: [UnlistedSlowMoSource] extends [never]
  ? true
  : UnlistedSlowMoSource = true;

/** A slow-mo: `scale` from `startedAt` to `holdUntil`, then a smoothstep back to 1 by `endsAt` (sim ms). */
export interface SlowMo {
  source: SlowMoSource;
  scale: number;
  startedAt: SimMs;
  /** `startedAt + durationMs`; may be off the step grid. */
  holdUntil: SimMs;
  /** `holdUntil + returnMs`; the entry is removed at the first step at or after it. */
  endsAt: SimMs;
}

/**
 * The whole simulated state: plain serializable data (no classes, functions, Map/Set, Three or
 * Rapier handles). Later stories add their slice (baby, threats…).
 */
export interface World {
  time: {
    /** Sim time, in ms. Advances by exactly `STEP_MS` per step, whatever `scale` is. */
    sim: SimMs;
    /** The effective `timeScale` the client loop reads: min(baseScale, every slow-mo). Never 0. */
    scale: number;
    /** The scale outside any slow-mo: 1, or what the debug `SetTimeScale` set. */
    baseScale: number;
    /** Active slow-mos, at most one per source, in start order. */
    slowMos: SlowMo[];
  };
  rng: RngState;
  /** Next entity id. Ids come from {@link allocateId}, never from a UUID or a global counter. */
  nextId: number;
  papa: PapaSlice;
  baby: BabySlice;
  /** One per planned threat, in the level's order. */
  threats: ThreatInstance[];
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
    time: { sim: asSimMs(0), scale: 1, baseScale: 1, slowMos: [] },
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
      glide: null,
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
      targetThreatId: null,
      approachSpeedMps: 0,
    },
    threats: [],
  };
}

export function allocateId(world: World): number {
  return world.nextId++;
}
