import type { BabySlice } from '@sim';
import { BABY_LAUGH_CLIPS } from './characterClips.ts';
import type { CharactersFeel } from './lifeLayer.ts';
import { actingMix32 } from './papaActing.ts';

// The baby's acting (story 7.12): his pause on all fours and his sit-down when he stops, his claps while he sits,
// and which of his laughs comes next. Pure, no Three, no threat. Every choice is a function of the world (his
// state and its `enteredAt`), the level's seed and the sim clock, as Papa's acting is (story 7.11, D8); the
// laughs alone remember the last one (D10). The slots reuse `papaActing.ts › idleSlotAt` under his own salt.

/** `feel.json › characters.babySit`, in sim ms. */
export type BabySitConfig = CharactersFeel['babySit'];

/** `feel.json › characters.babyIdles`, in sim ms. */
export type BabyIdlesConfig = CharactersFeel['babyIdles'];

/** The baby's salt in the clap draws: any fixed integer, distinct from Papa's. */
export const BABY_IDLE_SALT = 0xb4b1;

/** The salt of his first laugh in a level (D10). */
export const BABY_LAUGH_SALT = 0xb4b2;

/**
 * Whether his rest is shown (D7): stopped (`babble`, today's « sitting and babbling until `wanderAt` »), not
 * crying, outside a duel or stealth step, motion not reduced. Otherwise his loop is today's from the first frame.
 */
export function isBabyRestShown(
  baby: Readonly<BabySlice>,
  isSignalOnly: boolean,
  isMotionReduced: boolean,
): boolean {
  return baby.state === 'babble' && baby.cryEndsAt === null && !isSignalOnly && !isMotionReduced;
}

/** Whether he is still on all fours at `simMs` (D7): until `babySit.afterMs` after he stopped. */
export function isBabyPaused(
  baby: Readonly<BabySlice>,
  simMs: number,
  babySit: Readonly<BabySitConfig>,
): boolean {
  return simMs < baby.enteredAt + babySit.afterMs;
}

/**
 * Whether he may clap now (D8): his rest shown, seated (his pause over), and no other clip of his under way (the
 * sit-down, a laugh, a stir).
 */
export function isBabyClapEligible(
  baby: Readonly<BabySlice>,
  simMs: number,
  babySit: Readonly<BabySitConfig>,
  isSignalOnly: boolean,
  isMotionReduced: boolean,
  hasOneShot: boolean,
): boolean {
  return (
    isBabyRestShown(baby, isSignalOnly, isMotionReduced) &&
    !isBabyPaused(baby, simMs, babySit) &&
    !hasOneShot
  );
}

/**
 * Which of `BABY_LAUGH_CLIPS` comes next (D10): the level's seed picks the first (`lastVariant` null, as after a
 * restart), then the other one, so that two laughs in a row never match.
 */
export function nextLaughVariantOf(seed: number, lastVariant: number | null): number {
  const count = BABY_LAUGH_CLIPS.length;
  if (lastVariant === null) return actingMix32(seed, BABY_LAUGH_SALT, 0, 0) % count;
  return (lastVariant + 1) % count;
}
