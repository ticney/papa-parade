import { asSimMs } from '@shared/time';
import type { BabySlice, GagId, PapaSlice, SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { GAG_PRESENTATIONS } from '../gags.ts';
import {
  BABY_CONTRACT,
  BABY_TRAVELLING,
  babyClipOf,
  babyLidsAfter,
  babyOneShotOf,
  isBabyTravelling,
  PAPA_ACTING_CLIPS,
  PAPA_ACTING_CUT_EVENTS,
  PAPA_CONTRACT,
  PAPA_DEFERRED_ONE_SHOTS,
  PAPA_HELD_ONE_SHOTS,
  PAPA_IDLE_CLIPS,
  PAPA_TRAVELLING,
  papaClipOf,
  papaOneShotOf,
  responseClipOf,
} from './characterClips.ts';

describe('the travelling states (story 7.8, D4)', () => {
  it('names Papa’s walks and glide, the glide included though it has no speed row', () => {
    const travelling = Object.entries(PAPA_TRAVELLING)
      .filter(([, isTravelling]) => isTravelling)
      .map(([state]) => state);
    expect(travelling.sort()).toEqual(['glide', 'walkDir', 'walkPath']);
  });

  it('names the baby’s crawls, the silent one included', () => {
    const travelling = Object.entries(BABY_TRAVELLING)
      .filter(([, isTravelling]) => isTravelling)
      .map(([state]) => state);
    expect(travelling.sort()).toEqual(['approach', 'mischiefSilent', 'wander']);
  });

  it('counts a crying baby as still, whatever his state (the cry is a still clip)', () => {
    expect(isBabyTravelling({ state: 'wander', cryEndsAt: null } as BabySlice)).toBe(true);
    expect(isBabyTravelling({ state: 'wander', cryEndsAt: asSimMs(9000) } as BabySlice)).toBe(
      false,
    );
    expect(isBabyTravelling({ state: 'babble', cryEndsAt: null } as BabySlice)).toBe(false);
  });
});

const papa = (state: PapaSlice['state']) => ({ state }) as PapaSlice;
const baby = (state: BabySlice['state'], cryEndsAt: number | null = null) =>
  ({ state, cryEndsAt }) as BabySlice;
const t = asSimMs(1000);

describe('papaClipOf', () => {
  it('reads each state', () => {
    const free = baby('babble');
    expect(papaClipOf(papa('idle'), free, false)).toBe('idle');
    expect(papaClipOf(papa('walkPath'), free, false)).toBe('walk');
    expect(papaClipOf(papa('walkDir'), free, false)).toBe('walk');
    expect(papaClipOf(papa('glide'), free, false)).toBe('glide');
    expect(papaClipOf(papa('drink'), free, false)).toBe('drink');
    expect(papaClipOf(papa('asleep'), free, false)).toBe('asleep');
    expect(papaClipOf(papa('onPhone'), free, false)).toBe('on_phone');
    expect(papaClipOf(papa('onToilet'), free, false)).toBe('idle');
  });

  it("has the carried variants, read from the baby's state alone", () => {
    const carried = baby('carried');
    expect(papaClipOf(papa('idle'), carried, false)).toBe('carry_idle');
    expect(papaClipOf(papa('walkPath'), carried, false)).toBe('carry_walk');
    expect(papaClipOf(papa('walkDir'), carried, false)).toBe('carry_walk');
    expect(papaClipOf(papa('glide'), carried, false)).toBe('glide');
  });

  it('walks on tiptoe in a stealth step, and only the walk changes (story 7.11, D5)', () => {
    const free = baby('babble');
    expect(papaClipOf(papa('walkPath'), free, true)).toBe('tiptoe');
    expect(papaClipOf(papa('walkDir'), free, true)).toBe('tiptoe');
    expect(papaClipOf(papa('idle'), free, true)).toBe('idle');
    expect(papaClipOf(papa('glide'), free, true)).toBe('glide');
    // Outside a stealth step nothing plays the tiptoe.
    for (const state of Object.keys(PAPA_TRAVELLING) as PapaSlice['state'][]) {
      expect(papaClipOf(papa(state), free, false)).not.toBe('tiptoe');
      expect(papaClipOf(papa(state), baby('carried'), true)).not.toBe('tiptoe');
    }
  });
});

describe("Papa's acting one-shots and their cut (story 7.11, D1, D12)", () => {
  it('lists the three idles in order, then the start and the brake, all in the contract', () => {
    expect([...PAPA_IDLE_CLIPS]).toEqual(['idle_scratch', 'idle_neck', 'idle_stretch']);
    expect([...PAPA_ACTING_CLIPS].sort()).toEqual(
      ['idle_neck', 'idle_scratch', 'idle_stretch', 'walk_start', 'walk_stop'].sort(),
    );
    const contract: readonly string[] = PAPA_CONTRACT.clips;
    for (const clip of PAPA_ACTING_CLIPS) expect(contract, clip).toContain(clip);
    expect(contract).toContain('tiptoe');
    expect(PAPA_CONTRACT.hiddenNodes).toContain('papa_cheeks');
  });

  it('never lists an event one-shot as acting: a gag, a response or the finale keeps its rules', () => {
    for (const clip of [...PAPA_HELD_ONE_SHOTS, ...PAPA_DEFERRED_ONE_SHOTS, 'stumble']) {
      expect(PAPA_ACTING_CLIPS).not.toContain(clip);
    }
  });

  it('cuts on a state change and on the events of an accepted command', () => {
    expect(PAPA_ACTING_CUT_EVENTS).toContain('PapaStateChanged');
    expect(PAPA_ACTING_CUT_EVENTS).toContain('PapaPathPlanned');
    expect(PAPA_ACTING_CUT_EVENTS).toContain('BabyPutDown');
    expect(new Set(PAPA_ACTING_CUT_EVENTS).size).toBe(PAPA_ACTING_CUT_EVENTS.length);
  });
});

describe('babyClipOf', () => {
  it('reads each state', () => {
    expect(babyClipOf(baby('wander'))).toBe('crawl');
    expect(babyClipOf(baby('approach'))).toBe('crawl');
    expect(babyClipOf(baby('babble'))).toBe('babble');
    expect(babyClipOf(baby('targetLocked'))).toBe('locked');
    expect(babyClipOf(baby('act'))).toBe('act');
    expect(babyClipOf(baby('mischiefSilent'))).toBe('sneak');
    expect(babyClipOf(baby('carried'))).toBe('carried');
  });

  it('cries over any state while the timer runs', () => {
    for (const state of ['wander', 'babble', 'carried'] as const) {
      expect(babyClipOf(baby(state, 5000)), state).toBe('cry');
    }
  });
});

describe('one-shots', () => {
  it('every gag declares clips of the right contract, or none', () => {
    for (const [gag, presentation] of Object.entries(GAG_PRESENTATIONS)) {
      if (presentation.papaClip !== null) {
        expect(PAPA_CONTRACT.clips as readonly string[], gag).toContain(presentation.papaClip);
      }
      if (presentation.babyClip !== null) {
        expect(BABY_CONTRACT.clips as readonly string[], gag).toContain(presentation.babyClip);
      }
    }
  });

  it('reads a gag from its presentation', () => {
    const gag = (id: GagId): SimEvent => ({
      type: 'GagTriggered',
      t,
      threatId: 1,
      gag: id,
      reason: 'late',
    });
    expect(papaOneShotOf(gag('outlet_hair'))).toBe('gag_shock');
    expect(babyOneShotOf(gag('outlet_hair'))).toBe('gag_delight');
    expect(papaOneShotOf(gag('papa_asleep'))).toBeNull();
    expect(babyOneShotOf(gag('arms_wail'))).toBeNull();
  });

  it('dances on the finale, and collapses on the early return alone (story 7.4, D14)', () => {
    expect(papaOneShotOf({ type: 'FinaleReached', t, cause: 'lastWave', threatId: 3 })).toBe(
      'victory_dance',
    );
    expect(papaOneShotOf({ type: 'FinaleReached', t, cause: 'cycleDone', threatId: null })).toBe(
      'victory_dance',
    );
    expect(papaOneShotOf({ type: 'LevelEnded', t, reason: 'mamaHome' })).toBe('collapse');
    for (const reason of ['timer', 'cycleDone', 'mamaWoke'] as const) {
      expect(papaOneShotOf({ type: 'LevelEnded', t, reason }), reason).toBeNull();
    }
    expect(babyOneShotOf({ type: 'FinaleReached', t, cause: 'lastWave', threatId: 3 })).toBeNull();
    expect(PAPA_HELD_ONE_SHOTS).toEqual(['collapse']);
    expect(PAPA_DEFERRED_ONE_SHOTS).toEqual(['victory_dance']);
    for (const clip of [...PAPA_HELD_ONE_SHOTS, ...PAPA_DEFERRED_ONE_SHOTS]) {
      expect(PAPA_CONTRACT.clips as readonly string[]).toContain(clip);
    }
  });

  it('reads the other events of D5', () => {
    expect(papaOneShotOf({ type: 'PapaBlocked', t, xM: 0, zM: 0 })).toBe('stumble');
    expect(papaOneShotOf({ type: 'PapaSnored', t })).toBe('snore');
    // The kick is for the coffee drunk (the fatigue drops), not for the sip that starts it (story 2.13).
    expect(papaOneShotOf({ type: 'CoffeeDrunk', t, fatigue: 5 })).toBe('coffee_kick');
    expect(
      papaOneShotOf({
        type: 'CoffeeStarted',
        t,
        objectId: 'coffee_machine',
        untilAt: asSimMs(2000),
      }),
    ).toBeNull();
    expect(babyOneShotOf({ type: 'BabyPickedUp', t })).toBe('laugh');
    expect(babyOneShotOf({ type: 'BabyPutDown', t, safe: true })).toBe('stir');
    expect(babyOneShotOf({ type: 'WaitFeintGiven', t, threatId: 1 })).toBe('eyes_peek');
    expect(babyOneShotOf({ type: 'WaitSignalGiven', t, threatId: 1 })).toBe('eyes_open');
    expect(babyOneShotOf({ type: 'BabyWoke', t })).toBe('wake');
    expect(
      babyOneShotOf({ type: 'BabyStirred', t, wakePct: 10, deltaPct: 10, reason: 'missed' }),
    ).toBe('stir');
    expect(papaOneShotOf({ type: 'BabyWoke', t })).toBeNull();
    expect(babyOneShotOf({ type: 'PapaBlocked', t, xM: 0, zM: 0 })).toBeNull();
  });

  it('tells a perfect from a success, and a Firmness from a Parry; a Do Nothing has no pose', () => {
    expect(responseClipOf('parry', 'success')).toBe('respond_parry');
    expect(responseClipOf('wait', 'success')).toBe('respond_parry');
    expect(responseClipOf('firm', 'success')).toBe('respond_firm');
    expect(responseClipOf('firm', 'perfect')).toBe('respond_perfect');
    expect(responseClipOf('nothing', 'success')).toBeNull();
  });
});

describe('babyLidsAfter (D9)', () => {
  it('moves only on what the player is told', () => {
    expect(babyLidsAfter({ type: 'WaitFeintGiven', t, threatId: 1 }, 0)).toBe(0.5);
    expect(babyLidsAfter({ type: 'WaitSignalGiven', t, threatId: 1 }, 0.5)).toBe(1);
    expect(
      babyLidsAfter(
        { type: 'GagTriggered', t, threatId: 1, gag: 'baby_sat_up', reason: 'early' },
        1,
      ),
    ).toBe(0);
    expect(babyLidsAfter({ type: 'BabyWoke', t }, 1)).toBe(0);
  });

  it('holds on anything else', () => {
    expect(babyLidsAfter({ type: 'PapaSnored', t }, 0.5)).toBe(0.5);
    expect(babyLidsAfter({ type: 'BabyPickedUp', t }, 1)).toBe(1);
  });
});
