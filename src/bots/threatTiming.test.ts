import { asSimMs } from '@shared/time';
import type { ThreatInstance } from '@sim';
import { describe, expect, it } from 'vitest';
import { centreOf, createCycleMemory, holdMsFor, isPressable, responseOf } from './threatTiming.ts';

function threat(overrides: Partial<ThreatInstance> = {}): ThreatInstance {
  return {
    id: 1,
    defId: 'outlet',
    anchorId: 'outlet_01',
    xM: 0,
    zM: 0,
    state: 'telegraph',
    enteredAt: asSimMs(1000),
    windowOpenAt: asSimMs(2200),
    responseWindow: { windowMs: 300, perfectMs: 100, toleranceMs: 60, bufferMs: 100 },
    press: null,
    waveIndex: 0,
    ...overrides,
  };
}

describe('centreOf', () => {
  it('is the middle of the window', () => {
    expect(centreOf(threat())).toBe(2350);
  });
});

describe('isPressable', () => {
  it.each(['telegraph', 'windowOpen'] as const)('accepts a %s threat nobody pressed', (state) => {
    expect(isPressable(threat({ state }))).toBe(true);
  });

  it.each(['idle', 'resolved', 'gag'] as const)('refuses a %s threat', (state) => {
    expect(isPressable(threat({ state }))).toBe(false);
  });

  it('refuses a threat with no frozen window, or one already pressed', () => {
    expect(isPressable(threat({ responseWindow: null }))).toBe(false);
    expect(
      isPressable(
        threat({ press: { t: asSimMs(2300), quality: 'perfect', offsetMs: 0, releasedAt: null } }),
      ),
    ).toBe(false);
  });
});

describe('holdMsFor / responseOf', () => {
  it('holds a Parry for the tap', () => {
    expect(holdMsFor('parry', 80)).toBe(80);
  });

  it('knows only the defs it was given, and no prototype key', () => {
    expect(responseOf({ outlet: 'parry' }, 'outlet')).toBe('parry');
    expect(responseOf({ outlet: 'parry' }, 'lamp')).toBeUndefined();
    expect(responseOf({}, 'constructor')).toBeUndefined();
  });
});

describe('createCycleMemory', () => {
  it('is new once per telegraph, again after a re-arm, and per threat', () => {
    const memory = createCycleMemory();
    expect(memory.isNew(threat())).toBe(true);
    expect(memory.isNew(threat({ state: 'windowOpen', enteredAt: asSimMs(2200) }))).toBe(false);
    expect(memory.isNew(threat({ id: 2 }))).toBe(true);
    expect(memory.isNew(threat({ windowOpenAt: asSimMs(9200) }))).toBe(true);
    expect(memory.isNew(threat({ windowOpenAt: asSimMs(9200) }))).toBe(false);
  });
});
