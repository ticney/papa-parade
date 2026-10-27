import { log } from '@shared/log';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestLevel, outletEntry } from '../../../tests/support/testContent.ts';
import { readThreatsOff, withoutThreats } from './threatsSwitch.ts';

const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
afterEach(() => warnSpy.mockClear());

describe('readThreatsOff', () => {
  it('is true for ?threats=off, whatever else is in the query', () => {
    expect(readThreatsOff('?threats=off')).toBe(true);
    expect(readThreatsOff('?throwAfterMs=10&threats=off')).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('is false, quietly, when the switch is absent', () => {
    expect(readThreatsOff('')).toBe(false);
    expect(readThreatsOff('?throwAfterMs=10')).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores any other value with a warning that names it', () => {
    for (const value of ['on', 'OFF', '', '1']) {
      expect(readThreatsOff(`?threats=${value}`)).toBe(false);
    }
    expect(warnSpy).toHaveBeenCalledTimes(4);
    expect(warnSpy.mock.calls[0]?.[1]).toContain('?threats=on');
  });
});

describe('withoutThreats', () => {
  it('keeps the level id and drops the plan and the defs', () => {
    const planned = createTestLevel([outletEntry(2000)]);
    expect(Object.keys(planned.threats)).toEqual(['outlet']);
    const stripped = withoutThreats(planned);
    expect(stripped.level.id).toBe(planned.level.id);
    expect(stripped.level.threats).toEqual([]);
    expect(stripped.threats).toEqual({});
    expect(planned.level.threats).toHaveLength(1); // the original is untouched
  });
});
