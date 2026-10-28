import { describe, expect, it } from 'vitest';
import { firmHoldOutcome, holdEndAt } from './holdEnd.ts';

const HOLD = 400;
const UNTIL = 1500;

describe('holdEndAt', () => {
  it('is the end of the attack when the press is not late', () => {
    expect(holdEndAt(2000, 2000, UNTIL, HOLD)).toBe(2000 + UNTIL);
    expect(holdEndAt(2100, 2000, UNTIL, HOLD)).toBe(2000 + UNTIL);
  });

  it('is holdMinMs after the press when the press is so late that the attack ends first', () => {
    expect(holdEndAt(2000 + UNTIL - HOLD, 2000, UNTIL, HOLD)).toBe(2000 + UNTIL);
    expect(holdEndAt(2000 + UNTIL - HOLD + 10, 2000, UNTIL, HOLD)).toBe(2000 + UNTIL + 10);
    expect(holdEndAt(2000 + UNTIL, 2000, UNTIL, HOLD)).toBe(2000 + UNTIL + HOLD);
  });
});

describe('firmHoldOutcome', () => {
  const END = 3500;

  it('waits while the finger is down before the end', () => {
    expect(firmHoldOutcome(2000, null, END, 2400)).toBeNull();
    expect(firmHoldOutcome(2000, null, END, END - 1)).toBeNull();
  });

  it('is held when the finger is still down at the end, with no release needed', () => {
    expect(firmHoldOutcome(2000, null, END, END)).toBe('held');
    expect(firmHoldOutcome(2000, null, END, END + 500)).toBe('held');
  });

  it('is released when the finger came up before the end', () => {
    expect(firmHoldOutcome(2000, 2400, END, 2400)).toBe('released');
    expect(firmHoldOutcome(2000, END - 1, END, END + 5)).toBe('released');
  });

  it('is held when the finger came up at the end or later', () => {
    expect(firmHoldOutcome(2000, END, END, END)).toBe('held');
    expect(firmHoldOutcome(2000, END + 200, END, END + 200)).toBe('held');
  });

  it('judges a release on its own time, not on the step that processes it', () => {
    expect(firmHoldOutcome(2000, 2600, END, 9000)).toBe('released');
  });

  it('ignores a release earlier than the press', () => {
    expect(firmHoldOutcome(2000, 1999, END, 2500)).toBeNull();
    expect(firmHoldOutcome(2000, 1999, END, END)).toBe('held');
  });
});
