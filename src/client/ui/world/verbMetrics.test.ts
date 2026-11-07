import { log } from '@shared/log';
import { describe, expect, it, vi } from 'vitest';
import {
  createVerbMetrics,
  type VerbMetrics,
  type VerbMetricsSource,
  verbTopMinPx,
} from './verbMetrics.ts';

const VARS: Record<string, string> = {
  '--pp-font-verb-family': '"Baloo 2"',
  '--pp-font-verb-weight': '800',
  '--pp-font-verb-size': '40px',
  '--pp-font-verb-line-height': '1',
  '--pp-font-verb-compact-family': '"Baloo 2"',
  '--pp-font-verb-compact-weight': '800',
  '--pp-font-verb-compact-size': '32px',
  '--pp-font-verb-compact-line-height': '1.1',
  '--pp-fallback-rounded': 'ui-rounded, sans-serif',
};

function source(
  surface: string,
  extra: Record<string, string> = {},
  measure: VerbMetricsSource['measure'] = () => 100,
): VerbMetricsSource {
  const vars = { ...VARS, ...extra };
  return { surface: () => surface, cssVar: (name) => vars[name] ?? '', measure };
}

describe('createVerbMetrics', () => {
  it('reads the regular verb typography on the regular surface', () => {
    const metrics = createVerbMetrics(source('regular'));
    expect(metrics.surfaceKey()).toBe('regular');
    expect(metrics.basePx()).toBe(40);
    expect(metrics.lineHeight()).toBe(1);
  });

  it('reads the compact verb typography on the compact surface, and before the first resize it is regular', () => {
    const compact = createVerbMetrics(source('compact'));
    expect(compact.surfaceKey()).toBe('compact');
    expect(compact.basePx()).toBe(32);
    expect(compact.lineHeight()).toBe(1.1);
    expect(createVerbMetrics(source('')).basePx()).toBe(40);
  });

  it('defaults the scale to 1 and reads --pp-verb-scale when set (story 2.10)', () => {
    expect(createVerbMetrics(source('regular')).scale()).toBe(1);
    expect(createVerbMetrics(source('regular', { '--pp-verb-scale': '1.25' })).scale()).toBe(1.25);
    expect(createVerbMetrics(source('regular', { '--pp-verb-scale': 'big' })).scale()).toBe(1);
    expect(createVerbMetrics(source('regular', { '--pp-verb-scale': '0' })).scale()).toBe(1);
  });

  it('reads the threat icon size of the surface (the chrono-ring hangs from it, story 2.11)', () => {
    expect(
      createVerbMetrics(source('regular', { '--pp-threat-size': '64px' })).threatSizePx(),
    ).toBe(64);
    expect(
      createVerbMetrics(source('compact', { '--pp-threat-size': '56px' })).threatSizePx(),
    ).toBe(56);
    expect(createVerbMetrics(source('regular')).threatSizePx()).toBe(64);
  });

  it('falls back to the DESIGN regular size when the token is missing', () => {
    const metrics = createVerbMetrics({
      surface: () => 'regular',
      cssVar: () => '',
      measure: () => 10,
    });
    expect(metrics.basePx()).toBe(40);
    expect(metrics.lineHeight()).toBe(1);
  });

  it('measures with the surface font, at the asked size, with the fallback stack', () => {
    const measure = vi.fn(() => 321);
    const regular = createVerbMetrics(source('regular', {}, measure));
    expect(regular.widthPx('SOULÈVE !', 36)).toBe(321);
    expect(measure).toHaveBeenCalledWith('800 36px "Baloo 2", ui-rounded, sans-serif', 'SOULÈVE !');
    const compact = createVerbMetrics(source('compact', {}, measure));
    compact.widthPx('RETIRE !', 32);
    expect(measure).toHaveBeenLastCalledWith(
      '800 32px "Baloo 2", ui-rounded, sans-serif',
      'RETIRE !',
    );
  });

  it('falls back, and says so once per token, when the size or the line height cannot be read', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const metrics = createVerbMetrics(
      source('regular', { '--pp-font-verb-size': '', '--pp-font-verb-line-height': 'normal' }),
    );
    expect(metrics.basePx()).toBe(40);
    expect(metrics.basePx()).toBe(40);
    expect(metrics.lineHeight()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(metrics.scale()).toBe(1);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('estimates the width, and says so once, when nothing can measure', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const metrics = createVerbMetrics(source('regular', {}, () => null));
    expect(metrics.widthPx('ABCD', 40)).toBeCloseTo(4 * 40 * 0.6, 10);
    metrics.widthPx('ABCD', 40);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('reads the bottom of the HUD row, and keeps to the layer (0), saying so once, when there is none', () => {
    expect(createVerbMetrics({ ...source('regular'), hudBottomPx: () => 56 }).hudBottomPx?.()).toBe(
      56,
    );
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined);
    const missing = createVerbMetrics({ ...source('regular'), hudBottomPx: () => Number.NaN });
    expect(missing.hudBottomPx?.()).toBe(0);
    expect(missing.hudBottomPx?.()).toBe(0);
    expect(createVerbMetrics(source('regular')).hudBottomPx?.()).toBe(0);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});

describe('verbTopMinPx (story 9.5 review)', () => {
  const base: VerbMetrics = createVerbMetrics(source('regular'));

  it('is the bottom of the HUD row: a verb that clears it, however closely, keeps its place', () => {
    expect(verbTopMinPx({ ...base, hudBottomPx: () => 56 })).toBe(56);
  });

  it('is no limit at all when the metrics know no HUD (a test double)', () => {
    const { hudBottomPx: _unused, ...withoutHud } = base;
    expect(verbTopMinPx(withoutHud)).toBe(Number.NEGATIVE_INFINITY);
  });
});
