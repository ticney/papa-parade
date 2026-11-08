import {
  FOLLOW_CATCH_UP_SHARE_PCT,
  FOLLOW_SNAP_AFTER_MS,
  ISO_FIT_MARGIN_PCT,
  ISO_PITCH_DEG,
  ISO_YAW_DEG,
  STEP_MS,
} from './constants.ts';

// The follow camera of the big room (story 9.2), as pure maths: no `three`, no content, no clock but
// the one passed in. The client moves its `three` camera with it; the `human` bot of story 9.8
// rebuilds the same frame from Papa's position and `feel.camera` (bots import `shared`, never `three`).
//
// Everything happens in the view plane of the iso camera: a world point projects to `u` along the
// camera's right `(cos yaw, 0, −sin yaw)` and `v` along its up
// `(−sin pitch · sin yaw, cos pitch, −sin pitch · cos yaw)`. The camera is orthographic, so moving it
// is moving its view centre in that plane, and the dead zone, the edge margin and the room's bounds
// are plain rectangles there.

const YAW_RAD = (ISO_YAW_DEG * Math.PI) / 180;
const PITCH_RAD = (ISO_PITCH_DEG * Math.PI) / 180;
const COS_YAW = Math.cos(YAW_RAD);
const SIN_YAW = Math.sin(YAW_RAD);
const COS_PITCH = Math.cos(PITCH_RAD);
const SIN_PITCH = Math.sin(PITCH_RAD);
const FIT_GROW = 1 + ISO_FIT_MARGIN_PCT / 100;
/** At or above this damping ratio the spring is solved as critically damped (no division by ~0). */
const CRITICAL_DAMPING_FROM = 1 - 1e-6;
const REACH_BISECTIONS = 60;

/** The follow tuning (`feel.camera`); a structural type, so `shared` needs no content import. */
export interface FollowParams {
  readonly frameWidthM: number;
  readonly frameDepthM: number;
  readonly deadZoneWidthPct: number;
  readonly deadZoneHeightPct: number;
  readonly edgeMarginPct: number;
  readonly catchUpMs: number;
  readonly dampingRatio: number;
  readonly reducedCatchUpMs: number;
}

/** A floor-standing box (the room), as the client's `RoomSize`: centred on `(centerXM, centerZM)`, from `floorYM` up. */
export interface FollowBox {
  readonly widthM: number;
  readonly depthM: number;
  readonly heightM: number;
  readonly floorYM?: number;
  readonly centerXM?: number;
  readonly centerZM?: number;
}

/** The part of a level's geometry the camera box is taken from (a `LevelGeometry` fits). */
export interface RoomBounds {
  readonly boundsMinM: readonly [number, number, number];
  readonly boundsMaxM: readonly [number, number, number];
}

/** A `FollowBox` with every field set, as `roomOf` returns it (the client's `RoomSize` fits). */
export type RoomBox = Required<FollowBox>;

/**
 * The camera box of a level: its bounds, down to the lowest point below the floor (y = 0) if
 * something such as a stairwell goes there. The one definition for the client's camera and the
 * `human` bot's frame (story 9.8).
 */
export function roomOf(geometry: RoomBounds): RoomBox {
  const [minX, minY, minZ] = geometry.boundsMinM;
  const [maxX, maxY, maxZ] = geometry.boundsMaxM;
  const floorYM = Math.min(0, minY);
  return {
    widthM: maxX - minX,
    depthM: maxZ - minZ,
    heightM: maxY - floorYM,
    floorYM,
    centerXM: (minX + maxX) / 2,
    centerZM: (minZ + maxZ) / 2,
  };
}

/**
 * What the follow needs to know of the frame at an aspect: its half size in the view plane (zoom 1,
 * the same fit as `fitIsoCamera` on a `frameWidthM × frameDepthM` box of the room's height), the
 * room's view extent (its 8 corners projected, grown by `ISO_FIT_MARGIN_PCT` like the fixed camera's
 * breathing room) and the height of the point the camera looks at.
 */
export interface FollowFrame {
  halfWidthM: number;
  halfHeightM: number;
  minUM: number;
  maxUM: number;
  minVM: number;
  maxVM: number;
  /** The look-at point's height: the middle of the room box, as `fitIsoCamera` puts it. */
  lookYM: number;
}

/** The follow's state: its view centre and the centre's velocity, in the view plane. */
export interface FollowState {
  centreUM: number;
  centreVM: number;
  velocityUMps: number;
  velocityVMps: number;
  /** The sim time of the last step, or null before the first (the first step snaps). */
  lastAtMs: number | null;
  /** The damping ratio `reachTau` was computed for (a cache: retuned only when the feel moves). */
  reachDampingRatio: number;
  /** ω × the time to cover `FOLLOW_CATCH_UP_SHARE_PCT` of a jump, at `reachDampingRatio`. */
  reachTau: number;
}

