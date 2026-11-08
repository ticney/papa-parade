import { createSpring, resetSpring, type Spring, stepSpring } from './characterSpring.ts';

// Papa's forelock (story 7.9, D7): a pendulum on his head. Its tip is a point in the room's metres that
// chases where it would be if the lock were rigid, through three springs of the life layer (x, y, z),
// stepped at `STEP_MS` on the sim clock: whatever moves his head (a clip, the lean, the gaze, the
// walk, a glide, the squash) leaves it behind for a moment. Pure, no Three; nothing allocated once made.

/** The tip's three springs, in the room's metres (the scene Papa stands in: a screen shake moves neither). */
export interface ForelockState {
  readonly x: Spring;
  readonly y: Spring;
  readonly z: Spring;
}

export function createForelockState(): ForelockState {
  return { x: createSpring(0), y: createSpring(0), z: createSpring(0) };
}

/** Puts the tip at rest on `(x, y, z)`, with no swing (a first frame, a restart, a return). */
export function resetForelock(state: ForelockState, x: number, y: number, z: number): void {
  resetSpring(state.x, x);
  resetSpring(state.y, y);
  resetSpring(state.z, z);
}

/**
 * Moves the tip toward where a rigid lock would hold it, `(restX, restY, restZ)`, by `dtMs` of sim
 * time (0 holds it). `reachMs` and `dampingRatio` are `feel.json › characters.forelock`'s; no overshoot
 * cap: the swing is the point. The tip drawn now is each spring's `drawn`. Allocates nothing.
 */
export function stepForelock(
  state: ForelockState,
  restX: number,
  restY: number,
  restZ: number,
  dtMs: number,
  reachMs: number,
  dampingRatio: number,
): void {
  stepSpring(state.x, restX, dtMs, reachMs, dampingRatio, Number.POSITIVE_INFINITY);
  stepSpring(state.y, restY, dtMs, reachMs, dampingRatio, Number.POSITIVE_INFINITY);
  stepSpring(state.z, restZ, dtMs, reachMs, dampingRatio, Number.POSITIVE_INFINITY);
}
