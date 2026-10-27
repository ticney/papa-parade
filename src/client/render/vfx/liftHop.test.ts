import { describe, expect, it } from 'vitest';
import { createLiftFx, LIFT_HEIGHT_M, LIFT_MS, liftOffsetAt } from './liftHop.ts';

describe('liftOffsetAt', () => {
  it('is on the floor outside the hop', () => {
    expect(liftOffsetAt(-1)).toBe(0);
    expect(liftOffsetAt(0)).toBe(0);
    expect(liftOffsetAt(LIFT_MS)).toBe(0);
    expect(liftOffsetAt(LIFT_MS + 100)).toBe(0);
  });

  it('peaks at the lift height halfway and is symmetric', () => {
    expect(liftOffsetAt(LIFT_MS / 2)).toBeCloseTo(LIFT_HEIGHT_M, 6);
    expect(liftOffsetAt(LIFT_MS * 0.25)).toBeCloseTo(liftOffsetAt(LIFT_MS * 0.75), 6);
  });
});

describe('createLiftFx', () => {
  it('writes nothing until a hop starts, then the height, then a last zero, then nothing', () => {
    const heights: number[] = [];
    const fx = createLiftFx((heightM) => heights.push(heightM));
    fx.update(100);
    expect(heights).toEqual([]);
    fx.start(1000);
    fx.update(1000 + LIFT_MS / 2);
    expect(heights).toEqual([expect.closeTo(LIFT_HEIGHT_M, 6)]);
    fx.update(1000 + LIFT_MS);
    expect(heights.at(-1)).toBe(0);
    const count = heights.length;
    fx.update(1000 + LIFT_MS + 16);
    expect(heights).toHaveLength(count);
  });

  it('puts the baby back on the floor on reset and stops', () => {
    const heights: number[] = [];
    const fx = createLiftFx((heightM) => heights.push(heightM));
    fx.start(0);
    fx.reset();
    expect(heights).toEqual([0]);
    fx.update(100);
    expect(heights).toEqual([0]);
  });
});
