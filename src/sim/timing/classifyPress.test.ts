import { describe, expect, it } from 'vitest';
import { classifyPress } from './classifyPress.ts';

const HOLD = 400;

describe('classifyPress', () => {
  it('a release before holdMinMs is a Parry', () => {
    expect(classifyPress(1000, 1000, 1000, HOLD)).toBe('parry');
    expect(classifyPress(1000, 1000 + HOLD - 1, 2000, HOLD)).toBe('parry');
  });

  it('a release at holdMinMs or later is a Firmness', () => {
    expect(classifyPress(1000, 1000 + HOLD, 1400, HOLD)).toBe('firm');
    expect(classifyPress(1000, 1900, 2000, HOLD)).toBe('firm');
  });

  it('with no release, it stays open until the press has been held holdMinMs', () => {
    expect(classifyPress(1000, null, 1000, HOLD)).toBeNull();
    expect(classifyPress(1000, null, 1000 + HOLD - 1, HOLD)).toBeNull();
    expect(classifyPress(1000, null, 1000 + HOLD, HOLD)).toBe('firm');
    expect(classifyPress(1000, null, 9000, HOLD)).toBe('firm');
  });

  it('a release earlier than the press is not its release', () => {
    expect(classifyPress(1000, 999, 1100, HOLD)).toBeNull();
    expect(classifyPress(1000, 999, 1400, HOLD)).toBe('firm');
  });

  it('decides on the release time, not on how late it was processed', () => {
    expect(classifyPress(1000, 1100, 5000, HOLD)).toBe('parry');
  });

  it('follows the holdMinMs it is given', () => {
    expect(classifyPress(0, 150, 150, 100)).toBe('firm');
    expect(classifyPress(0, 150, 150, 200)).toBe('parry');
  });
});
