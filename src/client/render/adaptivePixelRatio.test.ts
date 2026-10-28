import {
  PIXEL_RATIO_SLOW_FRAME_MS,
  PIXEL_RATIO_STEPS,
  PIXEL_RATIO_WINDOW_MS,
} from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { type AdaptivePixelRatio, createAdaptivePixelRatio } from './adaptivePixelRatio.ts';

const FAST_MS = 16.7;
const SLOW_MS = PIXEL_RATIO_SLOW_FRAME_MS + 4;

/** Feeds frames of `intervalMs` until `forMs` of real time has passed; returns the last cap. */
function run(pacing: AdaptivePixelRatio, intervalMs: number, forMs: number): number {
  let cap = pacing.cap;
  for (let elapsedMs = 0; elapsedMs < forMs; elapsedMs += intervalMs)
    cap = pacing.frame(intervalMs);
  return cap;
}

describe('createAdaptivePixelRatio', () => {
  it('starts at the first cap', () => {
    expect(createAdaptivePixelRatio().cap).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('tells the mean of the window that just closed', () => {
    const pacing = createAdaptivePixelRatio();
    expect(pacing.lastWindowMeanMs).toBe(0);
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS + SLOW_MS);
    expect(pacing.lastWindowMeanMs).toBeCloseTo(SLOW_MS, 6);
  });

  it('never steps on fast frames, however long they last', () => {
    const pacing = createAdaptivePixelRatio();
    expect(run(pacing, FAST_MS, 60_000)).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('does not step at exactly the slow limit (it must be above it)', () => {
    const pacing = createAdaptivePixelRatio();
    expect(run(pacing, PIXEL_RATIO_SLOW_FRAME_MS, 20_000)).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('steps 2 → 1.5 after a slow window, 1.5 → 1 after a second one, then stays at 1', () => {
    const pacing = createAdaptivePixelRatio();
    // Just short of the window: still the first cap.
    expect(run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS - 2 * SLOW_MS)).toBe(PIXEL_RATIO_STEPS[0]);
    expect(run(pacing, SLOW_MS, 2 * SLOW_MS)).toBe(PIXEL_RATIO_STEPS[1]);
    expect(run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS)).toBe(PIXEL_RATIO_STEPS[2]);
    expect(run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS * 3)).toBe(PIXEL_RATIO_STEPS[2]);
  });

  it('never steps back up, even when the frames get fast again', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS + SLOW_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[1]);
    expect(run(pacing, FAST_MS, 60_000)).toBe(PIXEL_RATIO_STEPS[1]);
  });

  it('a slow half-window followed by resetWindow() does not step', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS / 2);
    pacing.resetWindow();
    // Another slow half-window: with the reset, neither is a whole window.
    expect(run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS / 2)).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('judges each window on its own mean, not on a moving average', () => {
    const pacing = createAdaptivePixelRatio();
    // A mostly slow window (80 % at 22 ms, then fast): its mean is about 20.5 ms, above the limit...
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS * 0.8);
    run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS * 0.2 + FAST_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[1]);
    // ...and the next, fast window does not inherit the slow past: no second step.
    expect(run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS * 4)).toBe(PIXEL_RATIO_STEPS[1]);
  });

  it('a fast window then a slow one: only the slow one counts', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS + FAST_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[0]);
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS + SLOW_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[1]);
  });

  it('drops a stall as long as a window instead of calling it a slow frame', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS / 2);
    // The tab was throttled for 30 s: one frame of 30 s, then business as usual.
    expect(pacing.frame(30_000)).toBe(PIXEL_RATIO_STEPS[0]);
    expect(run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS * 2)).toBe(PIXEL_RATIO_STEPS[0]);
  });
});
