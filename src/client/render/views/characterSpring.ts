import { STEP_MS } from '@shared/constants';
import { wrapAngleRad } from './characterMotion.ts';

// The springs of the life layer (story 7.8, D5, D12): the body's turn, the lean, the gaze. The maths are
// the follow camera's (`shared/followCamera.ts`: ω from a reach time, the exact transition over one
// step), kept here because the characters need nothing of `shared` for them. Each spring steps at exactly
// `STEP_MS` with an accumulator on the sim clock, so the same span gives the same value however the
// frames split it, and draws the value between its last two steps by the time left over (no stutter
// at 60 Hz). Pure, no Three, nothing allocated once made.

/** At or above this damping ratio the spring is solved as critically damped (no division by ~0). */
const CRITICAL_DAMPING_FROM = 1 - 1e-6;
/** The share of a jump of its target that the spring covers in its reach time, in %: the camera's. */
const REACH_SHARE_PCT = 95;
const REACH_BISECTIONS = 60;
/** A spring further than this from its target in its own units, at rest, is put on it (no endless creep). */
const SETTLED_EPSILON = 1e-7;
const FULL_TURN_RAD = 2 * Math.PI;
/** An angle spring is brought back near 0 past this many turns, so that it never loses precision. */
const ANGLE_REWRAP_RAD = 4 * Math.PI;

/** One spring's state. Made once (`createSpring`); every field is written by `stepSpring`. */
export interface Spring {
  /** The value at the last step. */
  value: number;
  /** The value at the step before: drawn between the two by the leftover time. */
  prevValue: number;
  /** Its speed at the last step, in units per sim ms. */
  velocityPerMs: number;
  /** Sim time not stepped yet, in ms: always below `STEP_MS`. */
  leftoverMs: number;
  /** What it is drawn at now: `prevValue` to `value` by `leftoverMs / STEP_MS`. */
  drawn: number;
  /** It crossed its target and has not turned back yet: the excess is capped (D5). */
  isPast: boolean;
  /** The target of the last call. */
  target: number;
  /** The damping and reach the cached ω and transition were made for. */
  zeta: number;
  reachMs: number;
  tau: number;
  m00: number;
  m01: number;
  m10: number;
  m11: number;
}

export function createSpring(value = 0): Spring {
  return {
    value,
    prevValue: value,
    velocityPerMs: 0,
    leftoverMs: 0,
    drawn: value,
    isPast: false,
    target: value,
    zeta: Number.NaN,
    reachMs: Number.NaN,
    tau: 0,
    m00: 1,
    m01: 0,
    m10: 0,
    m11: 1,
  };
}

/** Puts the spring at rest on `value` (a restart, a first frame). */
export function resetSpring(spring: Spring, value: number): void {
  spring.value = value;
  spring.prevValue = value;
  spring.velocityPerMs = 0;
  spring.leftoverMs = 0;
  spring.drawn = value;
  spring.isPast = false;
  spring.target = value;
}

/**
 * ω × the time a spring of damping ratio `zeta`, from rest, takes to cover `REACH_SHARE_PCT` of a jump
 * of its target. The error falls monotonically until the first crossing, so a bisection finds it.
 */
