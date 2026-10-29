import { asSimMs } from '@shared/time';
import type { ThreatInstance } from '@sim';
import { describe, expect, it } from 'vitest';
import { compareUrgency, isMoreUrgent, threatCloseAt } from './urgency.ts';

function threat(
  windowOpenAt: number,
  windowMs: number | null,
): Pick<ThreatInstance, 'windowOpenAt' | 'responseWindow'> {
  return {
    windowOpenAt: asSimMs(windowOpenAt),
    responseWindow:
      windowMs === null ? null : { windowMs, perfectMs: 100, toleranceMs: 30, bufferMs: 100 },
  };
}

describe('threatCloseAt', () => {
  it('is the opening of the window plus its length', () => {
    expect(threatCloseAt(threat(1000, 600))).toBe(1600);
    expect(threatCloseAt(threat(0, 250))).toBe(250);
  });

  it('is null when the window is not frozen yet (cannot happen once telegraphed)', () => {
    expect(threatCloseAt(threat(1000, null))).toBeNull();
  });
});

describe('compareUrgency', () => {
  it('puts the window that closes first first', () => {
    expect(compareUrgency(1500, 9, 1600, 1)).toBeLessThan(0);
    expect(compareUrgency(1600, 1, 1500, 9)).toBeGreaterThan(0);
  });

  it('breaks a tie with the lower id', () => {
    expect(compareUrgency(1600, 2, 1600, 5)).toBeLessThan(0);
    expect(compareUrgency(1600, 5, 1600, 2)).toBeGreaterThan(0);
  });

  it('is 0 for the same threat', () => {
    expect(compareUrgency(1600, 3, 1600, 3)).toBe(0);
  });
});

describe('isMoreUrgent', () => {
  it('is true only when the first is strictly more urgent', () => {
    expect(isMoreUrgent(1500, 9, 1600, 1)).toBe(true);
    expect(isMoreUrgent(1600, 1, 1500, 9)).toBe(false);
    expect(isMoreUrgent(1600, 2, 1600, 5)).toBe(true);
    expect(isMoreUrgent(1600, 5, 1600, 2)).toBe(false);
    expect(isMoreUrgent(1600, 3, 1600, 3)).toBe(false);
  });

  it('beats the starting value of a running best (no threat yet: Infinity, id -1)', () => {
    expect(isMoreUrgent(10, 1, Number.POSITIVE_INFINITY, -1)).toBe(true);
  });
});
