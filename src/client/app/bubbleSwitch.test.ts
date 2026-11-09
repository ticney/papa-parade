import { log } from '@shared/log';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readBubbleOff } from './bubbleSwitch.ts';

const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
afterEach(() => warnSpy.mockClear());

describe('readBubbleOff (story 7.12, D13)', () => {
  it('is true for ?bubble=off, whatever else is in the query', () => {
    expect(readBubbleOff('?bubble=off')).toBe(true);
    expect(readBubbleOff('?threats=off&bubble=off&level=salon_kitchen')).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('is false, quietly, when the switch is absent', () => {
    expect(readBubbleOff('')).toBe(false);
    expect(readBubbleOff('?threats=off')).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores any other value, with one warning each', () => {
    expect(readBubbleOff('?bubble=on')).toBe(false);
    expect(readBubbleOff('?bubble=')).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0]?.[0]).toBe('boot');
  });
});
