import { MAX_TIMER_DELAY_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { parseThrowDelayMs } from './forcedThrow.ts';

describe('parseThrowDelayMs', () => {
  it('takes whole numbers of milliseconds, zero and the largest timer delay included', () => {
    expect(parseThrowDelayMs('0')).toBe(0);
    expect(parseThrowDelayMs('300')).toBe(300);
    expect(parseThrowDelayMs('007')).toBe(7);
    expect(parseThrowDelayMs(String(MAX_TIMER_DELAY_MS))).toBe(MAX_TIMER_DELAY_MS);
  });

  it.each([
    '',
    ' ',
    '-1',
    '1.5',
    '1e3',
    '1e21',
    '0x10',
    ' 300 ',
    'abc',
    String(MAX_TIMER_DELAY_MS + 1),
    '99999999999999999999999',
  ])('refuses %j', (raw) => {
    expect(parseThrowDelayMs(raw)).toBeNull();
  });
});
