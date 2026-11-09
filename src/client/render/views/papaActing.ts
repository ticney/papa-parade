import type { BabySlice, PapaSlice } from '@sim';
import type { CharactersFeel } from './lifeLayer.ts';

// The « acting » of a character (story 7.11): when an idle comes, and whether a passage between two loops
// plays a start or a brake. Pure, no Three, no threat. Every choice is a function of the level's seed and of
// sim instants the world carries (D8): never real time, `Math.random` or the sim's own generator, and nothing
// remembered, so a replay from a snapshot shows the same idles at the same slots. Generic over a `salt`, so
// that another character's acting (the baby's clap, story 7.12) draws its own slots from the same seed.

/** `feel.json › characters.idles`, in sim ms. */
export type IdlesConfig = CharactersFeel['idles'];

/** `feel.json › characters.startStop`, in sim ms. */
export type StartStopConfig = CharactersFeel['startStop'];

/** Papa's salt in the idle draws: any fixed integer, distinct from another character's. */
export const PAPA_IDLE_SALT = 0x7a9a;

const UINT32_RANGE = 4_294_967_296;

/** One round of a murmur-style mix: `k` folded into `h`. Integers only, nothing allocated. */
function mixIn(h: number, k: number): number {
  let x = Math.imul(k | 0, 0xcc9e2d51);
  x = (x << 15) | (x >>> 17);
  x = Math.imul(x, 0x1b873593);
  let y = h ^ x;
  y = (y << 13) | (y >>> 19);
  return (Math.imul(y, 5) + 0xe6546b64) | 0;
}

/**
 * A 32-bit unsigned integer drawn from four integers (D8): the same inputs always give the same value,
 * and a change of any of them a different one. A murmur3 finalizer over the four. Allocates nothing.
 */
export function actingMix32(seed: number, salt: number, a: number, b: number): number {
  let h = mixIn(0x2545f491, seed);
  h = mixIn(h, salt);
  h = mixIn(h, a);
  h = mixIn(h, b);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** An idle slot of a still spell: its index in the spell (-1 when none has come yet), when it starts, which variant. */
export interface IdleSlot {
  index: number;
  /** Sim ms. */
  startAt: number;
  /** An index into the character's idle clips. */
  variant: number;
}

export function createIdleSlot(): IdleSlot {
  return { index: -1, startAt: 0, variant: 0 };
}

/**
 * The latest slot at or before `nowMs` of the still spell begun at `stillSinceAt` (D8), written to `out`:
 * slot 0 starts `firstAfterMs` after `stillSinceAt`; slot k + 1 starts `gapMinMs` to `gapMaxMs` (both
 * included) after slot k, drawn from `actingMix32(seed, salt, stillSinceAt, k)`; slot 0's variant is that
 * same draw modulo `variantsCount`, and each next one is one of the others, so that two in a row never
 * match. Walks the chain from slot 0: a still spell of 10 min is about 90 slots. Allocates nothing.
 */
export function idleSlotAt(
  seed: number,
  salt: number,
  stillSinceAt: number,
  nowMs: number,
  cadence: Readonly<IdlesConfig>,
  variantsCount: number,
  out: IdleSlot,
): IdleSlot {
  let startAt = stillSinceAt + cadence.firstAfterMs;
  out.index = -1;
  out.startAt = startAt;
  out.variant = 0;
  if (nowMs < startAt) return out;
  // A non-finite clock or cadence would never end the walk below, and this runs in the rAF path.
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(cadence.gapMinMs) ||
    !Number.isFinite(cadence.gapMaxMs)
  ) {
    return out;
  }
  const spanMs = Math.max(0, cadence.gapMaxMs - cadence.gapMinMs);
  let draw = actingMix32(seed, salt, stillSinceAt, 0);
  let variant = variantsCount > 0 ? draw % variantsCount : 0;
  let index = 0;
  for (;;) {
    const gapMs = Math.max(1, cadence.gapMinMs + Math.floor((draw / UINT32_RANGE) * (spanMs + 1)));
    const nextAt = startAt + gapMs;
    if (nextAt > nowMs) break;
    // One of the others: a step of 1 to `variantsCount - 1` from this one.
    const nextVariant =
      variantsCount > 1 ? (variant + 1 + ((draw >>> 1) % (variantsCount - 1))) % variantsCount : 0;
    index += 1;
    startAt = nextAt;
    variant = nextVariant;
    draw = actingMix32(seed, salt, stillSinceAt, index);
  }
  out.index = index;
  out.startAt = startAt;
  out.variant = variant;
  return out;
}

/**
 * Whether Papa may idle now (D9): standing (`idle`, never a chore station's `chore`), his hands free (the
 * baby not carried), outside a duel or stealth step (`isSignalOnly`), motion not reduced, and no other
 * one-shot under way (a response pose, a gag, a coffee kick, a brake).
 */
export function isPapaIdleEligible(
  papa: Readonly<PapaSlice>,
  baby: Readonly<BabySlice>,
  isSignalOnly: boolean,
  isMotionReduced: boolean,
  hasOneShot: boolean,
): boolean {
  return (
    papa.state === 'idle' &&
    baby.state !== 'carried' &&
    !isSignalOnly &&
    !isMotionReduced &&
    !hasOneShot
  );
}

/**
 * The start or the brake a passage between two loops plays (D3, D4), or null. `spellMs` is how long the
 * spell before it lasted, in sim ms (null when unknown, after a restart): still before a start, walking
 * before a brake. A start only from `idle` into `walk`, a brake only from `walk` into `idle` with Papa in
 * the `idle` state (an arrival into a pick-up, a chore or the toilet plays that state's clip as before). The
 * carried loops, the tiptoe and the glide are other clips: none of them has a start or a brake. Never in a
 * duel or stealth step, never under reduced motion (élan, D7).
 */
export function passageOneShotOf(
  fromClip: string | null,
  toClip: string,
  papaState: PapaSlice['state'],
  spellMs: number | null,
  startStop: Readonly<StartStopConfig>,
  isSignalOnly: boolean,
  isMotionReduced: boolean,
): 'walk_start' | 'walk_stop' | null {
  if (spellMs === null || isSignalOnly || isMotionReduced) return null;
  if (fromClip === 'idle' && toClip === 'walk' && spellMs >= startStop.startMinStillMs) {
    return 'walk_start';
  }
  if (
    fromClip === 'walk' &&
    toClip === 'idle' &&
    papaState === 'idle' &&
    spellMs >= startStop.brakeMinTravelMs
  ) {
    return 'walk_stop';
  }
  return null;
}
