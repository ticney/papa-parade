import { MAX_PIXEL_RATIO } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { pixelRatioFor } from './renderer.ts';

describe('pixelRatioFor', () => {
  it.each([
    ['a ratio of 1', 1, 1],
    ['a ratio below the cap', 1.5, 1.5],
    ['a ratio at the cap', MAX_PIXEL_RATIO, MAX_PIXEL_RATIO],
    ['a ratio above the cap', MAX_PIXEL_RATIO + 1, MAX_PIXEL_RATIO],
    ['a ratio far above the cap', 10, MAX_PIXEL_RATIO],
  ])('caps %s', (_name, devicePixelRatio, expected) => {
    expect(pixelRatioFor(devicePixelRatio)).toBe(expected);
  });

  it.each([
    ['zero', 0],
    ['a negative number', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['-Infinity', Number.NEGATIVE_INFINITY],
  ])('falls back to 1 for %s, without throwing', (_name, devicePixelRatio) => {
    expect(pixelRatioFor(devicePixelRatio)).toBe(1);
  });
});
