import { describe, expect, it } from 'vitest';
import { remainingPathLengthM } from './pathLength.ts';

const walker = (xM: number, zM: number, path: number[], pathIndex = 0) => ({
  xM,
  zM,
  headingX: 0,
  headingZ: 1,
  path,
  pathIndex,
});

describe('remainingPathLengthM', () => {
  it('is 0 with no path', () => {
    expect(remainingPathLengthM(walker(1, 1, []))).toBe(0);
  });

  it('sums the segments from where the walker stands through every waypoint', () => {
    expect(remainingPathLengthM(walker(0, 0, [3, 0, 3, 4]))).toBe(7);
  });

  it('starts at pathIndex: waypoints already walked do not count', () => {
    expect(remainingPathLengthM(walker(3, 0, [3, 0, 3, 4], 1))).toBe(4);
  });

  it('is 0 once every waypoint has been reached', () => {
    expect(remainingPathLengthM(walker(3, 4, [3, 0, 3, 4], 2))).toBe(0);
  });
});
