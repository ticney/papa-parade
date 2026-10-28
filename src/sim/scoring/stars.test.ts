import { describe, expect, it } from 'vitest';
import { starsForScore } from './stars.ts';

// The GDD's starting thresholds, passed in: the live ones are Geo's to tune.
const GDD_THRESHOLDS = [20, 40, 60, 75, 90] as const;

describe('starsForScore', () => {
  it.each([
    [0, 0],
    [19, 0],
    [20, 1],
    [39, 1],
    [40, 2],
    [59, 2],
    [60, 3],
    [74, 3],
    [75, 4],
    [89, 4],
    [90, 5],
    [100, 5],
  ])('gives %i points %i stars with 20 / 40 / 60 / 75 / 90', (scorePoints, stars) => {
    expect(starsForScore(scorePoints, GDD_THRESHOLDS)).toBe(stars);
  });

  it('reads the thresholds from the data, not from code', () => {
    const thresholds = [10, 11, 50, 51, 99];
    expect(starsForScore(9, thresholds)).toBe(0);
    expect(starsForScore(10, thresholds)).toBe(1);
    expect(starsForScore(11, thresholds)).toBe(2);
    expect(starsForScore(50, thresholds)).toBe(3);
    expect(starsForScore(98, thresholds)).toBe(4);
    expect(starsForScore(99, thresholds)).toBe(5);
  });
});
