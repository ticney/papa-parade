import { createSpring, resetSpring, type Spring, stepSpring } from './characterSpring.ts';

// The brows' blend (story 7.10, D9): the drawn pose as four springs of the sim clock, critically damped
// (no overshoot, so nothing to take away under reduced motion), stepped at `STEP_MS` by `characterSpring.ts`
// so that the same span gives the same brows however the frames split it. Pure, no Three: the views turn
// the drawn pose into the two bones (D2).

/** A brow pose (`feel.json › characters.expressions.<who>.poses.<expression>`, D2), added to the rest. */
export interface BrowPose {
  /** Both brows up (+) or down, in metres along the head. */
  raiseOffsetM: number;
  /** Positive lifts the inner ends, toward the nose; negative lowers them (a frown). */
  tiltDeg: number;
  /** Both brows toward the nose, in metres. */
  inwardOffsetM: number;
  /** Positive raises his left brow (`brow_l`) and lowers his right by as much, in metres. */
  skewOffsetM: number;
}

/** The rest: `neutral` (all four at 0). */
export const REST_BROW_POSE: Readonly<BrowPose> = Object.freeze({
  raiseOffsetM: 0,
  tiltDeg: 0,
  inwardOffsetM: 0,
  skewOffsetM: 0,
});

/** One character's brows: the four springs, the pose drawn now, and whether they have been put on a pose yet. */
export interface BrowState {
  readonly raise: Spring;
  readonly tilt: Spring;
  readonly inward: Spring;
  readonly skew: Spring;
  /** The pose drawn now. */
  readonly drawn: BrowPose;
  /** False until the first step (made, or `unplaceBrows`): that step snaps on its pose, with no blend. */
  isPlaced: boolean;
}

export function createBrowState(): BrowState {
  return {
    raise: createSpring(0),
    tilt: createSpring(0),
    inward: createSpring(0),
    skew: createSpring(0),
    drawn: { raiseOffsetM: 0, tiltDeg: 0, inwardOffsetM: 0, skewOffsetM: 0 },
    isPlaced: false,
  };
}

/** Puts the brows on `pose` at once, at rest (no speed). */
export function resetBrows(state: BrowState, pose: Readonly<BrowPose>): void {
  resetSpring(state.raise, pose.raiseOffsetM);
  resetSpring(state.tilt, pose.tiltDeg);
  resetSpring(state.inward, pose.inwardOffsetM);
  resetSpring(state.skew, pose.skewOffsetM);
  state.drawn.raiseOffsetM = pose.raiseOffsetM;
  state.drawn.tiltDeg = pose.tiltDeg;
  state.drawn.inwardOffsetM = pose.inwardOffsetM;
  state.drawn.skewOffsetM = pose.skewOffsetM;
  state.isPlaced = true;
}

/** A restart (D9): the brows at rest now, and the next step snaps on whatever pose it is given. */
export function unplaceBrows(state: BrowState): void {
  resetBrows(state, REST_BROW_POSE);
  state.isPlaced = false;
}

/**
 * Moves the brows toward `pose` by `dtMs` of sim time, covering 95 % of a jump in `reachMs` (no overshoot);
 * a `dtMs` of 0 holds them. The first step after `createBrowState` or `unplaceBrows` snaps on `pose`.
 * Writes `state.drawn`. Allocates nothing.
 */
export function stepBrows(
  state: BrowState,
  pose: Readonly<BrowPose>,
  dtMs: number,
  reachMs: number,
): void {
  if (!state.isPlaced) {
    resetBrows(state, pose);
    return;
  }
  const { drawn } = state;
  const free = Number.POSITIVE_INFINITY;
  drawn.raiseOffsetM = stepSpring(state.raise, pose.raiseOffsetM, dtMs, reachMs, 1, free);
  drawn.tiltDeg = stepSpring(state.tilt, pose.tiltDeg, dtMs, reachMs, 1, free);
  drawn.inwardOffsetM = stepSpring(state.inward, pose.inwardOffsetM, dtMs, reachMs, 1, free);
  drawn.skewOffsetM = stepSpring(state.skew, pose.skewOffsetM, dtMs, reachMs, 1, free);
}
