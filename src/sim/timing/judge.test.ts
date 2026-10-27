import { describe, expect, it } from 'vitest';
import type { EffectiveWindow } from './effectiveWindow.ts';
import { judgePress } from './judge.ts';

// Window 300 ms opened at 1000: centre 1150, perfect zone [1100, 1200], success zone
// [open - tolerance - buffer, open + window + tolerance] = [840, 1360].
const OPEN = 1000;
const WINDOW: EffectiveWindow = { windowMs: 300, perfectMs: 100, toleranceMs: 60, bufferMs: 100 };

describe('judgePress', () => {
  it.each([
    [1150, 'perfect', 0],
    [1100, 'perfect', -50],
    [1200, 'perfect', 50],
    [1099, 'success', -51],
    [1201, 'success', 51],
    [1000, 'success', -150],
    [1300, 'success', 150],
    [840, 'success', -310],
    [839, 'early', -311],
    [1360, 'success', 210],
    [1361, 'late', 211],
    [0, 'early', -1150],
    [5000, 'late', 3850],
  ] as const)('a press at %d is %s (offset %d)', (pressT, quality, offsetMs) => {
    expect(judgePress(pressT, OPEN, WINDOW)).toEqual({ quality, offsetMs });
  });

  it('rates a fractional timestamp by the same rule', () => {
    expect(judgePress(1099.5, OPEN, WINDOW)).toEqual({ quality: 'success', offsetMs: -50.5 });
    expect(judgePress(1100.5, OPEN, WINDOW).quality).toBe('perfect');
    expect(judgePress(839.5, OPEN, WINDOW).quality).toBe('early');
    expect(judgePress(1360.5, OPEN, WINDOW).quality).toBe('late');
  });

  it('follows the window it is given: no tolerance and no buffer', () => {
    const strict: EffectiveWindow = { windowMs: 300, perfectMs: 100, toleranceMs: 0, bufferMs: 0 };
    expect(judgePress(1000, OPEN, strict).quality).toBe('success');
    expect(judgePress(999, OPEN, strict).quality).toBe('early');
    expect(judgePress(1300, OPEN, strict).quality).toBe('success');
    expect(judgePress(1301, OPEN, strict).quality).toBe('late');
  });

  it('measures from the opening, wherever it is', () => {
    expect(judgePress(7150, 7000, WINDOW)).toEqual({ quality: 'perfect', offsetMs: 0 });
  });

  it('lets a perfect zone as wide as the window win over the other ratings', () => {
    const all: EffectiveWindow = { windowMs: 300, perfectMs: 300, toleranceMs: 60, bufferMs: 100 };
    expect(judgePress(1000, OPEN, all).quality).toBe('perfect');
    expect(judgePress(999, OPEN, all).quality).toBe('success');
  });
});
