import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { isReliefSuccess, type ResolvedResponse } from './reliefSigh.ts';

/** A window of 400 ms with 50 ms of hidden tolerance each side: `half` is 250 ms. */
const WINDOW = { windowMs: 400, perfectMs: 60, toleranceMs: 50, bufferMs: 100 };

const resolved = (patch: Partial<ResolvedResponse>): ResolvedResponse => ({
  type: 'ResponseResolved',
  t: asSimMs(1000),
  threatId: 1,
  response: 'parry',
  quality: 'success',
  offsetMs: 0,
  responseWindow: WINDOW,
  ...patch,
});

describe('isReliefSuccess (story 7.12, D5)', () => {
  it('counts a success exactly at the start of the last quarter, the tolerance included', () => {
    // (offset + 250) / 500 >= 0.75  <=>  offset >= 125.
    expect(isReliefSuccess(resolved({ offsetMs: 125 }), 25)).toBe(true);
    expect(isReliefSuccess(resolved({ offsetMs: 124 }), 25)).toBe(false);
    expect(isReliefSuccess(resolved({ offsetMs: 200 }), 25)).toBe(true);
  });

  it('counts a press past the window but within its hidden tolerance', () => {
    expect(isReliefSuccess(resolved({ offsetMs: 240 }), 25)).toBe(true);
    expect(isReliefSuccess(resolved({ offsetMs: 250 }), 25)).toBe(true);
  });

  it('reads the share it is given: a wider share reaches earlier', () => {
    expect(isReliefSuccess(resolved({ offsetMs: 50 }), 25)).toBe(false);
    // (50 + 250) / 500 = 0.6 >= 1 - 0.5.
    expect(isReliefSuccess(resolved({ offsetMs: 50 }), 50)).toBe(true);
  });

  it('never sighs for a perfect, a fail, a press with no offset, or an early success', () => {
    expect(isReliefSuccess(resolved({ quality: 'perfect', offsetMs: 200 }), 25)).toBe(false);
    expect(isReliefSuccess(resolved({ quality: 'fail', offsetMs: 200 }), 25)).toBe(false);
    expect(isReliefSuccess(resolved({ offsetMs: null }), 25)).toBe(false);
    expect(isReliefSuccess(resolved({ offsetMs: -200 }), 25)).toBe(false);
    expect(isReliefSuccess(resolved({ offsetMs: -125 }), 50)).toBe(false);
  });

  it('never sighs over a window of no length and no tolerance', () => {
    const none = { ...WINDOW, windowMs: 0, toleranceMs: 0 };
    expect(isReliefSuccess(resolved({ offsetMs: 0, responseWindow: none }), 50)).toBe(false);
  });
});
