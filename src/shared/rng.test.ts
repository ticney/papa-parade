import { describe, expect, it } from 'vitest';
import { createRng, nextFloat, nextInt, nextUint32 } from './rng.ts';

/** Textbook closure-style sfc32, independent of the implementation under test. */
function referenceSfc32(a: number, b: number, c: number, d: number): () => number {
  return () => {
    a |= 0;
    b |= 0;
    c |= 0;
    d |= 0;
    const t = (((a + b) | 0) + d) | 0;
    d = (d + 1) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    c = (c + t) | 0;
    return t >>> 0;
  };
}

describe('rng (sfc32)', () => {
  it('matches the reference sfc32 for the documented seeding', () => {
    const seed = 42;
    const reference = referenceSfc32(0x9e3779b9, 0x243f6a88, 0xb7e15162, seed);
    for (let i = 0; i < 15; i++) reference();
    const rng = createRng(seed);
    for (let i = 0; i < 1000; i++) expect(nextUint32(rng)).toBe(reference());
  });

  it('is deterministic and differs between seeds', () => {
    const a = createRng(7);
    const b = createRng(7);
    const c = createRng(8);
    const fromA = Array.from({ length: 20 }, () => nextUint32(a));
    expect(Array.from({ length: 20 }, () => nextUint32(b))).toEqual(fromA);
    expect(Array.from({ length: 20 }, () => nextUint32(c))).not.toEqual(fromA);
  });

  it('keeps its state as plain JSON data and continues the same sequence after a round-trip', () => {
    const rng = createRng(3);
    for (let i = 0; i < 10; i++) nextUint32(rng);
    const copy = JSON.parse(JSON.stringify(rng)) as typeof rng;
    expect(copy).toEqual(rng);
    for (let i = 0; i < 50; i++) expect(nextUint32(copy)).toBe(nextUint32(rng));
  });

  it('nextFloat stays in [0, 1) with a sane mean', () => {
    const rng = createRng(1);
    let sum = 0;
    for (let i = 0; i < 10000; i++) {
      const value = nextFloat(rng);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
      sum += value;
    }
    expect(sum / 10000).toBeGreaterThan(0.45);
    expect(sum / 10000).toBeLessThan(0.55);
  });

  it('nextInt covers [min, max) and nothing else', () => {
    const rng = createRng(5);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(nextInt(rng, 3, 7));
    expect([...seen].sort((x, y) => x - y)).toEqual([3, 4, 5, 6]);
    expect(nextInt(rng, 9, 10)).toBe(9);
  });

  it('rejects a bad seed and bad bounds', () => {
    for (const seed of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 32])
      expect(() => createRng(seed)).toThrow();
    const rng = createRng(0);
    expect(() => nextInt(rng, 5, 5)).toThrow();
    expect(() => nextInt(rng, 0.5, 3)).toThrow();
    expect(createRng(2 ** 32 - 1)).toBeDefined();
    expect(createRng(-0)).toEqual(createRng(0));
    expect(() => nextInt(rng, 0, 2 ** 32 + 1)).toThrow(/wider than 2\*\*32/);
    expect(() => nextInt(rng, 0, 2 ** 32)).not.toThrow();
  });
});
