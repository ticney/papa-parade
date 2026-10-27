import { RESUME_COUNTDOWN_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { countdownStep } from './countdown.ts';

const THIRD = RESUME_COUNTDOWN_MS / 3;

describe('countdownStep', () => {
  it('shows 3 for the first third, from the full length down to just over two thirds', () => {
    expect(countdownStep(RESUME_COUNTDOWN_MS)).toBe(3);
    expect(countdownStep(2 * THIRD + 1)).toBe(3);
  });

  it('shows 2 for the second third, boundaries included at the lower end', () => {
    expect(countdownStep(2 * THIRD)).toBe(2);
    expect(countdownStep(THIRD + 1)).toBe(2);
  });

  it('shows 1 for the last third, down to the last millisecond', () => {
    expect(countdownStep(THIRD)).toBe(1);
    expect(countdownStep(1)).toBe(1);
  });

  it('shows nothing at 0 or below', () => {
    expect(countdownStep(0)).toBeNull();
    expect(countdownStep(-5)).toBeNull();
  });

  it('still shows 3 for a remaining time longer than the countdown', () => {
    expect(countdownStep(RESUME_COUNTDOWN_MS * 2)).toBe(3);
  });

  it('shows nothing for a value that is not a finite number', () => {
    expect(countdownStep(Number.NaN)).toBeNull();
    expect(countdownStep(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('follows a countdown of another length', () => {
    expect(countdownStep(900, 900)).toBe(3);
    expect(countdownStep(300, 900)).toBe(1);
    expect(countdownStep(1, 0)).toBeNull();
  });
});
