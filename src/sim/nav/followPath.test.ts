import { describe, expect, it } from 'vitest';
import { advanceAlongPath, type PathFollower } from './followPath.ts';

function followerAt(xM: number, zM: number, patch: Partial<PathFollower> = {}): PathFollower {
  return { xM, zM, headingX: 0, headingZ: 1, path: [], pathIndex: 0, ...patch };
}

describe('advanceAlongPath', () => {
  it('moves by the budget along the segment and turns toward it', () => {
    const walker = followerAt(0, 0, { path: [3, 4] });
    expect(advanceAlongPath(walker, 1)).toBe(false);
    expect(walker.xM).toBeCloseTo(0.6, 12);
    expect(walker.zM).toBeCloseTo(0.8, 12);
    expect([walker.headingX, walker.headingZ]).toEqual([0.6, 0.8]);
    expect(walker.pathIndex).toBe(0);
  });

  it('snaps to the last waypoint and reports the arrival, whatever is left of the budget', () => {
    const walker = followerAt(0, 0, { path: [1, 0] });
    expect(advanceAlongPath(walker, 5)).toBe(true);
    expect([walker.xM, walker.zM, walker.pathIndex]).toEqual([1, 0, 1]);
  });

  it('crosses several waypoints in one step and keeps the heading of the last segment', () => {
    const walker = followerAt(0, 0, { path: [1, 0, 1, 1, 1, 3] });
    expect(advanceAlongPath(walker, 2.5)).toBe(false);
    expect(walker.pathIndex).toBe(2);
    expect(walker.xM).toBe(1);
    expect(walker.zM).toBeCloseTo(1.5, 12);
    expect([walker.headingX, walker.headingZ]).toEqual([0, 1]);
  });

  it('arrives exactly when the budget is exactly the distance', () => {
    const walker = followerAt(0, 0, { path: [0.5, 0] });
    expect(advanceAlongPath(walker, 0.5)).toBe(true);
    expect(walker.xM).toBe(0.5);
  });

  it('leaves the heading alone on a zero-length segment', () => {
    const walker = followerAt(2, 2, { path: [2, 2], headingX: 1, headingZ: 0 });
    expect(advanceAlongPath(walker, 0.03)).toBe(true);
    expect([walker.headingX, walker.headingZ]).toEqual([1, 0]);
  });

  it('does nothing with an empty path, and reports that there is nothing left to walk', () => {
    const walker = followerAt(1, 1);
    expect(advanceAlongPath(walker, 1)).toBe(true);
    expect([walker.xM, walker.zM]).toEqual([1, 1]);
  });

  it('is the same walk whatever the budget is cut into', () => {
    const whole = followerAt(0, 0, { path: [1, 0, 1, 2] });
    advanceAlongPath(whole, 2);
    const cut = followerAt(0, 0, { path: [1, 0, 1, 2] });
    for (let i = 0; i < 4; i++) advanceAlongPath(cut, 0.5);
    expect(cut.xM).toBeCloseTo(whole.xM, 12);
    expect(cut.zM).toBeCloseTo(whole.zM, 12);
  });
});
