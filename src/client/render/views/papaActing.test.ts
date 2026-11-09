import type { BabySlice, PapaSlice } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  actingMix32,
  createIdleSlot,
  type IdleSlot,
  type IdlesConfig,
  idleSlotAt,
  isPapaIdleEligible,
  nextParryVariantOf,
  PAPA_IDLE_SALT,
  PAPA_PARRY_SALT,
  passageOneShotOf,
  type StartStopConfig,
} from './papaActing.ts';

const CADENCE: IdlesConfig = { firstAfterMs: 4000, gapMinMs: 5000, gapMaxMs: 8000 };
const START_STOP: StartStopConfig = { startMinStillMs: 300, brakeMinTravelMs: 400 };
const VARIANTS = 3;

/** Every slot of a still spell up to `untilMs`, in order, read as the view reads them: the latest at each ms step. */
function slotsOf(
  seed: number,
  stillSinceAt: number,
  untilMs: number,
  cadence: IdlesConfig = CADENCE,
  stepMs = 10,
): { startAt: number; variant: number; index: number }[] {
  const out: { startAt: number; variant: number; index: number }[] = [];
  const slot = createIdleSlot();
  let lastIndex = -1;
  for (let t = stillSinceAt; t <= untilMs; t += stepMs) {
    idleSlotAt(seed, PAPA_IDLE_SALT, stillSinceAt, t, cadence, VARIANTS, slot);
    if (slot.index !== lastIndex) {
      out.push({ startAt: slot.startAt, variant: slot.variant, index: slot.index });
      lastIndex = slot.index;
    }
  }
  return out;
}

describe('nextParryVariantOf (story 7.12, D4)', () => {
  it('alternates: two Parries in a row never match', () => {
    for (let seed = 1; seed <= 50; seed++) {
      let last: number | null = null;
      for (let parry = 0; parry < 40; parry++) {
        const next = nextParryVariantOf(seed, last);
        if (last !== null) expect(next).not.toBe(last);
        last = next;
      }
    }
  });

  it("lets the level's seed pick the first: both variants open a level over the seeds", () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) firsts.add(nextParryVariantOf(seed, null));
    expect([...firsts].sort()).toEqual([0, 1]);
    // The seed's bit is actingMix32's, under the Parries' own salt.
    expect(nextParryVariantOf(7, null)).toBe(actingMix32(7, PAPA_PARRY_SALT, 0, 0) & 1);
  });

  it('gives the same variant for the same inputs, always 0 or 1', () => {
    for (const last of [null, 0, 1]) {
      const variant = nextParryVariantOf(3, last);
      expect(nextParryVariantOf(3, last)).toBe(variant);
      expect([0, 1]).toContain(variant);
    }
    expect(PAPA_PARRY_SALT).not.toBe(PAPA_IDLE_SALT);
  });
});

describe('actingMix32 (story 7.11, D8)', () => {
  it('gives the same value for the same inputs, an unsigned 32-bit integer', () => {
    const a = actingMix32(1, PAPA_IDLE_SALT, 4200, 3);
    expect(actingMix32(1, PAPA_IDLE_SALT, 4200, 3)).toBe(a);
    expect(Number.isInteger(a)).toBe(true);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(2 ** 32);
  });

  it('changes with each of its inputs', () => {
    const a = actingMix32(1, PAPA_IDLE_SALT, 4200, 3);
    expect(actingMix32(2, PAPA_IDLE_SALT, 4200, 3)).not.toBe(a);
    expect(actingMix32(1, PAPA_IDLE_SALT + 1, 4200, 3)).not.toBe(a);
    expect(actingMix32(1, PAPA_IDLE_SALT, 4210, 3)).not.toBe(a);
    expect(actingMix32(1, PAPA_IDLE_SALT, 4200, 4)).not.toBe(a);
  });

  it('spreads its values over the whole range', () => {
    const buckets = [0, 0, 0, 0];
    for (let k = 0; k < 4000; k++) buckets[Math.floor(actingMix32(7, 1, 0, k) / 2 ** 30)] += 1;
    for (const count of buckets) expect(count).toBeGreaterThan(800);
  });
});

