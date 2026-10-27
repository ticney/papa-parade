import { PLAY_SPEED_MAX, UINT32_RANGE } from '@shared/constants';
import { log } from '@shared/log';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTestApiEnabled, readDebugParams } from './debugParams.ts';

const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
afterEach(() => warnSpy.mockClear());

const ABSENT = { isDebug: false, autoplay: null, seed: null, speed: null };

describe('readDebugParams › absent', () => {
  it('reads nothing, and warns of nothing, from a query with none of the parameters', () => {
    expect(readDebugParams('')).toEqual(ABSENT);
    expect(readDebugParams('?threats=off&throwAfterMs=10')).toEqual(ABSENT);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe('readDebugParams › debug', () => {
  it('is on for ?debug=1', () => {
    expect(readDebugParams('?debug=1').isDebug).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores any other value with one warning that says the only value', () => {
    for (const value of ['0', 'true', '', '2']) {
      expect(readDebugParams(`?debug=${value}`).isDebug).toBe(false);
    }
    expect(warnSpy).toHaveBeenCalledTimes(4);
    expect(warnSpy.mock.calls[0]?.[0]).toBe('boot');
    expect(warnSpy.mock.calls[0]?.[1]).toBe('ignoring ?debug=0: the only value is "1"');
  });
});

describe('readDebugParams › autoplay', () => {
  it('keeps any non-empty bot name (the bot module validates it)', () => {
    expect(readDebugParams('?autoplay=perfect').autoplay).toBe('perfect');
    expect(readDebugParams('?autoplay=nobody').autoplay).toBe('nobody');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores an empty name with a warning', () => {
    expect(readDebugParams('?autoplay=').autoplay).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0]?.[1]).toBe('ignoring ?autoplay=: name a bot');
  });
});

describe('readDebugParams › seed', () => {
  it('reads an integer in [0, 2**32)', () => {
    expect(readDebugParams('?seed=42').seed).toBe(42);
    expect(readDebugParams('?seed=0').seed).toBe(0);
    expect(readDebugParams(`?seed=${UINT32_RANGE - 1}`).seed).toBe(UINT32_RANGE - 1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores everything else with one warning naming the value', () => {
    for (const value of ['abc', '', '-1', '1.5', '1e3', '+4', ' 4', `${UINT32_RANGE}`, '0x10']) {
      expect(readDebugParams(`?seed=${encodeURIComponent(value)}`).seed).toBeNull();
    }
    expect(warnSpy).toHaveBeenCalledTimes(9);
    expect(warnSpy.mock.calls[0]?.[1]).toBe(
      `ignoring ?seed=abc: not an integer in [0, ${UINT32_RANGE})`,
    );
  });
});

describe('readDebugParams › speed', () => {
  it('reads a number in (0, PLAY_SPEED_MAX]', () => {
    expect(readDebugParams('?speed=4').speed).toBe(PLAY_SPEED_MAX);
    expect(readDebugParams('?speed=0.5').speed).toBe(0.5);
    expect(readDebugParams('?speed=1').speed).toBe(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('ignores everything else with one warning naming the value', () => {
    for (const value of ['0', '-1', '99', '4.01', 'fast', '', 'NaN', 'Infinity']) {
      expect(readDebugParams(`?speed=${value}`).speed).toBeNull();
    }
    expect(warnSpy).toHaveBeenCalledTimes(8);
    expect(warnSpy.mock.calls[0]?.[1]).toBe(
      `ignoring ?speed=0: not a number in (0, ${PLAY_SPEED_MAX}]`,
    );
  });
});

describe('readDebugParams › combined', () => {
  it('reads every parameter, and a bad one does not spoil the others', () => {
    expect(readDebugParams('?autoplay=perfect&seed=42&speed=4&debug=1')).toEqual({
      isDebug: true,
      autoplay: 'perfect',
      seed: 42,
      speed: 4,
    });
    expect(readDebugParams('?autoplay=idle&seed=abc&speed=99')).toEqual({
      isDebug: false,
      autoplay: 'idle',
      seed: null,
      speed: null,
    });
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});

describe('isTestApiEnabled', () => {
  it('is on in dev, with or without ?debug=1', () => {
    expect(isTestApiEnabled({ isDebugAllowed: true, isDev: true, isDebug: false })).toBe(true);
    expect(isTestApiEnabled({ isDebugAllowed: true, isDev: true, isDebug: true })).toBe(true);
  });

  it('is on in a playtest build only with ?debug=1', () => {
    expect(isTestApiEnabled({ isDebugAllowed: true, isDev: false, isDebug: false })).toBe(false);
    expect(isTestApiEnabled({ isDebugAllowed: true, isDev: false, isDebug: true })).toBe(true);
  });

  it('is never on in a production build, whatever the page asks', () => {
    for (const isDev of [true, false]) {
      for (const isDebug of [true, false]) {
        expect(isTestApiEnabled({ isDebugAllowed: false, isDev, isDebug })).toBe(false);
      }
    }
  });
});