export function reachTauOf(zeta: number): number {
  const left = 1 - REACH_SHARE_PCT / 100;
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

/** ω, in rad per sim ms, of a spring of damping `zeta` that covers 95 % of a jump in `reachMs`. */
export function omegaOf(reachMs: number, zeta: number): number {
  return reachTauOf(zeta) / Math.max(1, reachMs);
}

/** Recomputes the cached transition over one `STEP_MS` when the tuning moved (a feel change). */
function tune(spring: Spring, reachMs: number, zeta: number): void {
  if (zeta === spring.zeta && reachMs === spring.reachMs) return;
  if (zeta !== spring.zeta) spring.tau = reachTauOf(zeta);
  spring.zeta = zeta;
  spring.reachMs = reachMs;
  const omega = spring.tau / Math.max(1, reachMs);
  const h = STEP_MS;
  if (zeta >= CRITICAL_DAMPING_FROM) {
    const decay = Math.exp(-omega * h);
    spring.m00 = (1 + omega * h) * decay;
    spring.m01 = h * decay;
    spring.m10 = -omega * omega * h * decay;
    spring.m11 = (1 - omega * h) * decay;
    return;
  }
  const sigma = zeta * omega;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  const decay = Math.exp(-sigma * h);
  const c = Math.cos(damped * h);
  const s = Math.sin(damped * h) / damped;
  spring.m00 = decay * (c + sigma * s);
  spring.m01 = decay * s;
  spring.m10 = -decay * omega * omega * s;
  spring.m11 = decay * (c - sigma * s);
}

/**
 * Moves the spring toward `target` by `dtMs` of sim time (0 holds it), in whole `STEP_MS` steps, and
 * returns the value drawn now. `reachMs` and `zeta` as `omegaOf`; past its target, it swings at most
 * `overshootMax` beyond it (in its own units; `Infinity` for no cap), then comes back. A target that
 * jumps by more than the cap ends the swing first, so that the cap never pulls it. Allocates nothing.
 */
export function stepSpring(
  spring: Spring,
  target: number,
  dtMs: number,
  reachMs: number,
  zeta: number,
  overshootMax: number,
): number {
  if (!(dtMs > 0)) return spring.drawn;
  tune(spring, reachMs, zeta);
  if (Math.abs(target - spring.target) > overshootMax) spring.isPast = false;
  spring.target = target;
  spring.leftoverMs += dtMs;
  while (spring.leftoverMs >= STEP_MS) {
    spring.leftoverMs -= STEP_MS;
    const error = spring.value - target;
    const velocity = spring.velocityPerMs;
    let next = target + spring.m00 * error + spring.m01 * velocity;
    let nextVelocity = spring.m10 * error + spring.m11 * velocity;
    let nextError = next - target;
    // A crossing inside a step, where the target holds still: the swing past it starts.
    if (error !== 0 && Math.sign(nextError) === -Math.sign(error)) spring.isPast = true;
    if (spring.isPast) {
      if (nextVelocity * nextError <= 0) {
        // It turned back toward the target: the swing is over.
        spring.isPast = false;
      } else if (Math.abs(nextError) > overshootMax) {
        next = target + Math.sign(nextError) * overshootMax;
        nextVelocity = 0;
        nextError = next - target;
        spring.isPast = false;
      }
    }
    if (Math.abs(nextError) < SETTLED_EPSILON && Math.abs(nextVelocity) < SETTLED_EPSILON) {
      next = target;
      nextVelocity = 0;
    }
    spring.prevValue = spring.value;
    spring.value = next;
    spring.velocityPerMs = nextVelocity;
  }
  spring.drawn =
    spring.prevValue + (spring.value - spring.prevValue) * (spring.leftoverMs / STEP_MS);
  return spring.drawn;
}

/**
 * `stepSpring` for an angle in radians: the target is taken on the shortest arc from where the spring
 * stands (a turn from 170° to -170° goes through 180°, not back through 0), and the spring is brought
 * back near 0 now and then. The drawn angle is not wrapped. Allocates nothing.
 */
export function stepAngleSpring(
  spring: Spring,
  targetRad: number,
  dtMs: number,
  reachMs: number,
  zeta: number,
  overshootMaxRad: number,
): number {
  if (!(dtMs > 0)) return spring.drawn;
  if (Math.abs(spring.value) > ANGLE_REWRAP_RAD) {
    const turns = Math.round(spring.value / FULL_TURN_RAD) * FULL_TURN_RAD;
    spring.value -= turns;
    spring.prevValue -= turns;
    spring.drawn -= turns;
    spring.target -= turns;
  }
  const unwrapped = spring.value + wrapAngleRad(targetRad - spring.value);
  return stepSpring(spring, unwrapped, dtMs, reachMs, zeta, overshootMaxRad);
}
