import { log } from '@shared/log';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPlatform } from './createPlatform.ts';

const PATTERNS = { light: [15], medium: [30], heavy: [60] };

beforeAll(() => {
  log.setLevel('error');
});

const warnings = (): string[] =>
  log
    .buffer()
    .filter((entry) => entry.level === 'warn' && entry.channel === 'platform')
    .map((entry) => entry.message);

describe('createPlatform', () => {
  let before: number;
  beforeEach(() => {
    before = warnings().length;
  });
  const newWarnings = (): string[] => warnings().slice(before);

  it('is the web platform for an unset target and for `web`, without a warning', () => {
    for (const target of [undefined, 'web']) {
      const platform = createPlatform({ target, hapticPatternsMs: PATTERNS, nav: {} });
      expect(platform.capabilities.target).toBe('web');
    }
    expect(newWarnings()).toEqual([]);
  });

  it('reports no haptics on a browser without vibrate (Safari iOS, WebKit)', () => {
    const platform = createPlatform({ target: 'web', hapticPatternsMs: PATTERNS, nav: {} });
    expect(platform.capabilities.haptics).toBe(false);
    expect(() => platform.haptics.pulse('light')).not.toThrow();
  });

  it('reports haptics, and pulses through vibrate, where it exists', () => {
    const seen: number[][] = [];
    const platform = createPlatform({
      target: 'web',
      hapticPatternsMs: PATTERNS,
      nav: {
        vibrate: (pattern) => {
          seen.push(pattern);
          return true;
        },
      },
    });
    expect(platform.capabilities.haptics).toBe(true);
    platform.haptics.pulse('heavy');
    expect(seen).toEqual([[60]]);
  });

  it('reports touch from the touch points', () => {
    const touch = createPlatform({
      target: 'web',
      hapticPatternsMs: PATTERNS,
      nav: { maxTouchPoints: 5 },
    });
    const mouse = createPlatform({
      target: 'web',
      hapticPatternsMs: PATTERNS,
      nav: { maxTouchPoints: 0 },
    });
    const unknown = createPlatform({ target: 'web', hapticPatternsMs: PATTERNS, nav: {} });
    expect([touch, mouse, unknown].map((platform) => platform.capabilities.touch)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it.each(['ios', 'android'])('runs the web platform for `%s`, with one warning (E8)', (target) => {
    const platform = createPlatform({ target, hapticPatternsMs: PATTERNS, nav: {} });
    expect(platform.capabilities.target).toBe('web');
    expect(newWarnings()).toEqual([expect.stringContaining('E8')]);
  });

  it('runs the web platform for an unknown target, with a warning that names it', () => {
    const platform = createPlatform({ target: 'switch', hapticPatternsMs: PATTERNS, nav: {} });
    expect(platform.capabilities.target).toBe('web');
    expect(newWarnings()).toEqual([expect.stringContaining('switch')]);
  });

  it('falls back to an empty navigator where there is none (Node)', () => {
    const platform = createPlatform({ target: 'web', hapticPatternsMs: PATTERNS });
    expect(platform.capabilities.haptics).toBe(false);
  });
});
