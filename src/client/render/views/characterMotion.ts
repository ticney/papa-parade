import { ISO_YAW_DEG, STEP_MS } from '@shared/constants';

/** How far a travelling clip may be slowed or sped up: past this its feet read as a glitch, not a pace. */
const CLIP_TIME_SCALE_MIN = 0.3;
const CLIP_TIME_SCALE_MAX = 2.5;
const MS_PER_S = 1000;
const FULL_TURN_RAD = 2 * Math.PI;

/** One travelling clip's natural speed (`feedback.json › characters.clipSpeeds`). */
export interface TravelClip {
  readonly clip: string;
  readonly speedMps: number;
}
export type TravelClips = readonly TravelClip[];

/** Anything that moved between its last two steps: Papa and the baby both fit. */
export interface SteppedPoint {
  readonly xM: number;
  readonly zM: number;
  readonly prevXM: number;
  readonly prevZM: number;
}

/** How fast it went over its last step, in m/s: read from the world, so that a need or a stealth step shows. */
export function stepSpeedMpsOf(point: Readonly<SteppedPoint>): number {
  const dx = point.xM - point.prevXM;
  const dz = point.zM - point.prevZM;
  return (Math.sqrt(dx * dx + dz * dz) * MS_PER_S) / STEP_MS;
}

/** The pace of `clip` at `speedMps`: its own for a clip that does not travel or does not move, else in proportion. */
export function clipTimeScaleOf(clip: string, speedMps: number, clips: TravelClips): number {
  for (let i = 0; i < clips.length; i++) {
    const travel = clips[i] as TravelClip;
    if (travel.clip !== clip) continue;
    if (speedMps <= 0) return 1;
    const scale = speedMps / travel.speedMps;
    return Math.min(CLIP_TIME_SCALE_MAX, Math.max(CLIP_TIME_SCALE_MIN, scale));
  }
  return 1;
}

/** `angleRad` wrapped to the half turn around 0: the shortest arc. */
export function wrapAngleRad(angleRad: number): number {
  const wrapped = (angleRad + Math.PI) % FULL_TURN_RAD;
  return (wrapped < 0 ? wrapped + FULL_TURN_RAD : wrapped) - Math.PI;
}

/**
 * `fromRad` turned toward `toRad` by the shortest arc, by at most `turnRateDegPerSec` for `dtMs` of sim
 * time. A `dtMs` of 0 holds it, so a pause and a hitstop hold the turn too. Pure.
 */
export function turnToward(
  fromRad: number,
  toRad: number,
  turnRateDegPerSec: number,
  dtMs: number,
): number {
  const gapRad = wrapAngleRad(toRad - fromRad);
  const stepRad = (((turnRateDegPerSec * Math.PI) / 180) * dtMs) / MS_PER_S;
  if (Math.abs(gapRad) <= stepRad) return toRad;
  return fromRad + Math.sign(gapRad) * stepRad;
}

/** Where one of Papa's clips turns his body (`feedback.json › characters.papaClipFacing`). */
export interface ClipFacing {
  readonly clip: string;
  readonly facing: 'camera' | 'awayFromBaby';
}
export type ClipFacings = readonly ClipFacing[];

/** Papa and the baby closer than this, in metres, have no away: the angle between them is noise. */
const FACING_BABY_MIN_DISTANCE_M = 0.05;
const CAMERA_YAW_RAD = (ISO_YAW_DEG * Math.PI) / 180;

/**
 * The yaw Papa's drawn body turns to while `clip` plays, in radians (0 faces +z, positive toward +x), or
 * `null` for his heading (story 2.13, D5). `camera` faces the screen; `awayFromBaby` turns his back to the
 * baby, and gives way to his heading when there is no baby to turn from: carried in his arms, hiding
 * (a turn away from a hidden baby would point the player at him), or on top of him. Pure, allocates
 * nothing, and takes no threat: the pose says nothing the player does not see.
 */
export function papaFacingYawRad(
  papa: Readonly<{ xM: number; zM: number }>,
  baby: Readonly<{ xM: number; zM: number; state: string }>,
  clip: string | null,
  facings: ClipFacings,
): number | null {
  if (clip === null) return null;
  for (let i = 0; i < facings.length; i++) {
    const row = facings[i] as ClipFacing;
    if (row.clip !== clip) continue;
    if (row.facing === 'camera') return CAMERA_YAW_RAD;
    if (baby.state === 'carried' || baby.state === 'mischiefSilent') return null;
    const awayX = papa.xM - baby.xM;
    const awayZ = papa.zM - baby.zM;
    if (Math.hypot(awayX, awayZ) < FACING_BABY_MIN_DISTANCE_M) return null;
    return Math.atan2(awayX, awayZ);
  }
  return null;
}

/** One cycle of a side effect as a sine of its sim clock: a pause, a hitstop and a slow-mo move it as they move the sim. */
export function busyCycleAt(clockMs: number, periodMs: number): number {
  return Math.sin((2 * Math.PI * clockMs) / periodMs);
}
