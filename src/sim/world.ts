import type { Feel } from '@content/schemas/feel';
import { cloneJson } from '@shared/hash';
import { createRng, type RngState } from '@shared/rng';
import { asSimMs, type SimMs } from '@shared/time';
import type { BabyState } from './baby/babyFsm.ts';
import type { DisruptionState } from './disruptions/disruptionFsm.ts';
import type { FlowState } from './flow/flowFsm.ts';
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
  /** The object the current walk goes to (`TapObject`), or null: arriving there runs its action (story 1.19). */
  objectId: string | null;
  /** When `drink` / `asleep` / `onPhone` ends, in sim time; 0 in any other state. */
  busyUntil: SimMs;
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
  /** True while the baby makes its babble. Only a silent mischief clears it, from its arrival in the hidden zone to the find (story 1.21). */
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
  /** The sim time at which it first reached `holdMinMs` (`ResponseHeld`), or null. Story 1.23. */
  heldAt: SimMs | null;
}

/**
 * One planned threat (story 1.10 D5): created at `createSim`, one per planned anchor of the level,
 * and re-armed after each result. The def, the anchor and the first wave stay in `ctx.level`,
 * index-aligned with `world.threats`. A papa-target instance (the micro-sleep, story 1.19) stands
 * on Papa: its `xM` / `zM` follow him at every step.
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
  /**
   * The wave that telegraphed it, kept through `resolved` and `gag` (the last-threat rule reads it)
   * and reset at re-arm. -1 while `idle`, and for a threat no wave planned (story 1.19's micro-sleep).
   */
  waveIndex: number;
}

/**
 * One planned disruption (story 1.20): created at `createSim`, one per entry of the waves'
 * `disruptions`, in wave order. The def, the object and `atMs` stay in `ctx.level.disruptions`,
 * index-aligned with `world.disruptions`. It fires at most once per level.
 */
export interface DisruptionInstance {
  state: DisruptionState;
  /** Sim time of the last state change; 0 while `pending`. */
  enteredAt: SimMs;
  /** When a ringing phone gives up, in sim time (the ring's start plus `ringMaxMs`); 0 unless `ringing`. */
  untilAt: SimMs;
  /**
   * When the next `PhoneRinging` is due, in sim time: the start plus a whole number of
   * `PHONE_RINGING_EVERY_MS`, never the step it was emitted in (no drift); 0 unless `ringing`.
   */
  nextRingingAt: SimMs;
}

/** A free object (`PROP_*`): its pose mirrors its Rapier body at the end of each step (story 1.15). */
export interface PropSlice {
  /** The geometry id (`mug_01`); `world.props[i]` is `geometry.props[i]`. */
  id: string;
  kind: string;
  xM: number;
  yM: number;
  zM: number;
  /** Rotation as a unit quaternion. */
  qx: number;
  qy: number;
  qz: number;
  qw: number;
  /** Pose at the start of the last step, so that the view can interpolate between two steps. */
  prevXM: number;
  prevYM: number;
  prevZM: number;
  prevQx: number;
  prevQy: number;
  prevQz: number;
  prevQw: number;
  /** Lies on the floor (see `propsSystem`). False at spawn, whatever the start pose: `runPhysics` sets it from the first step on. */
  isOnFloor: boolean;
  /** Broke on an impact. A broken prop keeps its body (it still collides). */
  isBroken: boolean;
  /** Sim time of the last `PropImpact`; null before the first. */
  lastImpactAt: SimMs | null;
}

/**
 * The mess, for Mama's sigh (story 1.22). `propsOnFloor` and `propsBroken` are recounted by
 * `runPhysics` every step; `mischiefs` is not: it is cumulative, written only by the surprise gags.
 */
export interface MessSlice {
  /** Unbroken props that spawned above the floor and now lie on it. */
  propsOnFloor: number;
  /** Broken props. */
  propsBroken: number;
  /** Surprise mischiefs the baby got away with (story 1.21): never decreases, not recounted. */
  mischiefs: number;
}

/**
 * The suspicious silence (story 1.21), owned by `runSilence` inside `runBaby`. All null while no
 * silence is under way. `threatId` is the `hidden` (then `telegraph`, once found) threat the baby
 * took; `zoneEnteredAt` is when it arrived in the zone (its babble stops then); `startedAt` is when
 * `SilenceStarted` was emitted: the music cut and the bubble follow it.
 */
export interface SilenceSlice {
  threatId: number | null;
  zoneEnteredAt: SimMs | null;
  startedAt: SimMs | null;
}

/**
 * Mama's note (story 1.22, GDD › economy): four integer rows and their sum, out of 100. The rows
 * always add up: `scorePoints = laugh + babyState + (sighMax − sigh) + (screamMax − scream)`.
 */
export interface MamaScore {
  /** Rire: the perfect responses, held to `laughMaxPoints`. */
  laughPoints: number;
  /** État du bébé: `babyStateFixedPoints` until E5 computes it. */
  babyStatePoints: number;
  /** Soupir, taken off: props on the floor, broken props and mischiefs, held to `sighMaxPoints`. */
  sighPoints: number;
  /** Hurlement, taken off: the near misses, held to `screamMaxPoints`. */
  screamPoints: number;
  scorePoints: number;
  /** 0 to 5: how many `starThresholdPoints` the score reaches. */
  stars: number;
}

