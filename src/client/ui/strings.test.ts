import type { LogChannel } from '@shared/log';
import { describe, expect, it } from 'vitest';
import { createTranslator } from './strings.ts';

function setup() {
  const warnings: string[] = [];
  const logger = {
    warn: (_channel: LogChannel, message: string) => {
      warnings.push(message);
    },
  };
  return { warnings, logger };
}

describe('createTranslator', () => {
  it('returns the string for a known key, without a warning', () => {
    const { warnings, logger } = setup();
    const t = createTranslator({ 'pause.title': 'Pause' }, logger);
    expect(t('pause.title')).toBe('Pause');
    expect(warnings).toEqual([]);
  });

  it('answers the key itself for a missing key, and warns once per key', () => {
    const { warnings, logger } = setup();
    const t = createTranslator({ 'pause.title': 'Pause' }, logger);
    expect(t('pause.nope')).toBe('pause.nope');
    expect(t('pause.nope')).toBe('pause.nope');
    expect(t('pause.other')).toBe('pause.other');
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('pause.nope');
  });

  it('does not take inherited object properties for keys', () => {
    const { warnings, logger } = setup();
    const t = createTranslator({}, logger);
    expect(t('constructor')).toBe('constructor');
    expect(t('toString')).toBe('toString');
    expect(warnings).toHaveLength(2);
  });

  it('keeps two translators independent', () => {
    const a = setup();
    const b = setup();
    const ta = createTranslator({ 'a.b': 'A' }, a.logger);
    const tb = createTranslator({ 'a.b': 'B' }, b.logger);
    expect(ta('a.b')).toBe('A');
    expect(tb('a.b')).toBe('B');
    ta('x.y');
    expect(a.warnings).toHaveLength(1);
    expect(b.warnings).toHaveLength(0);
  });
});
