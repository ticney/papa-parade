import { describe, expect, it } from 'vitest';
import { interpolateXZ, lerp, type PointXZ } from './interpolate.ts';

describe('lerp', () => {
  it('is a at 0, b at 1 and the middle at 0.5, in either direction', () => {
    expect(lerp(2, 10, 0)).toBe(2);
    expect(lerp(2, 10, 1)).toBe(10);
    expect(lerp(2, 10, 0.5)).toBe(6);
    expect(lerp(10, 2, 0.25)).toBe(8);
  });
});

describe('interpolateXZ', () => {
  it('writes the point between the two steps into `out`', () => {
    const out: PointXZ = { xM: 0, zM: 0 };
    interpolateXZ(1, -1, 2, -3, 0.5, out);
    expect(out).toEqual({ xM: 1.5, zM: -2 });
    interpolateXZ(1, -1, 2, -3, 0, out);
    expect(out).toEqual({ xM: 1, zM: -1 });
    interpolateXZ(1, -1, 2, -3, 1, out);
    expect(out).toEqual({ xM: 2, zM: -3 });
  });

  it('stays on the spot for an entity that did not move', () => {
    const out: PointXZ = { xM: 9, zM: 9 };
    interpolateXZ(3, 4, 3, 4, 0.73, out);
    expect(out).toEqual({ xM: 3, zM: 4 });
  });
});