describe('idleSlotAt (story 7.11, D8)', () => {
  it('has no slot before firstAfterMs, and the first at exactly firstAfterMs after the spell began', () => {
    const slot = createIdleSlot();
    idleSlotAt(1, PAPA_IDLE_SALT, 2000, 5990, CADENCE, VARIANTS, slot);
    expect(slot.index).toBe(-1);
    idleSlotAt(1, PAPA_IDLE_SALT, 2000, 6000, CADENCE, VARIANTS, slot);
    expect(slot).toEqual({ index: 0, startAt: 6000, variant: expect.any(Number) });
  });

  it('spaces the slots gapMinMs to gapMaxMs apart, start to start', () => {
    for (const seed of [1, 2, 3, 42, 9001]) {
      const slots = slotsOf(seed, 1230, 1230 + 600_000);
      expect(slots.length).toBeGreaterThan(70);
      for (let i = 1; i < slots.length; i++) {
        const gapMs = (slots[i] as IdleSlot).startAt - (slots[i - 1] as IdleSlot).startAt;
        expect(gapMs).toBeGreaterThanOrEqual(CADENCE.gapMinMs);
        expect(gapMs).toBeLessThanOrEqual(CADENCE.gapMaxMs);
      }
    }
  });

  it('never plays the same variant twice in a row, over 1,000 slots, many seeds and many spells', () => {
    const slot = createIdleSlot();
    for (let seed = 1; seed <= 20; seed++) {
      for (const stillSinceAt of [0, 10, 4560, 123_450]) {
        // The 1,000th slot's chain, read once: every variant before it in turn.
        let previous = -1;
        let previousIndex = -1;
        for (let t = stillSinceAt; ; t += CADENCE.gapMinMs) {
          idleSlotAt(seed, PAPA_IDLE_SALT, stillSinceAt, t, CADENCE, VARIANTS, slot);
          if (slot.index !== previousIndex && slot.index >= 0) {
            if (slot.index === previousIndex + 1) expect(slot.variant).not.toBe(previous);
            previous = slot.variant;
            previousIndex = slot.index;
          }
          if (slot.index >= (seed === 1 ? 1000 : 60)) break;
        }
      }
    }
  });

  it('plays all three variants, in about equal shares', () => {
    const counts = [0, 0, 0];
    for (let seed = 1; seed <= 30; seed++) {
      for (const { variant } of slotsOf(seed, 0, 300_000, CADENCE, 100)) counts[variant] += 1;
    }
    const total = counts[0] + counts[1] + counts[2];
    for (const count of counts) expect(count / total).toBeGreaterThan(0.25);
  });

  it('gives the same slots for the same inputs, and others for another seed or another spell', () => {
    expect(slotsOf(5, 700, 120_000)).toEqual(slotsOf(5, 700, 120_000));
    expect(slotsOf(6, 700, 120_000)).not.toEqual(slotsOf(5, 700, 120_000));
    expect(slotsOf(5, 710, 120_000).map((s) => s.variant)).not.toEqual(
      slotsOf(5, 700, 120_000).map((s) => s.variant),
    );
  });

  it('reads the same slot whatever the clock steps it is read at', () => {
    const fine = slotsOf(3, 0, 90_000, CADENCE, 10);
    // Read every 70 ms instead of every 10: the same slots, at the same instants.
    expect(slotsOf(3, 0, 90_000, CADENCE, 70)).toEqual(fine);
    const slot = createIdleSlot();
    for (const { startAt, variant, index } of fine) {
      idleSlotAt(3, PAPA_IDLE_SALT, 0, startAt + 1234, CADENCE, VARIANTS, slot);
      if (slot.index === index) expect(slot).toEqual({ index, startAt, variant });
    }
  });

  it('keeps a fixed gap when gapMinMs equals gapMaxMs', () => {
    const fixed = { firstAfterMs: 1000, gapMinMs: 3000, gapMaxMs: 3000 };
    const slots = slotsOf(9, 0, 30_000, fixed);
    expect(slots.map((s) => s.startAt)).toEqual([
      1000, 4000, 7000, 10_000, 13_000, 16_000, 19_000, 22_000, 25_000, 28_000,
    ]);
  });

  it('returns at once, with no slot, on a clock or a cadence that is not a finite number', () => {
    const slot = createIdleSlot();
    for (const [nowMs, cadence] of [
      [Number.NaN, CADENCE],
      [Number.POSITIVE_INFINITY, CADENCE],
      [60_000, { ...CADENCE, gapMinMs: Number.NaN }],
      [60_000, { ...CADENCE, gapMaxMs: Number.POSITIVE_INFINITY }],
    ] as const) {
      idleSlotAt(1, PAPA_IDLE_SALT, 0, nowMs, cadence, VARIANTS, slot);
      expect(slot.index).toBe(-1);
    }
  });

  it('reads a 10-minute still spell in bounded work, with nothing allocated', () => {
    const slot = createIdleSlot();
    const before = idleSlotAt(1, PAPA_IDLE_SALT, 0, 600_000, CADENCE, VARIANTS, slot);
    expect(before).toBe(slot);
    expect(slot.index).toBeLessThanOrEqual(600_000 / CADENCE.gapMinMs);
    expect(slot.index).toBeGreaterThanOrEqual(
      (600_000 - CADENCE.firstAfterMs) / CADENCE.gapMaxMs - 1,
    );
  });
});

