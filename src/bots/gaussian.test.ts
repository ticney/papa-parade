import { createRng } from '@shared/rng';
import { describe, expect, it } from 'vitest';
import { nextGaussian } from './gaussian.ts';

const DRAWS = 20_000;

function draws(seed: number): number[] {
  const rng = createRng(seed);
  return Array.from({ length: DRAWS }, () => nextGaussian(rng));
}

describe('nextGaussian', () => {
  it('is deterministic per seed', () => {
    expect(draws(7)).toEqual(draws(7));
    expect(draws(7)).not.toEqual(draws(8));
  });

  it('has a mean near 0 and a standard deviation near 1', () => {
    const values = draws(42);
    const mean = values.reduce((sum, value) => sum + value, 0) / DRAWS;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / DRAWS;
    // Standard error of the mean is 1/√20000 ≈ 0.007: 0.05 is seven of them.
    expect(Math.abs(mean)).toBeLessThan(0.05);
    expect(Math.abs(Math.sqrt(variance) - 1)).toBeLessThan(0.05);
  });

  it('puts about 68 % of the draws within one standard deviation', () => {
    const inside = draws(3).filter((value) => Math.abs(value) <= 1).length / DRAWS;
    expect(inside).toBeGreaterThan(0.66);
    expect(inside).toBeLessThan(0.7);
  });

  it('never gives NaN or an infinity', () => {
    for (const seed of [0, 1, 2 ** 32 - 1]) {
      for (const value of draws(seed)) expect(Number.isFinite(value)).toBe(true);
    }
  });
});
