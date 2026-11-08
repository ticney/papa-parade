import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createForelockState, resetForelock, stepForelock } from './forelock.ts';

const REACH_MS = 200;
const DAMPING = 0.4;

const tipOf = (state: ReturnType<typeof createForelockState>): [number, number, number] => [
  state.x.drawn,
  state.y.drawn,
  state.z.drawn,
];

describe('the forelock pendulum (story 7.9, D7)', () => {
  it('starts and resets on its rest, with no swing', () => {
    const state = createForelockState();
    resetForelock(state, 1, 2, 3);
    expect(tipOf(state)).toEqual([1, 2, 3]);
    stepForelock(state, 1, 2, 3, 500, REACH_MS, DAMPING);
    expect(tipOf(state)).toEqual([1, 2, 3]);
  });

  it('trails a target that jumps, swings past it (damping under 1), then settles on it', () => {
    const state = createForelockState();
    resetForelock(state, 0, 0, 0);
    // A spring draws between its last two steps: two steps in, the tip has left its rest, not caught up.
    stepForelock(state, 1, 0, 0, 2 * STEP_MS, REACH_MS, DAMPING);
    expect(state.x.drawn).toBeGreaterThan(0);
    expect(state.x.drawn).toBeLessThan(0.5);
    let most = 0;
    // Damped at 0.4 it rings: three seconds leave it on the target.
    for (let i = 0; i < 300; i++) {
      stepForelock(state, 1, 0, 0, STEP_MS, REACH_MS, DAMPING);
      most = Math.max(most, state.x.drawn);
    }
    expect(most, 'a little bounce').toBeGreaterThan(1);
    expect(state.x.drawn).toBeCloseTo(1, 4);
    expect(state.y.drawn).toBe(0);
    expect(state.z.drawn).toBe(0);
  });

  it('gives the same tip whether the same span is drawn in 1, 3 or 7 frames', () => {
    const spanMs = 7 * STEP_MS;
    const tips = [1, 3, 7].map((frames) => {
      const state = createForelockState();
      resetForelock(state, 0, 0, 0);
      for (let i = 0; i < frames; i++) {
        stepForelock(state, 0.3, -0.2, 0.1, spanMs / frames, REACH_MS, DAMPING);
      }
      return tipOf(state);
    });
    for (const tip of tips.slice(1)) {
      for (let axis = 0; axis < 3; axis++) {
        expect(tip[axis]).toBeCloseTo(tips[0]?.[axis] ?? Number.NaN, 12);
      }
    }
  });

  it('holds on a dtMs of 0', () => {
    const state = createForelockState();
    resetForelock(state, 0, 0, 0);
    stepForelock(state, 1, 1, 1, 3 * STEP_MS, REACH_MS, DAMPING);
    const held = tipOf(state);
    stepForelock(state, 5, 5, 5, 0, REACH_MS, DAMPING);
    expect(tipOf(state)).toEqual(held);
  });
});