const papa = (state: PapaSlice['state']) => ({ state }) as PapaSlice;
const baby = (state: BabySlice['state']) => ({ state }) as BabySlice;

describe('isPapaIdleEligible (story 7.11, D9)', () => {
  it('lets him idle standing, his hands free, outside the guard, motion on, no one-shot under way', () => {
    expect(isPapaIdleEligible(papa('idle'), baby('babble'), false, false, false)).toBe(true);
  });

  it.each([
    ['at a chore station', papa('chore'), baby('babble'), false, false, false],
    ['walking', papa('walkPath'), baby('babble'), false, false, false],
    ['picking up a debris', papa('pickingUp'), baby('babble'), false, false, false],
    ['drinking', papa('drink'), baby('babble'), false, false, false],
    ['with the baby in his arms', papa('idle'), baby('carried'), false, false, false],
    ['in a duel or stealth step', papa('idle'), baby('babble'), true, false, false],
    ['under reduced motion', papa('idle'), baby('babble'), false, true, false],
    ['while another one-shot is under way', papa('idle'), baby('babble'), false, false, true],
  ] as const)('refuses him %s', (_name, p, b, isGuarded, isReduced, hasOneShot) => {
    expect(isPapaIdleEligible(p, b, isGuarded, isReduced, hasOneShot)).toBe(false);
  });
});

describe('passageOneShotOf (story 7.11, D3, D4)', () => {
  it('starts a walk with a push-off after he stood still long enough, and only then', () => {
    expect(passageOneShotOf('idle', 'walk', 'walkPath', 300, START_STOP, false, false)).toBe(
      'walk_start',
    );
    expect(passageOneShotOf('idle', 'walk', 'walkDir', 299, START_STOP, false, false)).toBeNull();
  });

  it('brakes a walk into idle after he walked long enough, and only then', () => {
    expect(passageOneShotOf('walk', 'idle', 'idle', 400, START_STOP, false, false)).toBe(
      'walk_stop',
    );
    expect(passageOneShotOf('walk', 'idle', 'idle', 399, START_STOP, false, false)).toBeNull();
  });

  it.each([
    ['into a glide (a response)', 'idle', 'glide', 'glide'],
    ['out of a glide', 'glide', 'idle', 'idle'],
    ['carrying the baby, starting', 'carry_idle', 'carry_walk', 'walkPath'],
    ['carrying the baby, stopping', 'carry_walk', 'carry_idle', 'idle'],
    ['on tiptoe', 'idle', 'tiptoe', 'walkPath'],
    ['into a pick-up', 'walk', 'idle', 'pickingUp'],
    ['into a chore', 'walk', 'idle', 'chore'],
    ['into a drink', 'walk', 'drink', 'drink'],
    ['after a restart (no spell known)', null, 'walk', 'walkPath'],
  ] as const)('plays nothing %s', (_name, from, to, state) => {
    expect(passageOneShotOf(from, to, state, 5000, START_STOP, false, false)).toBeNull();
  });

  it('plays nothing in a duel or stealth step, under reduced motion, or with no spell known', () => {
    expect(passageOneShotOf('idle', 'walk', 'walkPath', 5000, START_STOP, true, false)).toBeNull();
    expect(passageOneShotOf('walk', 'idle', 'idle', 5000, START_STOP, false, true)).toBeNull();
    expect(passageOneShotOf('idle', 'walk', 'walkPath', null, START_STOP, false, false)).toBeNull();
  });
});
