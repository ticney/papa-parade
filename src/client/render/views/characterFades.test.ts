import { describe, expect, it } from 'vitest';
import { type FadesConfig, fadeMsOf, smoothstep } from './characterFades.ts';

const FADES: FadesConfig = { startMs: 100, stopMs: 200, returnMs: 150, otherMs: 90 };

describe('fadeMsOf (story 7.8, D4)', () => {
  it.each<[string, boolean, boolean, 'loop' | 'oneShot' | 'return', number]>([
    ['a start: still to travelling', false, true, 'loop', 100],
    ['a stop: travelling to still', true, false, 'loop', 200],
    ['still to still', false, false, 'loop', 90],
    ['travelling to travelling', true, true, 'loop', 90],
    ['into a one-shot, from a travelling loop', true, false, 'oneShot', 90],
    ['into a one-shot, from a still loop', false, true, 'oneShot', 90],
    ['the return from a one-shot', false, true, 'return', 150],
    ['the return from a one-shot, to a still loop', false, false, 'return', 150],
  ])('gives %s its fade', (_name, from, to, kind, expected) => {
    expect(fadeMsOf(from, to, kind, FADES)).toBe(expected);
  });
});

describe('smoothstep (story 7.8, AC 1)', () => {
  it('goes from 0 to 1, clamped outside', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(0.5)).toBe(0.5);
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(2)).toBe(1);
  });

  it('has a zero slope at both ends', () => {
    const h = 1e-4;
    expect(smoothstep(h) / h).toBeLessThan(1e-3);
    expect((1 - smoothstep(1 - h)) / h).toBeLessThan(1e-3);
    // And a slope of 1.5 halfway: it is a real curve, not a cut.
    expect((smoothstep(0.5 + h) - smoothstep(0.5 - h)) / (2 * h)).toBeCloseTo(1.5, 3);
  });

  it('only rises', () => {
    let last = 0;
    for (let p = 0; p <= 1; p += 0.01) {
      const value = smoothstep(p);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
  });
});