export function createFollowFrame(): FollowFrame {
  return { halfWidthM: 1, halfHeightM: 1, minUM: 0, maxUM: 0, minVM: 0, maxVM: 0, lookYM: 0 };
}

export function createFollowState(): FollowState {
  return {
    centreUM: 0,
    centreVM: 0,
    velocityUMps: 0,
    velocityVMps: 0,
    lastAtMs: null,
    reachDampingRatio: Number.NaN,
    reachTau: 0,
  };
}

/** The `u` of a world point: along the iso camera's right. */
export function viewUM(xM: number, zM: number): number {
  return xM * COS_YAW - zM * SIN_YAW;
}

/** The `v` of a world point: along the iso camera's up. */
export function viewVM(xM: number, yM: number, zM: number): number {
  return -SIN_PITCH * (SIN_YAW * xM + COS_YAW * zM) + COS_PITCH * yM;
}

/** The world point at height `yM` that projects to `(uM, vM)`, written into `out`. */
export function worldOfView(
  uM: number,
  vM: number,
  yM: number,
  out: { xM: number; zM: number },
): void {
  // `w` is the point's depth along the floor projection of the view direction.
  const w = (COS_PITCH * yM - vM) / SIN_PITCH;
  out.xM = uM * COS_YAW + w * SIN_YAW;
  out.zM = -uM * SIN_YAW + w * COS_YAW;
}

/** Half the view-plane width of a box, before the fit's margin. */
const boxHalfUM = (widthM: number, depthM: number): number =>
  (widthM / 2) * Math.abs(COS_YAW) + (depthM / 2) * Math.abs(SIN_YAW);

/** Half the view-plane height of a box, before the fit's margin. */
const boxHalfVM = (widthM: number, depthM: number, heightM: number): number =>
  SIN_PITCH * ((widthM / 2) * Math.abs(SIN_YAW) + (depthM / 2) * Math.abs(COS_YAW)) +
  COS_PITCH * (heightM / 2);

/**
 * Fits `frame` for `room` at `aspect` (width / height): the half size `fitIsoCamera` would give a
 * `frameWidthM × frameDepthM` box of the room's height and floor (widened on one axis to the aspect),
 * and the room's own view extent. Allocates nothing.
 */
export function fitFollowFrame(
  frame: FollowFrame,
  room: FollowBox,
  frameWidthM: number,
  frameDepthM: number,
  aspect: number,
): void {
  let halfWidthM = boxHalfUM(frameWidthM, frameDepthM) * FIT_GROW;
  let halfHeightM = boxHalfVM(frameWidthM, frameDepthM, room.heightM) * FIT_GROW;
  if (halfWidthM / halfHeightM < aspect) halfWidthM = halfHeightM * aspect;
  else halfHeightM = halfWidthM / aspect;
  frame.halfWidthM = halfWidthM;
  frame.halfHeightM = halfHeightM;

  const centerXM = room.centerXM ?? 0;
  const centerZM = room.centerZM ?? 0;
  const lookYM = (room.floorYM ?? 0) + room.heightM / 2;
  const middleUM = viewUM(centerXM, centerZM);
  const middleVM = viewVM(centerXM, lookYM, centerZM);
  const roomHalfUM = boxHalfUM(room.widthM, room.depthM) * FIT_GROW;
  const roomHalfVM = boxHalfVM(room.widthM, room.depthM, room.heightM) * FIT_GROW;
  frame.minUM = middleUM - roomHalfUM;
  frame.maxUM = middleUM + roomHalfUM;
  frame.minVM = middleVM - roomHalfVM;
  frame.maxVM = middleVM + roomHalfVM;
  frame.lookYM = lookYM;
}

/**
 * Where a view centre may be on one axis so that a view of half size `halfM` stays inside
 * `[minM, maxM]`: clamped, or the middle when the view is wider than the extent.
 */
export function clampFollowAxis(
  centreM: number,
  halfM: number,
  minM: number,
  maxM: number,
): number {
  if (2 * halfM >= maxM - minM) return (minM + maxM) / 2;
  return Math.min(maxM - halfM, Math.max(minM + halfM, centreM));
}

/**
 * ω × the time a spring of damping ratio `zeta`, from rest, takes to cover `FOLLOW_CATCH_UP_SHARE_PCT`
 * of a jump of its goal. The error falls monotonically until the first crossing (critically damped:
 * forever; under-damped: until its first extremum at ω_d·t = π), so a bisection finds it.
 */
