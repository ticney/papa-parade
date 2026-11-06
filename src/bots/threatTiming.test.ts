import { asSimMs } from '@shared/time';
import type { SimCommand, ThreatInstance, World } from '@sim';
import { describe, expect, it } from 'vitest';
import { createCommandScheduler } from './commandScheduler.ts';
import {
  centreOf,
  createCycleMemory,
  createFirmHold,
  createTidyMemory,
  fingerPlanFor,
  isPressable,
  planTidy,
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
    feintAt: null,
    isFeintGiven: false,
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

  it('presses nothing for a nothing (story 4.9)', () => {
    expect(fingerPlanFor('nothing', 80)).toEqual({ kind: 'none' });
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

  it('does not make a Firmness wait for a tap planned to go down after it (story 9.7)', () => {
    const scheduler = createCommandScheduler();
    const hold = createFirmHold();
    // The tap's window comes later in time, but the bot met its threat first: it is planned first.
    schedulePress(scheduler, hold, threat({ id: 1 }), 'parry', 9000, 80);
    expect(hold.tapUntil).toBe(9080);
    schedulePress(scheduler, hold, threat({ id: 2 }), 'firm', 2380, 80);
    const out: SimCommand[] = [];
    scheduler.flush(2380, out);
    expect(out).toEqual([{ type: 'PressThreat', t: 2380, threatId: 2 }]);
    expect(hold.isHolding).toBe(true);
  });

  it('tapUntilAt is the release of the last tap pressed no later than the instant asked, 0 for none', () => {
    const scheduler = createCommandScheduler();
    const hold = createFirmHold();
    expect(hold.tapUntilAt(5000)).toBe(0);
    schedulePress(scheduler, hold, threat({ id: 1 }), 'parry', 2350, 80);
    schedulePress(scheduler, hold, threat({ id: 2 }), 'parry', 4000, 80);
    expect(hold.tapUntilAt(2349)).toBe(0);
    expect(hold.tapUntilAt(2350)).toBe(2430);
    expect(hold.tapUntilAt(3999)).toBe(2430);
    expect(hold.tapUntilAt(4000)).toBe(4080);
    // A tap noted without its press goes down "before everything": it always counts.
    hold.noteTap(1234);
    expect(hold.tapUntilAt(0)).toBe(1234);
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

describe('planTidy (story 3.5)', () => {
  const RUSH_AT = 20_000;
  const mess = (id: string, xM: number, zM: number, isMess = true) => ({ id, xM, zM, isMess });
  const worldOf = (
    patch: {
      state?: string;
      now?: number;
      papaState?: string;
      props?: ReturnType<typeof mess>[];
      threats?: ThreatInstance[];
    } = {},
  ) =>
    ({
      time: { sim: asSimMs(patch.now ?? RUSH_AT) },
      flow: { state: patch.state ?? 'finalRush', finalRushAt: RUSH_AT },
      papa: { state: patch.papaState ?? 'idle', xM: 0, zM: 0 },
      props: patch.props ?? [mess('far', 3, 0), mess('near', 1, 0)],
      threats: patch.threats ?? [],
    }) as unknown as Readonly<World>;
  const run = (world: Readonly<World>, waitMs = 0, memory = createTidyMemory()) => {
    const out: SimCommand[] = [];
    planTidy(world, { outlet: 'parry' }, out, memory, waitMs);
    return out;
  };

  it('taps the nearest prop that is a mess, stamped now', () => {
    expect(run(worldOf())).toEqual([{ type: 'TapObject', t: RUSH_AT, objectId: 'near' }]);
  });

  it('does nothing outside the rush, while Papa is not idle, or with nothing to tidy', () => {
    for (const state of ['playing', 'sequence', 'photo', 'ended']) {
      expect(run(worldOf({ state })), state).toEqual([]);
    }
    expect(run(worldOf({ papaState: 'walkPath' }))).toEqual([]);
    expect(run(worldOf({ props: [mess('tidy', 1, 0, false)] }))).toEqual([]);
    expect(run(worldOf({ props: [] }))).toEqual([]);
  });

  it('waits waitMs after the door opened (the human bot’s reaction)', () => {
    expect(run(worldOf({ now: RUSH_AT + 249 }), 250)).toEqual([]);
    expect(run(worldOf({ now: RUSH_AT + 250 }), 250)).toHaveLength(1);
  });

  it('leaves an answer to the bot’s threats first', () => {
    const pressable = threat({ state: 'windowOpen' });
    expect(run(worldOf({ threats: [pressable] }))).toEqual([]);
  });

  it('does not send the same prop twice within a second, then tries again', () => {
    const memory = createTidyMemory();
    const props = [mess('stuck', 1, 0)];
    expect(run(worldOf({ props }), 0, memory)).toHaveLength(1);
    expect(run(worldOf({ props, now: RUSH_AT + 500 }), 0, memory)).toEqual([]);
    expect(run(worldOf({ props, now: RUSH_AT + 1000 }), 0, memory)).toHaveLength(1);
    // Another prop is not held back by it.
    expect(
      run(
        worldOf({ props: [mess('stuck', 1, 0), mess('other', 2, 0)], now: RUSH_AT + 1100 }),
        0,
        memory,
      ),
    ).toEqual([{ type: 'TapObject', t: RUSH_AT + 1100, objectId: 'other' }]);
  });

  it('holds back every prop it just tapped, not only the last one', () => {
    const memory = createTidyMemory();
    const props = [mess('a', 1, 0), mess('b', 2, 0)];
    const ids = (now: number) =>
      run(worldOf({ props, now }), 0, memory).map((command) =>
        command.type === 'TapObject' ? command.objectId : command.type,
      );
    expect(ids(RUSH_AT)).toEqual(['a']);
    expect(ids(RUSH_AT + 10)).toEqual(['b']);
    // Two props Papa cannot get to: neither is sent again until a second has passed.
    expect(ids(RUSH_AT + 20)).toEqual([]);
    expect(ids(RUSH_AT + 500)).toEqual([]);
    expect(ids(RUSH_AT + 1000)).toEqual(['a']);
  });
});
