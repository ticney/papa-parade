import { asSimMs } from '@shared/time';
import type { BabySlice } from '@sim';
import { describe, expect, it } from 'vitest';
import {
  BABY_IDLE_SALT,
  BABY_LAUGH_SALT,
  isBabyClapEligible,
  isBabyPaused,
  isBabyRestShown,
  nextLaughVariantOf,
} from './babyActing.ts';
import { BABY_LAUGH_CLIPS } from './characterClips.ts';
import { actingMix32, PAPA_IDLE_SALT, PAPA_PARRY_SALT } from './papaActing.ts';

const SIT = { afterMs: 600 };
const baby = (
  state: BabySlice['state'],
  enteredAt = 1000,
  cryEndsAt: number | null = null,
): BabySlice =>
  ({
    state,
    enteredAt: asSimMs(enteredAt),
    cryEndsAt: cryEndsAt === null ? null : asSimMs(cryEndsAt),
  }) as BabySlice;

describe('isBabyRestShown (story 7.12, D7)', () => {
  it('shows his rest when he has stopped, outside a cry, the guard and reduced motion', () => {
    expect(isBabyRestShown(baby('babble'), false, false)).toBe(true);
    expect(isBabyRestShown(baby('babble', 1000, 5000), false, false)).toBe(false);
    expect(isBabyRestShown(baby('babble'), true, false)).toBe(false);
    expect(isBabyRestShown(baby('babble'), false, true)).toBe(false);
  });

  it('is a stop only: every other state keeps its loop, downstairs and locked included', () => {
    for (const state of [
      'wander',
      'approach',
      'targetLocked',
      'act',
      'mischiefSilent',
      'carried',
      'downstairs',
      'carriedUp',
    ] as const) {
      expect(isBabyRestShown(baby(state), false, false), state).toBe(false);
    }
  });
});

describe('isBabyPaused (story 7.12, D7)', () => {
  it('pauses on all fours until afterMs after the stop, and sits at exactly afterMs', () => {
    expect(isBabyPaused(baby('babble', 1000), 1000, SIT)).toBe(true);
    expect(isBabyPaused(baby('babble', 1000), 1599, SIT)).toBe(true);
    expect(isBabyPaused(baby('babble', 1000), 1600, SIT)).toBe(false);
  });

  it('never pauses with afterMs 0: he sits at once', () => {
    expect(isBabyPaused(baby('babble', 1000), 1000, { afterMs: 0 })).toBe(false);
  });
});

describe('isBabyClapEligible (story 7.12, D8)', () => {
  it('claps only seated, his rest shown, and nothing else of his under way', () => {
    expect(isBabyClapEligible(baby('babble', 1000), 1600, SIT, false, false, false)).toBe(true);
    // Still paused, another clip under way, the guard, reduced motion, a cry, another state: no.
    expect(isBabyClapEligible(baby('babble', 1000), 1599, SIT, false, false, false)).toBe(false);
    expect(isBabyClapEligible(baby('babble', 1000), 1600, SIT, false, false, true)).toBe(false);
    expect(isBabyClapEligible(baby('babble', 1000), 1600, SIT, true, false, false)).toBe(false);
    expect(isBabyClapEligible(baby('babble', 1000), 1600, SIT, false, true, false)).toBe(false);
    expect(isBabyClapEligible(baby('babble', 1000, 9000), 1600, SIT, false, false, false)).toBe(
      false,
    );
    expect(isBabyClapEligible(baby('wander', 1000), 1600, SIT, false, false, false)).toBe(false);
  });
});

describe('nextLaughVariantOf (story 7.12, D10)', () => {
  it("draws the first laugh from the level's seed: both open a level over the seeds", () => {
    const firsts = new Set<number>();
    for (let seed = 1; seed <= 50; seed++) firsts.add(nextLaughVariantOf(seed, null));
    expect([...firsts].sort()).toEqual([0, 1]);
    expect(nextLaughVariantOf(9, null)).toBe(
      actingMix32(9, BABY_LAUGH_SALT, 0, 0) % BABY_LAUGH_CLIPS.length,
    );
  });

  it('never gives the same laugh twice in a row, over 1,000 draws', () => {
    for (const seed of [1, 2, 3, 42]) {
      let last: number | null = null;
      for (let i = 0; i < 1000; i++) {
        const next = nextLaughVariantOf(seed, last);
        if (last !== null) expect(next).not.toBe(last);
        expect(next).toBeGreaterThanOrEqual(0);
        expect(next).toBeLessThan(BABY_LAUGH_CLIPS.length);
        last = next;
      }
    }
  });

  it('starts over from the seed: the same game gives the same laughs in the same order', () => {
    const play = (seed: number) => {
      const out: number[] = [];
      let last: number | null = null;
      for (let i = 0; i < 6; i++) {
        last = nextLaughVariantOf(seed, last);
        out.push(last);
      }
      return out;
    };
    expect(play(5)).toEqual(play(5));
  });

  it('has salts of its own', () => {
    const salts = new Set([BABY_IDLE_SALT, BABY_LAUGH_SALT, PAPA_IDLE_SALT, PAPA_PARRY_SALT]);
    expect(salts.size).toBe(4);
  });
});