function reachTauOf(zeta: number): number {
  const left = 1 - FOLLOW_CATCH_UP_SHARE_PCT / 100;
  const isCritical = zeta >= CRITICAL_DAMPING_FROM;
  const dampedRate = isCritical ? 0 : Math.sqrt(1 - zeta * zeta);
  const errorAt = (tau: number): number =>
    isCritical
      ? (1 + tau) * Math.exp(-tau)
      : Math.exp(-zeta * tau) *
        (Math.cos(dampedRate * tau) + (zeta / dampedRate) * Math.sin(dampedRate * tau));
  let lo = 0;
  let hi = isCritical ? 50 : Math.PI / dampedRate;
  for (let i = 0; i < REACH_BISECTIONS; i++) {
    const mid = (lo + hi) / 2;
    if (errorAt(mid) > left) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// The spring's transition over one sub-step, `[e, v]' = M [e, v]` with `e` the distance to the goal
// and `v` in m/ms: the exact solution for a goal that holds still during the sub-step, so it is
// stable at any step and a critically damped one never overshoots. Shared by both axes.
let m00 = 1;
let m01 = 0;
let m10 = 0;
let m11 = 1;

function setTransition(hMs: number, omegaPerMs: number, zeta: number): void {
  if (zeta >= CRITICAL_DAMPING_FROM) {
    const decay = Math.exp(-omegaPerMs * hMs);
    m00 = (1 + omegaPerMs * hMs) * decay;
    m01 = hMs * decay;
    m10 = -omegaPerMs * omegaPerMs * hMs * decay;
    m11 = (1 - omegaPerMs * hMs) * decay;
    return;
  }
  const sigma = zeta * omegaPerMs;
  const dampedPerMs = omegaPerMs * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-sigma * hMs);
  const c = Math.cos(dampedPerMs * hMs);
  const s = Math.sin(dampedPerMs * hMs) / dampedPerMs;
  m00 = decay * (c + sigma * s);
  m01 = decay * s;
  m10 = -decay * omegaPerMs * omegaPerMs * s;
  m11 = decay * (c - sigma * s);
}

/** The nearest centre that keeps `aimM` inside a dead zone of half size `halfM` around it. */
function deadZoneGoal(centreM: number, aimM: number, halfM: number): number {
  if (aimM > centreM + halfM) return aimM - halfM;
  if (aimM < centreM - halfM) return aimM + halfM;
  return centreM;
}

/**
 * Keeps Papa's point at least the edge margin from the frame's edges, then the view inside the
 * room's extent. The walls win (Geo, review of 9.2): near a wall, or across a room narrower than the
 * frame, the margin gives way and Papa can come nearer the edge than `edgeMarginPct`, never off the
 * frame. A velocity that pushes against either limit is dropped.
 */
function constrain(
  state: FollowState,
  frame: Readonly<FollowFrame>,
  params: Readonly<FollowParams>,
  papaUM: number,
  papaVM: number,
): void {
  const keep = 1 - (2 * params.edgeMarginPct) / 100;
  const limitUM = frame.halfWidthM * keep;
  const limitVM = frame.halfHeightM * keep;
  if (papaUM - state.centreUM > limitUM) {
    state.centreUM = papaUM - limitUM;
    if (state.velocityUMps < 0) state.velocityUMps = 0;
  } else if (state.centreUM - papaUM > limitUM) {
    state.centreUM = papaUM + limitUM;
    if (state.velocityUMps > 0) state.velocityUMps = 0;
  }
  if (papaVM - state.centreVM > limitVM) {
    state.centreVM = papaVM - limitVM;
    if (state.velocityVMps < 0) state.velocityVMps = 0;
  } else if (state.centreVM - papaVM > limitVM) {
    state.centreVM = papaVM + limitVM;
    if (state.velocityVMps > 0) state.velocityVMps = 0;
  }
  // A view wider than the room on an axis stands still on its middle.
  if (2 * frame.halfWidthM >= frame.maxUM - frame.minUM) state.velocityUMps = 0;
  if (2 * frame.halfHeightM >= frame.maxVM - frame.minVM) state.velocityVMps = 0;
  const clampedUM = clampFollowAxis(state.centreUM, frame.halfWidthM, frame.minUM, frame.maxUM);
  if (clampedUM !== state.centreUM) {
    if (Math.sign(state.velocityUMps) === Math.sign(state.centreUM - clampedUM)) {
      state.velocityUMps = 0;
    }
    state.centreUM = clampedUM;
  }
  const clampedVM = clampFollowAxis(state.centreVM, frame.halfHeightM, frame.minVM, frame.maxVM);
  if (clampedVM !== state.centreVM) {
    if (Math.sign(state.velocityVMps) === Math.sign(state.centreVM - clampedVM)) {
      state.velocityVMps = 0;
    }
    state.centreVM = clampedVM;
  }
}

/**
 * Puts the view on `aimUM, aimVM` at once, at rest, then applies the edge margin and the room's
 * bounds. `stepFollow` passes the aim itself on a level's first frame and the dead zone's goal after
 * a long jump of the clock.
 */
export function snapFollow(
  state: FollowState,
  frame: Readonly<FollowFrame>,
  params: Readonly<FollowParams>,
  papaUM: number,
  papaVM: number,
  aimUM: number,
  aimVM: number,
  atMs: number,
): void {
  state.centreUM = aimUM;
  state.centreVM = aimVM;
  state.velocityUMps = 0;
  state.velocityVMps = 0;
  constrain(state, frame, params, papaUM, papaVM);
  state.lastAtMs = atMs;
}

/**
 * Re-applies the edge margin and the room's bounds without moving the clock (a resize: the frame
 * changed, the centre stays, no catch-up).
 */
export function settleFollow(
  state: FollowState,
  frame: Readonly<FollowFrame>,
  params: Readonly<FollowParams>,
  papaUM: number,
  papaVM: number,
): void {
  constrain(state, frame, params, papaUM, papaVM);
}

/**
 * Moves the view toward the aim (Papa, or the judged threat) up to the sim time `atMs`: the dead zone
 * around the centre, a spring sub-stepped at `STEP_MS` (ω from the catch-up time, `dampingRatio`;
 * `reducedCatchUpMs` and no overshoot at all under reduced motion), then Papa's edge margin and the
 * room's bounds. A clock that did not move does nothing. The first step snaps onto the aim; one after
 * more than `FOLLOW_SNAP_AFTER_MS` snaps onto the dead zone's goal (an aim inside it moves nothing).
 * Pure in its inputs; allocates nothing.
 */
export function stepFollow(
  state: FollowState,
  frame: Readonly<FollowFrame>,
  params: Readonly<FollowParams>,
  isReduced: boolean,
  papaUM: number,
  papaVM: number,
  aimUM: number,
  aimVM: number,
  atMs: number,
): void {
  if (state.lastAtMs === null) {
    snapFollow(state, frame, params, papaUM, papaVM, aimUM, aimVM, atMs);
    return;
  }
  const deadHalfUM = (frame.halfWidthM * params.deadZoneWidthPct) / 100;
  const deadHalfVM = (frame.halfHeightM * params.deadZoneHeightPct) / 100;
  const elapsedMs = atMs - state.lastAtMs;
  if (elapsedMs > FOLLOW_SNAP_AFTER_MS) {
    const goalUM = deadZoneGoal(state.centreUM, aimUM, deadHalfUM);
    const goalVM = deadZoneGoal(state.centreVM, aimVM, deadHalfVM);
    snapFollow(state, frame, params, papaUM, papaVM, goalUM, goalVM, atMs);
    return;
  }
  if (!(elapsedMs > 0)) return;
  state.lastAtMs = atMs;

  const zeta = isReduced ? 1 : params.dampingRatio;
  const catchUpMs = isReduced ? params.reducedCatchUpMs : params.catchUpMs;
  if (zeta !== state.reachDampingRatio) {
    state.reachTau = reachTauOf(zeta);
    state.reachDampingRatio = zeta;
  }
  const omegaPerMs = state.reachTau / catchUpMs;
  const subSteps = Math.ceil(elapsedMs / STEP_MS);
  setTransition(elapsedMs / subSteps, omegaPerMs, zeta);

  for (let i = 0; i < subSteps; i++) {
    const goalUM = deadZoneGoal(state.centreUM, aimUM, deadHalfUM);
    const goalVM = deadZoneGoal(state.centreVM, aimVM, deadHalfVM);
    const errorUM = state.centreUM - goalUM;
    const errorVM = state.centreVM - goalVM;
    const speedUMpms = state.velocityUMps / 1000;
    const speedVMpms = state.velocityVMps / 1000;
    state.centreUM = goalUM + m00 * errorUM + m01 * speedUMpms;
    state.centreVM = goalVM + m00 * errorVM + m01 * speedVMpms;
    state.velocityUMps = (m10 * errorUM + m11 * speedUMpms) * 1000;
    state.velocityVMps = (m10 * errorVM + m11 * speedVMpms) * 1000;
    constrain(state, frame, params, papaUM, papaVM);
  }
}
