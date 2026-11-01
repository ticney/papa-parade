import { STEP_MS } from '@shared/constants';

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
