import { describe, expect, it } from 'vitest';
import { type SquashScale, squashScaleAt } from './squash.ts';

const at = (amountPct: number, elapsedMs: number, durationMs = 100): SquashScale => {
  const out: SquashScale = { xz: 9, y: 9 };
  squashScaleAt(amountPct, elapsedMs, durationMs, out);
  return out;
};

describe('squashScaleAt', () => {
  it('is exactly 1 before it starts, at both ends and after', () => {
    for (const elapsedMs of [-5, 0, 100, 500]) {
      expect(at(-30, elapsedMs)).toEqual({ xz: 1, y: 1 });
    }
  });

  it('holds the volume at every point of the curve', () => {
    for (let elapsedMs = 1; elapsedMs < 100; elapsedMs++) {
      const { xz, y } = at(-40, elapsedMs);
      expect(xz * xz * y).toBeCloseTo(1, 10);
    }
  });

  it('reaches its amount at the peak, then overshoots the other way, smaller', () => {
    // Finely sampled: the peak is 0.218 of the way in, and the amount is the real extreme to 4 digits.
    const heights = Array.from({ length: 9999 }, (_, index) => at(-30, index + 1, 10_000).y);
    expect(Math.min(...heights)).toBeCloseTo(0.7, 4);
    const stretch = Math.max(...heights);
    expect(stretch).toBeGreaterThan(1);
    expect(stretch).toBeLessThan(1.3);
  });

  it('stretches first with a positive amount', () => {
    expect(at(30, 20).y).toBeGreaterThan(1);
  });

  it('keeps the height positive at the bound of the schema', () => {
    for (let elapsedMs = 1; elapsedMs < 100; elapsedMs++) {
      expect(at(-60, elapsedMs).y).toBeGreaterThan(0);
      expect(at(60, elapsedMs).y).toBeGreaterThan(0);
    }
  });
});
