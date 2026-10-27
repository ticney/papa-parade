import { describe, expect, it } from 'vitest';
import { isInsideRect } from './pressButton.ts';

const RECT = { left: 10, top: 20, right: 54, bottom: 64 };

describe('isInsideRect', () => {
  it('is true inside and on the edges', () => {
    expect(isInsideRect({ x: 30, y: 40 }, RECT)).toBe(true);
    expect(isInsideRect({ x: 10, y: 20 }, RECT)).toBe(true);
    expect(isInsideRect({ x: 54, y: 64 }, RECT)).toBe(true);
  });

  it('is false just outside, on each side', () => {
    expect(isInsideRect({ x: 9.9, y: 40 }, RECT)).toBe(false);
    expect(isInsideRect({ x: 54.1, y: 40 }, RECT)).toBe(false);
    expect(isInsideRect({ x: 30, y: 19.9 }, RECT)).toBe(false);
    expect(isInsideRect({ x: 30, y: 64.1 }, RECT)).toBe(false);
  });

  it('is false for anything that is not a number', () => {
    expect(isInsideRect({ x: Number.NaN, y: 40 }, RECT)).toBe(false);
    expect(isInsideRect({ x: 30, y: Number.POSITIVE_INFINITY }, RECT)).toBe(false);
    expect(isInsideRect({ x: 30, y: 40 }, { ...RECT, right: Number.NaN })).toBe(false);
  });
});
