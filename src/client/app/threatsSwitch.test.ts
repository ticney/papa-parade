import { log } from '@shared/log';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestCycleLevel } from '../../../tests/support/cycleSupport.ts';
import {
  CARRY,
  createTestBombDrop,
  createTestBombDropLay,
  createTestFakeSleep,
  createTestFakeSleepDuel,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  TEST_COOKING,
  TEST_OBJECTS,
  TEST_STOVE,
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
  it('keeps the house chores of a level: a station is no threat (story 9.4)', () => {
    const planned = createTestLevel({
      waves: [testWave([OUTLET])],
      objects: [...TEST_OBJECTS, TEST_STOVE],
      chores: [TEST_COOKING],
    });
    const stripped = withoutThreats(planned);
    expect(stripped.level.chores).toEqual([{ def: 'cooking', object: 'stove' }]);
    expect(stripped.chores).toEqual(planned.chores);
    expect(stripped.level.waves).toEqual([]);
  });

  it('adds no chores key to a level that has none: its hash does not move', () => {
    expect(
      Object.hasOwn(withoutThreats(createTestLevel({ waves: [testWave([OUTLET])] })), 'chores'),
    ).toBe(false);
  });

  it('still plays the bedtime cycle: the cycle, its sequences and their threats stay (story 4.10)', () => {
    const planned = createTestCycleLevel();
    const stripped = withoutThreats(planned);
    expect(stripped.level.cycle).toEqual(planned.level.cycle);
    expect(stripped.level.waves).toEqual([]);
    expect(Object.keys(stripped.sequences).sort()).toEqual(Object.keys(planned.sequences).sort());
    for (const id of ['bedtime_eyes', 'bomb_drop_lay', 'false_alarm_sigh', 'real_wake']) {
      expect(stripped.threats[id]).toBeDefined();
    }
    expect(stripped.threats.outlet).toBeUndefined();
  });

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

  it('keeps the threat a duel step spawns, with its sequence (story 4.6)', () => {
    const planned = createTestLevel({
      waves: [testWave([OUTLET])],
      carry: CARRY,
      sequences: ['bedtime_duel'],
    });
    expect(Object.keys(planned.threats).sort()).toEqual(['arms_cry', 'bedtime_eyes', 'outlet']);
    const stripped = withoutThreats(planned);
    expect(Object.keys(stripped.threats).sort()).toEqual(['arms_cry', 'bedtime_eyes']);
    expect(Object.keys(stripped.sequences)).toEqual(['bedtime_duel']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('keeps the fake sleep a duel step spawns, with its feint (story 4.7)', () => {
    const duel = createTestFakeSleepDuel();
    const planned = createTestLevel({
      waves: [testWave([OUTLET])],
      carry: CARRY,
      sequences: [duel.id],
    });
    const stripped = withoutThreats(planned);
    expect(Object.keys(stripped.threats).sort()).toEqual([
      'arms_cry',
      'bedtime_eyes',
      'fake_sleep',
    ]);
    expect(stripped.threats.fake_sleep).toEqual(createTestFakeSleep());
    expect(Object.keys(stripped.sequences)).toEqual([duel.id]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('keeps the bomb drop’s Firmness a duel step spawns, with its release (story 4.8)', () => {
    const drop = createTestBombDrop();
    const planned = createTestLevel({
      waves: [testWave([OUTLET])],
      carry: CARRY,
      sequences: [drop.id],
    });
    const stripped = withoutThreats(planned);
    expect(Object.keys(stripped.threats).sort()).toEqual(['arms_cry', 'bomb_drop_lay']);
    expect(stripped.threats.bomb_drop_lay).toEqual(createTestBombDropLay());
    expect(stripped.threats.bomb_drop_lay?.release).toBeDefined();
    expect(Object.keys(stripped.sequences)).toEqual([drop.id]);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('keeps the two alerts a stealth step spawns on the baby, with its sequence (story 4.9)', () => {
    const planned = createTestLevel({
      waves: [testWave([OUTLET])],
      carry: CARRY,
      sequences: ['stealth_exit'],
    });
    const stripped = withoutThreats(planned);
    expect(Object.keys(stripped.threats).sort()).toEqual([
      'arms_cry',
      'false_alarm_sigh',
      'real_wake',
    ]);
    expect(stripped.threats.false_alarm_sigh?.response).toBe('nothing');
    expect(stripped.threats.real_wake?.target).toBe('baby');
    expect(Object.keys(stripped.sequences)).toEqual(['stealth_exit']);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('warns about a stealth def the level does not load, and keeps the others', () => {
    const planned = createTestLevel({ carry: CARRY, sequences: ['stealth_exit'] });
    const threats = { ...planned.threats };
    delete threats.real_wake;
    const stripped = withoutThreats({ ...planned, threats });
    expect(Object.keys(stripped.threats).sort()).toEqual(['arms_cry', 'false_alarm_sigh']);
    expect(warnSpy.mock.calls[0]?.[1]).toContain('real_wake');
  });

  it('warns about a duel def the level does not load, and keeps the others', () => {
    const planned = createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'] });
    const threats = { ...planned.threats };
    delete threats.bedtime_eyes;
    const stripped = withoutThreats({ ...planned, threats });
    expect(Object.keys(stripped.threats)).toEqual(['arms_cry']);
    expect(warnSpy.mock.calls[0]?.[1]).toContain('bedtime_eyes');
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
