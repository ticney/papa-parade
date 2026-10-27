import { describe, expect, it } from 'vitest';
import { nextLineIndex } from './loadingScreen.ts';

describe('nextLineIndex', () => {
  it('goes round the lines in order', () => {
    expect(nextLineIndex(0, 3)).toBe(1);
    expect(nextLineIndex(1, 3)).toBe(2);
    expect(nextLineIndex(2, 3)).toBe(0);
  });

  it('stays on the only line when there is one', () => {
    expect(nextLineIndex(0, 1)).toBe(0);
  });

  it.each([
    [-1, 3],
    [1.5, 3],
    [Number.NaN, 3],
    [0, 0],
    [0, -2],
    [0, Number.NaN],
  ])('starts over at 0 for (%s, %s)', (current, count) => {
    expect(nextLineIndex(current, count)).toBe(0);
  });
});
