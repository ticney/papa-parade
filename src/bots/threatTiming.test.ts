import { asSimMs } from '@shared/time';
import type { SimCommand, ThreatInstance } from '@sim';
import { describe, expect, it } from 'vitest';
import { createCommandScheduler } from './commandScheduler.ts';
import {
  centreOf,
  createCycleMemory,
  createFirmHold,
  fingerPlanFor,
  isPressable,
  responseOf,
  schedulePress,
} from './threatTiming.ts';

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
        threat({
          press: {
            t: asSimMs(2300),
            quality: 'perfect',
            offsetMs: 0,
            releasedAt: null,
            heldAt: null,
          },
        }),
      ),
    ).toBe(false);
  });
});

describe('fingerPlanFor / responseOf', () => {
  it('holds a Parry for the tap', () => {
    expect(fingerPlanFor('parry', 80)).toEqual({ kind: 'tap', holdMs: 80 });
  });

  it('holds a Firmness until the threat is answered, whatever the tap', () => {
    expect(fingerPlanFor('firm', 80)).toEqual({ kind: 'untilAnswered' });
  });

  it('knows only the defs it was given, and no prototype key', () => {
    expect(responseOf({ outlet: 'parry' }, 'outlet')).toBe('parry');
    expect(responseOf({ outlet: 'parry' }, 'lamp')).toBeUndefined();
    expect(responseOf({}, 'constructor')).toBeUndefined();
  });
});

describe('createFirmHold', () => {
  const pressed = {
    t: asSimMs(2300),
    quality: 'perfect',
    offsetMs: 0,
    releasedAt: null,
    heldAt: null,
  } as const;

  it('holds from begin(), and waits while the sim has not taken the press yet', () => {
    const hold = createFirmHold();
    const out: SimCommand[] = [];
    expect(hold.isHolding).toBe(false);
    hold.begin(1);
    expect(hold.isHolding).toBe(true);
    hold.update([threat({ state: 'telegraph' })], 2000, out);
    expect(out).toEqual([]);
    expect(hold.isHolding).toBe(true);
  });

  it('keeps the finger down while the threat holds the press, then releases at the next step', () => {
    const hold = createFirmHold();
    const out: SimCommand[] = [];
    hold.begin(1);
    hold.update([threat({ state: 'windowOpen', press: pressed })], 2400, out);
    hold.update([threat({ state: 'windowOpen', press: pressed })], 3400, out);
    expect(out).toEqual([]);
    hold.update([threat({ state: 'resolved', press: null })], 3800, out);
    expect(out).toEqual([{ type: 'Release', t: 3800 }]);
    expect(hold.isHolding).toBe(false);
    hold.update([threat({ state: 'resolved', press: null })], 3810, out);
    expect(out).toHaveLength(1);
  });

  it('lets go when the press never took: the threat gagged on an early or late press', () => {
    const hold = createFirmHold();
    const out: SimCommand[] = [];
    hold.begin(1);
    hold.update([threat({ state: 'gag', press: null })], 2000, out);
    expect(out).toEqual([{ type: 'Release', t: 2000 }]);
    expect(hold.isHolding).toBe(false);
  });

  it('lets go when the threat has gone altogether', () => {
    const hold = createFirmHold();
    const out: SimCommand[] = [];
    hold.begin(7);
    hold.update([threat({ id: 1 })], 2000, out);
    expect(out).toEqual([{ type: 'Release', t: 2000 }]);
  });

  it('does nothing when nothing is held', () => {
    const out: SimCommand[] = [];
    createFirmHold().update([threat()], 2000, out);
    expect(out).toEqual([]);
  });
});

describe('schedulePress', () => {
  it('plans a press and its release for a Parry, and no hold', () => {
    const scheduler = createCommandScheduler();
    const hold = createFirmHold();
    schedulePress(scheduler, hold, threat(), 'parry', 2350, 80);
    const out: SimCommand[] = [];
    scheduler.flush(2350, out);
    scheduler.flush(2430, out);
    expect(out).toEqual([
      { type: 'PressThreat', t: 2350, threatId: 1 },
      { type: 'Release', t: 2430 },
    ]);
    expect(hold.isHolding).toBe(false);
  });

  it('plans only the press for a Firmness, and starts the hold', () => {
    const scheduler = createCommandScheduler();
    const hold = createFirmHold();
    schedulePress(scheduler, hold, threat(), 'firm', 2350, 80);
    expect(scheduler.size).toBe(1);
    expect(hold.isHolding).toBe(true);
  });

  it('remembers when a tap lets go, and makes a Firmness wait for it', () => {
    const scheduler = createCommandScheduler();
    const hold = createFirmHold();
    schedulePress(scheduler, hold, threat({ id: 1 }), 'parry', 2350, 80);
    expect(hold.tapUntil).toBe(2430);
    // The Firmness would be pressed inside the tap: its press moves to the tap's release.
    schedulePress(scheduler, hold, threat({ id: 2 }), 'firm', 2380, 80);
    const out: SimCommand[] = [];
    scheduler.flush(2350, out);
    scheduler.flush(2430, out);
    expect(out).toEqual([
      { type: 'PressThreat', t: 2350, threatId: 1 },
      { type: 'Release', t: 2430 },
      { type: 'PressThreat', t: 2430, threatId: 2 },
    ]);
    expect(hold.isHolding).toBe(true);
  });

  it('does not delay a Firmness pressed after the tap has let go', () => {
    const scheduler = createCommandScheduler();
    const hold = createFirmHold();
    schedulePress(scheduler, hold, threat({ id: 1 }), 'parry', 2350, 80);
    schedulePress(scheduler, hold, threat({ id: 2 }), 'firm', 2600, 80);
    const out: SimCommand[] = [];
    scheduler.flush(2350, out);
    scheduler.flush(2600, out);
    expect(out.at(-1)).toEqual({ type: 'PressThreat', t: 2600, threatId: 2 });
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
