// The end of a level that waits (story 7.4, D3): when `LevelScored` comes while the finale's celebration
// plays (or while Papa collapses on an early return, D14), `finish()`, the photo and the Result wait for
// it, for at most a cap of real time. The time is counted on the frame loop's clock with each frame's
// share capped, so a hidden tab (no frame) holds the wait instead of ending it on its return. Pure.

/** A frame counts for at most this much of the hold, in real ms: a tab that was hidden does not skip it. */
export const END_HOLD_FRAME_CAP_MS = 100;

export interface EndHold {
  /** Whether the end of the level is waiting. */
  readonly isPending: boolean;
  /** The real ms counted toward the cap since the wait began. */
  readonly heldMs: number;
  /**
   * At `LevelScored`: `'now'` when nothing holds the end (`isHolding` false, or a cap of 0), so the end
   * runs at once as before; otherwise `'held'` and the wait begins, for at most `maxHoldMs`.
   */
  request(isHolding: boolean, maxHoldMs: number): 'now' | 'held';
  /**
   * Once per frame at `frameAtReal`: true exactly once, on the frame the end must run (nothing holds it
   * any more, or the cap is reached); the wait is then over.
   */
  frame(frameAtReal: number, isHolding: boolean): boolean;
  /** Drops a wait (restart, loading, error): the end it held will not run. */
  clear(): void;
}

export function createEndHold(): EndHold {
  let isPending = false;
  let heldMs = 0;
  let capMs = 0;
  let lastFrameAtReal: number | null = null;
  return {
    get isPending() {
      return isPending;
    },
    get heldMs() {
      return heldMs;
    },
    request(isHolding, maxHoldMs) {
      if (!isHolding || !(maxHoldMs > 0)) return 'now';
      isPending = true;
      heldMs = 0;
      capMs = maxHoldMs;
      lastFrameAtReal = null;
      return 'held';
    },
    frame(frameAtReal, isHolding) {
      if (!isPending) return false;
      if (lastFrameAtReal !== null && Number.isFinite(frameAtReal)) {
        const stepMs = Math.max(0, frameAtReal - lastFrameAtReal);
        heldMs += Math.min(stepMs, END_HOLD_FRAME_CAP_MS);
      }
      if (Number.isFinite(frameAtReal)) lastFrameAtReal = frameAtReal;
      if (isHolding && heldMs < capMs) return false;
      isPending = false;
      lastFrameAtReal = null;
      return true;
    },
    clear() {
      isPending = false;
      heldMs = 0;
      capMs = 0;
      lastFrameAtReal = null;
    },
  };
}
