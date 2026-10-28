import {
  PIXEL_RATIO_SLOW_FRAME_MS,
  PIXEL_RATIO_SLOW_WINDOWS,
  PIXEL_RATIO_STEPS,
  PIXEL_RATIO_WINDOW_MS,
} from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { type AdaptivePixelRatio, createAdaptivePixelRatio } from './adaptivePixelRatio.ts';

const FAST_MS = 16.7;
const SLOW_MS = PIXEL_RATIO_SLOW_FRAME_MS + 4;
/** Real time that closes `PIXEL_RATIO_SLOW_WINDOWS` windows of slow frames (a frame of slack). */
const SLOW_RUN_MS = PIXEL_RATIO_SLOW_WINDOWS * (PIXEL_RATIO_WINDOW_MS + SLOW_MS);

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

  it('steps 2 → 1.5 after slow windows in a row, 1.5 → 1 after as many more, then stays at 1', () => {
    const pacing = createAdaptivePixelRatio();
    // One slow window short of the run: still the first cap.
    expect(run(pacing, SLOW_MS, SLOW_RUN_MS / PIXEL_RATIO_SLOW_WINDOWS)).toBe(PIXEL_RATIO_STEPS[0]);
    expect(run(pacing, SLOW_MS, SLOW_RUN_MS / PIXEL_RATIO_SLOW_WINDOWS)).toBe(PIXEL_RATIO_STEPS[1]);
    expect(run(pacing, SLOW_MS, SLOW_RUN_MS)).toBe(PIXEL_RATIO_STEPS[2]);
    expect(run(pacing, SLOW_MS, SLOW_RUN_MS * 3)).toBe(PIXEL_RATIO_STEPS[2]);
  });

  it('one slow window among fast ones never steps (a hitch, a shader compile)', () => {
    const pacing = createAdaptivePixelRatio();
    // A 170 ms hitch in an otherwise perfect window: its mean goes over the limit once.
    run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS - 170);
    pacing.frame(170);
    const hitchWindowMeanMs = pacing.lastWindowMeanMs;
    run(pacing, FAST_MS, 60_000);
    expect(hitchWindowMeanMs).toBeGreaterThan(PIXEL_RATIO_SLOW_FRAME_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('a fast window between two slow ones breaks the run', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS + SLOW_MS);
    run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS + FAST_MS);
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS + SLOW_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('never steps back up, even when the frames get fast again', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, SLOW_MS, SLOW_RUN_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[1]);
    expect(run(pacing, FAST_MS, 60_000)).toBe(PIXEL_RATIO_STEPS[1]);
  });

  it('skips the caps that change nothing on a device (DPR 1.25: 2 and 1.5 read the same)', () => {
    const pacing = createAdaptivePixelRatio(1.25);
    run(pacing, SLOW_MS, SLOW_RUN_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[2]);
  });

  it('stays put when no lower cap changes anything (DPR 1)', () => {
    const pacing = createAdaptivePixelRatio(1);
    expect(run(pacing, SLOW_MS, SLOW_RUN_MS * 3)).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('treats a device pixel ratio that is not a positive number as 1', () => {
    const pacing = createAdaptivePixelRatio(Number.NaN);
    expect(run(pacing, SLOW_MS, SLOW_RUN_MS * 3)).toBe(PIXEL_RATIO_STEPS[0]);
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
    for (let i = 0; i < PIXEL_RATIO_SLOW_WINDOWS; i++) {
      run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS * 0.8);
      run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS * 0.2 + FAST_MS);
    }
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[1]);
    // ...and the next, fast windows do not inherit the slow past: no second step.
    expect(run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS * 4)).toBe(PIXEL_RATIO_STEPS[1]);
  });

  it('a fast window then a slow one: only the slow one counts', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS + FAST_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[0]);
    run(pacing, SLOW_MS, SLOW_RUN_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[1]);
  });

  it('resetWindow() forgets the slow windows of the run', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS + SLOW_MS);
    pacing.resetWindow();
    run(pacing, SLOW_MS, PIXEL_RATIO_WINDOW_MS + SLOW_MS);
    expect(pacing.cap).toBe(PIXEL_RATIO_STEPS[0]);
  });

  it('drops a stall as long as a window instead of calling it a slow frame', () => {
    const pacing = createAdaptivePixelRatio();
    run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS / 2);
    // The tab was throttled for 30 s: one frame of 30 s, then business as usual.
    expect(pacing.frame(30_000)).toBe(PIXEL_RATIO_STEPS[0]);
    expect(run(pacing, FAST_MS, PIXEL_RATIO_WINDOW_MS * 2)).toBe(PIXEL_RATIO_STEPS[0]);
  });
});
