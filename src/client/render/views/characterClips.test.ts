import { asSimMs } from '@shared/time';
import type { BabySlice, GagId, PapaSlice, SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { GAG_PRESENTATIONS } from '../gags.ts';
import {
  BABY_CONTRACT,
  babyClipOf,
  babyLidsAfter,
  babyOneShotOf,
  PAPA_CONTRACT,
  papaClipOf,
  papaOneShotOf,
  responseClipOf,
} from './characterClips.ts';

const papa = (state: PapaSlice['state']) => ({ state }) as PapaSlice;
const baby = (state: BabySlice['state'], cryEndsAt: number | null = null) =>
  ({ state, cryEndsAt }) as BabySlice;
const t = asSimMs(1000);

describe('papaClipOf', () => {
  it('reads each state', () => {
    const free = baby('babble');
    expect(papaClipOf(papa('idle'), free)).toBe('idle');
    expect(papaClipOf(papa('walkPath'), free)).toBe('walk');
    expect(papaClipOf(papa('walkDir'), free)).toBe('walk');
    expect(papaClipOf(papa('glide'), free)).toBe('glide');
    expect(papaClipOf(papa('drink'), free)).toBe('drink');
    expect(papaClipOf(papa('asleep'), free)).toBe('asleep');
    expect(papaClipOf(papa('onPhone'), free)).toBe('on_phone');
    expect(papaClipOf(papa('onToilet'), free)).toBe('idle');
  });

  it("has the carried variants, read from the baby's state alone", () => {
    const carried = baby('carried');
    expect(papaClipOf(papa('idle'), carried)).toBe('carry_idle');
    expect(papaClipOf(papa('walkPath'), carried)).toBe('carry_walk');
    expect(papaClipOf(papa('walkDir'), carried)).toBe('carry_walk');
    expect(papaClipOf(papa('glide'), carried)).toBe('glide');
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

  it('reads the other events of D5', () => {
    expect(papaOneShotOf({ type: 'PapaBlocked', t, xM: 0, zM: 0 })).toBe('stumble');
    expect(papaOneShotOf({ type: 'PapaSnored', t })).toBe('snore');
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
