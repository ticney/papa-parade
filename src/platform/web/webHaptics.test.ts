import { log } from '@shared/log';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createWebHaptics, type NavigatorLike } from './webHaptics.ts';

const PATTERNS = { light: [15], medium: [30, 10, 30], heavy: [60], heartbeat: [30, 90, 30] };

// Warnings go through the shared `log`; read them back from its ring buffer.
const warnings = (): string[] =>
  log
    .buffer()
    .filter((entry) => entry.level === 'warn' && entry.channel === 'platform')
    .map((entry) => entry.message);

beforeAll(() => {
  log.setLevel('error');
});

describe('createWebHaptics', () => {
  let before: number;
  beforeEach(() => {
    before = warnings().length;
  });
  const newWarnings = (): string[] => warnings().slice(before);

  it('does nothing, without a warning, where there is no vibrate (Safari iOS)', () => {
    const { haptics, isSupported } = createWebHaptics({}, PATTERNS);
    expect(isSupported).toBe(false);
    expect(() => haptics.pulse('light')).not.toThrow();
    expect(newWarnings()).toEqual([]);
  });

  it('calls vibrate with the pattern of the kind, as a method of navigator', () => {
    const calls: { self: unknown; pattern: number[] }[] = [];
    const nav: NavigatorLike = {
      vibrate(this: unknown, pattern) {
        calls.push({ self: this, pattern });
        return true;
      },
    };
    const { haptics, isSupported } = createWebHaptics(nav, PATTERNS);
    expect(isSupported).toBe(true);
    haptics.pulse('medium');
    haptics.pulse('light');
    expect(calls.map((call) => call.pattern)).toEqual([[30, 10, 30], [15]]);
    expect(calls[0]?.self).toBe(nav);
  });

  it('does not let a later change of the table patterns reach a pulse', () => {
    const patterns = { light: [15], medium: [30], heavy: [60], heartbeat: [30, 90, 30] };
    const seen: number[][] = [];
    const { haptics } = createWebHaptics(
      {
        vibrate: (pattern) => {
          seen.push(pattern);
          return true;
        },
      },
      patterns,
    );
    patterns.light[0] = 999;
    haptics.pulse('light');
    expect(seen).toEqual([[15]]);
  });

  it('catches a vibrate that throws and warns once over many pulses', () => {
    const { haptics } = createWebHaptics(
      {
        vibrate: () => {
          throw new Error('not allowed');
        },
      },
      PATTERNS,
    );
    for (let i = 0; i < 5; i++) expect(() => haptics.pulse('heavy')).not.toThrow();
    expect(newWarnings()).toHaveLength(1);
  });

  it('warns once when vibrate answers false, however many pulses', () => {
    const { haptics } = createWebHaptics({ vibrate: () => false }, PATTERNS);
    for (let i = 0; i < 5; i++) haptics.pulse('light');
    expect(newWarnings()).toHaveLength(1);
  });

  it('keeps a throw and a refusal as two separate warnings at most', () => {
    let isThrowing = true;
    const { haptics } = createWebHaptics(
      {
        vibrate: () => {
          if (isThrowing) throw new Error('nope');
          return false;
        },
      },
      PATTERNS,
    );
    haptics.pulse('light');
    haptics.pulse('light');
    isThrowing = false;
    haptics.pulse('light');
    haptics.pulse('light');
    expect(newWarnings()).toHaveLength(2);
  });
});
