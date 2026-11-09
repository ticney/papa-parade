import { asSimMs } from '@shared/time';
import type { BabySlice, GagId, PapaSlice, SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { GAG_PRESENTATIONS } from '../gags.ts';
import {
  BABY_ACTING_CLIPS,
  BABY_CONTRACT,
  BABY_IDLE_CLIPS,
  BABY_LAUGH_CLIPS,
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
  PAPA_PARRY_CLIPS,
  PAPA_REACTION_CLIPS,
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
    expect(papaClipOf(papa('idle'), free, false, null)).toBe('idle');
    expect(papaClipOf(papa('walkPath'), free, false, null)).toBe('walk');
    expect(papaClipOf(papa('walkDir'), free, false, null)).toBe('walk');
    expect(papaClipOf(papa('glide'), free, false, null)).toBe('glide');
    expect(papaClipOf(papa('drink'), free, false, null)).toBe('drink');
    expect(papaClipOf(papa('asleep'), free, false, null)).toBe('asleep');
    expect(papaClipOf(papa('onPhone'), free, false, null)).toBe('on_phone');
    expect(papaClipOf(papa('onToilet'), free, false, null)).toBe('idle');
    // Story 7.12, D3: a debris is picked up with its own gesture.
    expect(papaClipOf(papa('pickingUp'), free, false, null)).toBe('pick_up');
  });

  it("plays the station's loop at a chore, and idle at a station that has none (story 7.12, D2)", () => {
    const free = baby('babble');
    expect(papaClipOf(papa('chore'), free, false, 'stir_pot')).toBe('stir_pot');
    expect(papaClipOf(papa('chore'), free, false, null)).toBe('idle');
    // The chore clip is read in the chore state only.
    expect(papaClipOf(papa('idle'), free, false, 'stir_pot')).toBe('idle');
    expect(papaClipOf(papa('walkPath'), free, false, 'stir_pot')).toBe('walk');
  });

  it("has the carried variants, read from the baby's state alone", () => {
    const carried = baby('carried');
    expect(papaClipOf(papa('idle'), carried, false, null)).toBe('carry_idle');
    expect(papaClipOf(papa('walkPath'), carried, false, null)).toBe('carry_walk');
    expect(papaClipOf(papa('walkDir'), carried, false, null)).toBe('carry_walk');
    expect(papaClipOf(papa('glide'), carried, false, null)).toBe('glide');
  });

  it('picks a debris up with the baby held: carry_idle, not the free-handed gesture (story 7.12, review)', () => {
    expect(papaClipOf(papa('pickingUp'), baby('babble'), false, null)).toBe('pick_up');
    expect(papaClipOf(papa('pickingUp'), baby('carried'), false, null)).toBe('carry_idle');
  });

  it('walks on tiptoe in a stealth step, and only the walk changes (story 7.11, D5)', () => {
    const free = baby('babble');
    expect(papaClipOf(papa('walkPath'), free, true, null)).toBe('tiptoe');
    expect(papaClipOf(papa('walkDir'), free, true, null)).toBe('tiptoe');
    expect(papaClipOf(papa('idle'), free, true, null)).toBe('idle');
    expect(papaClipOf(papa('glide'), free, true, null)).toBe('glide');
    // Outside a stealth step nothing plays the tiptoe.
    for (const state of Object.keys(PAPA_TRAVELLING) as PapaSlice['state'][]) {
      expect(papaClipOf(papa(state), free, false, null)).not.toBe('tiptoe');
      expect(papaClipOf(papa(state), baby('carried'), true, null)).not.toBe('tiptoe');
    }
  });
});

