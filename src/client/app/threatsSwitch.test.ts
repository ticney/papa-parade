import { log } from '@shared/log';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CARRY,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
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
  it('keeps the level id and the duration, and drops the waves and the defs', () => {
    const planned = createTestLevel({
      waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
      durationMs: 90_000,
    });
    expect(Object.keys(planned.threats)).toEqual(['outlet']);
    const stripped = withoutThreats(planned);
    expect(stripped.level.id).toBe(planned.level.id);
    expect(stripped.level.waves).toEqual([]);
    expect(stripped.level.durationMs).toBe(90_000);
    expect(stripped.level.variant).toBe(planned.level.variant);
    expect(stripped.threats).toEqual({});
    expect(planned.level.waves).toHaveLength(1); // the original is untouched
  });

  it('drops the disruptions with the waves that plan them: no phone rings, and no def is kept', () => {
    const planned = createTestLevel({
      waves: [testWave([OUTLET], { disruptions: [testPhoneEntry(5000)] })],
      objects: TEST_OBJECTS,
    });
    expect(Object.keys(planned.disruptions)).toEqual(['phone']);
    const stripped = withoutThreats(planned);
    expect(stripped.level.waves).toEqual([]);
    expect(stripped.disruptions).toEqual({});
    // The objects stay: the coffee machine and the phone are still there to walk to.
    expect(stripped.level.objects).toEqual(planned.level.objects);
    expect(Object.keys(planned.disruptions)).toEqual(['phone']); // the original is untouched
  });

  it('keeps the fatigue gauge and the micro-sleep def it needs (createSim refuses one without)', () => {
    const planned = createTestLevel({
      waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
      gauges: FATIGUE_GAUGES,
    });
    const stripped = withoutThreats(planned);
    expect(stripped.level.waves).toEqual([]);
    expect(stripped.level.gauges).toEqual(FATIGUE_GAUGES);
    expect(Object.keys(stripped.threats)).toEqual(['papa_microsleep']);
  });

  it('warns, and keeps nothing, when the micro-sleep def is not loaded', () => {
    const level = createTestLevel({ gauges: FATIGUE_GAUGES });
    const stripped = withoutThreats({ ...level, threats: {} });
    expect(stripped.threats).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith('boot', expect.stringContaining('papa_microsleep'));
  });

  it('keeps the carry and the cry in the arms it needs (story 4.1)', () => {
    const planned = createTestLevel({
      waves: [testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })],
      gauges: FATIGUE_GAUGES,
      carry: CARRY,
    });
    const stripped = withoutThreats(planned);
    expect(stripped.level.carry).toEqual(CARRY);
    expect(Object.keys(stripped.threats).sort()).toEqual(['arms_cry', 'papa_microsleep']);
  });

  it('warns when the cry in the arms is not loaded', () => {
    const level = createTestLevel({ carry: CARRY });
    const stripped = withoutThreats({ ...level, threats: {} });
    expect(stripped.threats).toEqual({});
    expect(warnSpy).toHaveBeenCalledWith('boot', expect.stringContaining('arms_cry'));
  });
});
