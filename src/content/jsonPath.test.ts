import { describe, expect, it } from 'vitest';
import { formatJsonPath } from './jsonPath.ts';

describe('formatJsonPath', () => {
  it('returns an empty string for the root', () => {
    expect(formatJsonPath([])).toBe('');
  });

  it('joins identifiers with dots', () => {
    expect(formatJsonPath(['timing', 'windowMs'])).toBe('timing.windowMs');
  });

  it('writes array indexes in brackets', () => {
    expect(formatJsonPath(['mama', 'starThresholdPoints', 2])).toBe('mama.starThresholdPoints[2]');
    expect(formatJsonPath([0, 'a'])).toBe('[0].a');
  });

  it('brackets and quotes keys that are not plain identifiers', () => {
    expect(formatJsonPath(['start.tap_to_start'])).toBe('["start.tap_to_start"]');
    expect(formatJsonPath(['group', 'a-b'])).toBe('group["a-b"]');
  });

  it('accepts symbols without throwing', () => {
    expect(formatJsonPath([Symbol('x')])).toBe('["Symbol(x)"]');
  });
});