describe("Papa's acting one-shots and their cut (story 7.11, D1, D12)", () => {
  it('lists the three idles in order, then the start and the brake, all in the contract', () => {
    expect([...PAPA_IDLE_CLIPS]).toEqual(['idle_scratch', 'idle_neck', 'idle_stretch']);
    expect([...PAPA_ACTING_CLIPS].sort()).toEqual(
      [
        'idle_neck',
        'idle_scratch',
        'idle_stretch',
        'walk_start',
        'walk_stop',
        'sigh_relief',
      ].sort(),
    );
    const contract: readonly string[] = PAPA_CONTRACT.clips;
    for (const clip of PAPA_ACTING_CLIPS) expect(contract, clip).toContain(clip);
    expect(contract).toContain('tiptoe');
    expect(PAPA_CONTRACT.hiddenNodes).toContain('papa_cheeks');
  });

  it('keeps the reactions reduced motion plays among the acting clips, all in the contract', () => {
    expect(PAPA_REACTION_CLIPS.length).toBeGreaterThan(0);
    for (const clip of PAPA_REACTION_CLIPS) expect(PAPA_ACTING_CLIPS, clip).toContain(clip);
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
    expect(babyClipOf(baby('wander'), false)).toBe('crawl');
    expect(babyClipOf(baby('approach'), false)).toBe('crawl');
    expect(babyClipOf(baby('babble'), false)).toBe('babble');
    expect(babyClipOf(baby('targetLocked'), false)).toBe('locked');
    expect(babyClipOf(baby('act'), false)).toBe('act');
    expect(babyClipOf(baby('mischiefSilent'), false)).toBe('sneak');
    expect(babyClipOf(baby('carried'), false)).toBe('carried');
  });

  it('pauses on all fours while stopped and paused, then babbles (story 7.12, D7)', () => {
    expect(babyClipOf(baby('babble'), true)).toBe('crawl_pause');
    expect(babyClipOf(baby('babble'), false)).toBe('babble');
    // Only a stop pauses: every other state keeps its loop, and a cry wins.
    expect(babyClipOf(baby('downstairs'), true)).toBe('babble');
    expect(babyClipOf(baby('wander'), true)).toBe('crawl');
    expect(babyClipOf(baby('targetLocked'), true)).toBe('locked');
    expect(babyClipOf(baby('babble', 5000), true)).toBe('cry');
  });

  it('cries over any state while the timer runs', () => {
    for (const state of ['wander', 'babble', 'carried'] as const) {
      expect(babyClipOf(baby(state, 5000), false), state).toBe('cry');
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
    expect(responseClipOf('parry', 'success', 0)).toBe('respond_parry');
    expect(responseClipOf('wait', 'success', 0)).toBe('respond_parry');
    expect(responseClipOf('firm', 'success', 0)).toBe('respond_firm');
    expect(responseClipOf('firm', 'perfect', 0)).toBe('respond_perfect');
    expect(responseClipOf('nothing', 'success', 0)).toBeNull();
  });

  it('plays the Parry the variant names, for a Parry success alone (story 7.12, D4)', () => {
    expect([...PAPA_PARRY_CLIPS]).toEqual(['respond_parry', 'respond_parry_sweep']);
    expect(responseClipOf('parry', 'success', 1)).toBe('respond_parry_sweep');
    expect(responseClipOf('parry', 'success', 0)).toBe('respond_parry');
    // A variant out of the list is the first Parry; a perfect, a Firmness, a wait keep their pose.
    expect(responseClipOf('parry', 'success', 2)).toBe('respond_parry');
    expect(responseClipOf('parry', 'perfect', 1)).toBe('respond_perfect');
    expect(responseClipOf('firm', 'success', 1)).toBe('respond_firm');
    expect(responseClipOf('wait', 'success', 1)).toBe('respond_parry');
    const contract: readonly string[] = PAPA_CONTRACT.clips;
    for (const clip of PAPA_PARRY_CLIPS) expect(contract, clip).toContain(clip);
  });

  it("lists the baby's acting one-shots and laughs, all in his contract (story 7.12)", () => {
    expect([...BABY_IDLE_CLIPS]).toEqual(['clap']);
    expect([...BABY_ACTING_CLIPS]).toEqual(['sit_down', 'clap']);
    expect([...BABY_LAUGH_CLIPS]).toEqual(['laugh', 'laugh_belly']);
    const contract: readonly string[] = BABY_CONTRACT.clips;
    for (const clip of [...BABY_ACTING_CLIPS, ...BABY_LAUGH_CLIPS, 'crawl_pause']) {
      expect(contract, clip).toContain(clip);
    }
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
