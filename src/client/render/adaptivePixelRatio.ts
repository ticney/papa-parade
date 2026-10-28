import {
  PIXEL_RATIO_SLOW_FRAME_MS,
  PIXEL_RATIO_STEPS,
  PIXEL_RATIO_WINDOW_MS,
} from '@shared/constants';

export interface AdaptivePixelRatio {
  /** One level frame took `intervalMs` of real time since the previous one; returns the cap to use now. */
  frame(intervalMs: number): number;
  /** Starts a new window: a level start, a resume after a pause. */
  resetWindow(): void;
  /** The cap in force. */
  readonly cap: number;
  /** The mean frame interval of the last window that closed, ms (0 before the first): what a step-down is logged with. */
  readonly lastWindowMeanMs: number;
}

/**
 * The renderer's pixel-ratio cap, which only goes down (story 1.24 D8; architecture › Performance:
 * 2 → 1.5 → 1 when the mean frame time is above `PIXEL_RATIO_SLOW_FRAME_MS` for `PIXEL_RATIO_WINDOW_MS`).
 *
 * Frame intervals are summed over consecutive windows of `PIXEL_RATIO_WINDOW_MS` of real time. When
 * a window closes, its mean interval (this window's, not a moving average) above the slow limit
 * steps the cap down one `PIXEL_RATIO_STEPS` entry and a new window starts. It never steps back
 * up: a phone that is merely warm must not make the picture oscillate. Pure: no clock, no DOM.
 *
 * An interval as long as a whole window is a stall (a throttled tab, a debugger), not a slow
 * frame: it is dropped with the window it would have closed.
 */
export function createAdaptivePixelRatio(): AdaptivePixelRatio {
  let stepIndex = 0;
  let windowSumMs = 0;
  let windowFrames = 0;
  let lastWindowMeanMs = 0;

  return {
    get cap() {
      return PIXEL_RATIO_STEPS[stepIndex] as number;
    },
    get lastWindowMeanMs() {
      return lastWindowMeanMs;
    },
    frame(intervalMs) {
      if (intervalMs >= PIXEL_RATIO_WINDOW_MS) {
        windowSumMs = 0;
        windowFrames = 0;
        return PIXEL_RATIO_STEPS[stepIndex] as number;
      }
      windowSumMs += intervalMs;
      windowFrames++;
      if (windowSumMs >= PIXEL_RATIO_WINDOW_MS) {
        lastWindowMeanMs = windowSumMs / windowFrames;
        if (lastWindowMeanMs > PIXEL_RATIO_SLOW_FRAME_MS) {
          stepIndex = Math.min(stepIndex + 1, PIXEL_RATIO_STEPS.length - 1);
        }
        windowSumMs = 0;
        windowFrames = 0;
      }
      return PIXEL_RATIO_STEPS[stepIndex] as number;
    },
    resetWindow() {
      windowSumMs = 0;
      windowFrames = 0;
    },
  };
}
