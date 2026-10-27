// Art constants for the provisional « lift the baby » pose (Geo tunes them here until the real
// animation, E7), named with their units.
/** How high the baby hops, in metres. */
export const LIFT_HEIGHT_M = 0.35;
/** How long the hop lasts, up and down, in sim ms. */
export const LIFT_MS = 450;

/**
 * The baby's height above the floor, in metres, `elapsedMs` into the hop: a parabola that leaves
 * the floor at 0, peaks at `LIFT_HEIGHT_M` halfway and lands at `LIFT_MS`. Exactly 0 outside it.
 */
export function liftOffsetAt(elapsedMs: number): number {
  if (!(elapsedMs > 0 && elapsedMs < LIFT_MS)) return 0;
  const progress = elapsedMs / LIFT_MS;
  return 4 * LIFT_HEIGHT_M * progress * (1 - progress);
}

export interface LiftFx {
  /** Starts a hop at `startAt` (sim ms); a new one restarts it. */
  start(startAt: number): void;
  /** Sets the height for `clockMs` (sim ms). Writes only while a hop runs, and a last time when it ends. */
  update(clockMs: number): void;
  /** Puts the baby back on the floor at once. */
  reset(): void;
}

/** The hop of one level, on the sim clock. `setLiftM` is what it moves. Allocates nothing per frame. */
export function createLiftFx(setLiftM: (heightM: number) => void): LiftFx {
  let startAt: number | null = null;
  return {
    start(at) {
      startAt = at;
    },
    update(clockMs) {
      if (startAt === null) return;
      const elapsedMs = clockMs - startAt;
      setLiftM(liftOffsetAt(elapsedMs));
      if (elapsedMs >= LIFT_MS) startAt = null;
    },
    reset() {
      startAt = null;
      setLiftM(0);
    },
  };
}
