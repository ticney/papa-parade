import { describe, expect, it } from 'vitest';
import { clipTimeScaleOf, stepSpeedMpsOf, turnToward, wrapAngleRad } from './characterMotion.ts';

const CLIPS = [{ clip: 'walk', speedMps: 3 }];

describe('stepSpeedMpsOf', () => {
  it('reads the last 10 ms step', () => {
    expect(stepSpeedMpsOf({ prevXM: 0, prevZM: 0, xM: 0.03, zM: 0.04 })).toBeCloseTo(5, 10);
    expect(stepSpeedMpsOf({ prevXM: 1, prevZM: 1, xM: 1, zM: 1 })).toBe(0);
  });
});

describe('clipTimeScaleOf', () => {
  it('is 1 for a clip that does not travel, and for one that stands still', () => {
    expect(clipTimeScaleOf('idle', 3, CLIPS)).toBe(1);
    expect(clipTimeScaleOf('walk', 0, CLIPS)).toBe(1);
  });

  it('goes in proportion to the floor speed, within its bounds', () => {
    expect(clipTimeScaleOf('walk', 3, CLIPS)).toBe(1);
    expect(clipTimeScaleOf('walk', 1.5, CLIPS)).toBe(0.5);
    expect(clipTimeScaleOf('walk', 0.01, CLIPS)).toBe(0.3);
    expect(clipTimeScaleOf('walk', 90, CLIPS)).toBe(2.5);
  });
});

describe('wrapAngleRad', () => {
  it('wraps to the half turn around 0', () => {
    expect(wrapAngleRad(0)).toBeCloseTo(0, 12);
    expect(wrapAngleRad(1.5 * Math.PI)).toBeCloseTo(-0.5 * Math.PI, 12);
    expect(wrapAngleRad(-1.5 * Math.PI)).toBeCloseTo(0.5 * Math.PI, 12);
  });
});

describe('turnToward', () => {
  it('goes by at most the rate, and lands exactly', () => {
    expect(turnToward(0, 1, 180, 100)).toBeCloseTo(Math.PI / 10, 12);
    expect(turnToward(0, 0.1, 180, 1000)).toBe(0.1);
  });

  it('holds on a dt of 0', () => {
    expect(turnToward(0.3, 2, 180, 0)).toBe(0.3);
  });

  it('takes the shortest arc across the half turn', () => {
    const from = 3;
    const to = -3;
    expect(turnToward(from, to, 180, 10)).toBeGreaterThan(from);
  });
});
