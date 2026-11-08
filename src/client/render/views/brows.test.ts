import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  type BrowPose,
  createBrowState,
  REST_BROW_POSE,
  resetBrows,
  stepBrows,
  unplaceBrows,
} from './brows.ts';

const FROWN: BrowPose = {
  raiseOffsetM: -0.012,
  tiltDeg: -28,
  inwardOffsetM: 0.008,
  skewOffsetM: 0.01,
};
const REACH_MS = 100;

/** Brows placed at rest, then stepped toward `pose` over `spanMs` in `frames` equal frames. */
function drawnAfter(pose: BrowPose, spanMs: number, frames: number): BrowPose {
  const state = createBrowState();
  stepBrows(state, REST_BROW_POSE, 0, REACH_MS);
  for (let i = 0; i < frames; i++) stepBrows(state, pose, spanMs / frames, REACH_MS);
  return { ...state.drawn };
}

describe('the brows blend (story 7.10, D9)', () => {
  it('the first step snaps on its pose, with no blend', () => {
    const state = createBrowState();
    stepBrows(state, FROWN, 16, REACH_MS);
    expect(state.drawn).toEqual(FROWN);
  });

  it('a held pose settles on it, with no overshoot', () => {
    const state = createBrowState();
    stepBrows(state, REST_BROW_POSE, 0, REACH_MS);
    let lowestTiltDeg = 0;
    for (let i = 0; i < 100; i++) {
      stepBrows(state, FROWN, 10, REACH_MS);
      lowestTiltDeg = Math.min(lowestTiltDeg, state.drawn.tiltDeg);
    }
    expect(state.drawn.tiltDeg).toBeCloseTo(FROWN.tiltDeg, 6);
    expect(state.drawn.raiseOffsetM).toBeCloseTo(FROWN.raiseOffsetM, 9);
    expect(state.drawn.inwardOffsetM).toBeCloseTo(FROWN.inwardOffsetM, 9);
    expect(state.drawn.skewOffsetM).toBeCloseTo(FROWN.skewOffsetM, 9);
    expect(lowestTiltDeg).toBeGreaterThanOrEqual(FROWN.tiltDeg - 1e-9);
  });

  it('covers 95 % of the way in reachMs', () => {
    // The spring reaches 95 % at `reachMs`; it is drawn between its last two steps, so one step behind.
    const drawn = drawnAfter(FROWN, REACH_MS + STEP_MS, 11);
    expect(drawn.tiltDeg / FROWN.tiltDeg).toBeCloseTo(0.95, 6);
    expect(drawnAfter(FROWN, REACH_MS - STEP_MS, 9).tiltDeg / FROWN.tiltDeg).toBeLessThan(0.95);
  });

  it('1, 3 or 7 frames over the same span give the same pose', () => {
    const one = drawnAfter(FROWN, 70, 1);
    for (const frames of [3, 7]) {
      const many = drawnAfter(FROWN, 70, frames);
      expect(many.tiltDeg).toBeCloseTo(one.tiltDeg, 9);
      expect(many.raiseOffsetM).toBeCloseTo(one.raiseOffsetM, 12);
      expect(many.inwardOffsetM).toBeCloseTo(one.inwardOffsetM, 12);
      expect(many.skewOffsetM).toBeCloseTo(one.skewOffsetM, 12);
    }
  });

  it('a dtMs of 0 holds them', () => {
    const state = createBrowState();
    stepBrows(state, REST_BROW_POSE, 0, REACH_MS);
    stepBrows(state, FROWN, 35, REACH_MS);
    const before = { ...state.drawn };
    stepBrows(state, REST_BROW_POSE, 0, REACH_MS);
    expect(state.drawn).toEqual(before);
  });

  it('resetBrows jumps; unplaceBrows rests now and snaps on the next pose', () => {
    const state = createBrowState();
    resetBrows(state, FROWN);
    expect(state.drawn).toEqual(FROWN);
    unplaceBrows(state);
    expect(state.drawn).toEqual(REST_BROW_POSE);
    stepBrows(state, FROWN, 10, REACH_MS);
    expect(state.drawn).toEqual(FROWN);
  });
});