/**
 * What feeds Mama's note (story 1.22). The counters are written where their event is produced
 * (`resolveThreat`, the stairs gag); `final` is written once, by `scoreLevel`, at the step the
 * level ends.
 */
export interface ScoreSlice {
  /** `ResponseResolved{perfect}`, the micro-sleep's included. */
  perfects: number;
  /** `NearMiss` events. */
  nearMisses: number;
  /** The note, from the step the level ended; null while it plays. */
  final: MamaScore | null;
}

/** The wave director's memory (story 1.18): the wave entered last, and when the next telegraph is due. */
export interface DirectorSlice {
  /** The last wave entered; -1 before the first. */
  waveIndex: number;
  /** The next telegraph is not due before this sim time. */
  nextAt: SimMs;
}

/**
 * The gauges of the level (story 1.19; noise joins in 3.1). `fatigue` is held in `[0, 100]` and
 * written only by `addFatigue`.
 */
export interface GaugesSlice {
  fatigue: number;
  /** Whether `fatigue` is strictly above the threshold: the sim's rules apply then (the crossing is an event). */
  isFatigueAbove: boolean;
  /** When the next micro-sleep is due, in sim time; null while Papa is not above the threshold. */
  microSleepAt: SimMs | null;
}

/** The level's flow: playing until the clock reaches the level's duration, then ended. */
export interface FlowSlice {
  state: FlowState;
  /** Sim time of the last state change. */
  enteredAt: SimMs;
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

/** A slow-mo: `scale` from `startedAt` up to (not including) `holdUntil`, then a smoothstep back to 1 by `endsAt` (sim ms). */
export interface SlowMo {
  source: SlowMoSource;
  scale: number;
  startedAt: SimMs;
  /** `startedAt + durationMs`; may be off the step grid. The hold excludes it: the return starts here. */
  holdUntil: SimMs;
  /** `holdUntil + returnMs`; the entry is removed at the first step at or after it. */
  endsAt: SimMs;
}

/**
 * The whole simulated state: plain serializable data (no classes, functions, Map/Set, Three or
 * Rapier handles). Later stories add their slice (baby, threats, director, flow…).
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
  director: DirectorSlice;
  /** One per planned disruption, in the level's order (the waves', flattened). */
  disruptions: DisruptionInstance[];
  flow: FlowSlice;
  gauges: GaugesSlice;
  /** One per prop of the level's geometry, index-aligned with `geometry.props` (their bodies live in Rapier, beside `World`). */
  props: PropSlice[];
  mess: MessSlice;
  /** The suspicious silence under way, if any (story 1.21). */
  silence: SilenceSlice;
  /** What feeds Mama's note, and the note once the level has ended (story 1.22). */
  score: ScoreSlice;
  /**
   * The effective feel (story 2.1): the feel given to `createSim`, with every `SetFeel` laid over
   * it. A `SetFeel` replaces this object at the head of a step; systems read it through `ctx.feel`,
   * so it is in the snapshot and survives `restore()`. Values the sim reads only when it is
   * created (nav radii, `physics`, the first wander, the start fatigue) keep doing so.
   */
  feel: Feel;
}

export interface WorldOptions {
  seed: number;
  /** The effective feel at the start; the world keeps a copy. */
  feel: Feel;
  papaSpawn: { xM: number; zM: number };
  babySpawn: { xM: number; zM: number };
  /** When the baby first sets off, in sim ms. */
  firstWanderAt: SimMs;
  /** The fatigue gauge at the start (`feel.fatigue.startPoints`); 0 by default. */
  fatiguePoints?: number;
  /** The level's props (`geometry.props`): they start at their `centerM`, upright and at rest. */
  props?: readonly {
    readonly id: string;
    readonly kind: string;
    readonly centerM: readonly [number, number, number];
  }[];
}

export function createWorld({
  seed,
  feel,
  papaSpawn,
  babySpawn,
  firstWanderAt,
  fatiguePoints = 0,
  props = [],
}: WorldOptions): World {
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
      objectId: null,
      busyUntil: asSimMs(0),
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
    director: { waveIndex: -1, nextAt: asSimMs(0) },
    disruptions: [],
    flow: { state: 'playing', enteredAt: asSimMs(0) },
    gauges: { fatigue: fatiguePoints, isFatigueAbove: false, microSleepAt: null },
    props: props.map(({ id, kind, centerM: [xM, yM, zM] }) => ({
      id,
      kind,
      xM,
      yM,
      zM,
      qx: 0,
      qy: 0,
      qz: 0,
      qw: 1,
      prevXM: xM,
      prevYM: yM,
      prevZM: zM,
      prevQx: 0,
      prevQy: 0,
      prevQz: 0,
      prevQw: 1,
      isOnFloor: false,
      isBroken: false,
      lastImpactAt: null,
    })),
    mess: { propsOnFloor: 0, propsBroken: 0, mischiefs: 0 },
    silence: { threatId: null, zoneEnteredAt: null, startedAt: null },
    score: { perfects: 0, nearMisses: 0, final: null },
    feel: cloneJson(feel),
  };
}

export function allocateId(world: World): number {
  return world.nextId++;
}
