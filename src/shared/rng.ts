import { RNG_WARMUP_ROUNDS, UINT32_RANGE } from './constants.ts';
import { invariant } from './invariant.ts';

/** sfc32 state: four int32. Plain data, so it lives in `World` and survives a JSON round-trip. */
export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** sfc32 (public domain, bryc). Mutates `rng` in place and returns a uint32. */
export function nextUint32(rng: RngState): number {
  const t = (((rng.a + rng.b) | 0) + rng.d) | 0;
  rng.d = (rng.d + 1) | 0;
  rng.a = rng.b ^ (rng.b >>> 9);
  rng.b = (rng.c + (rng.c << 3)) | 0;
  rng.c = (rng.c << 21) | (rng.c >>> 11);
  rng.c = (rng.c + t) | 0;
  return t >>> 0;
}

/** `seed` is an integer in `[0, 2**32)`. The seeding scheme is part of every golden reference. */
export function createRng(seed: number): RngState {
  invariant(
    Number.isInteger(seed) && seed >= 0 && seed < UINT32_RANGE,
    `seed must be an integer in [0, 2**32), got ${seed}`,
  );
  const rng: RngState = { a: 0x9e3779b9 | 0, b: 0x243f6a88 | 0, c: 0xb7e15162 | 0, d: seed | 0 };
  for (let i = 0; i < RNG_WARMUP_ROUNDS; i++) nextUint32(rng);
  return rng;
}

/** A float in `[0, 1)`. */
export function nextFloat(rng: RngState): number {
  return nextUint32(rng) / UINT32_RANGE;
}

/**
 * An integer in `[minInclusive, maxExclusive)`. The range is at most 2**32: `nextFloat` has a
 * 32-bit resolution, so a wider range would leave gaps.
 */
export function nextInt(rng: RngState, minInclusive: number, maxExclusive: number): number {
  invariant(
    Number.isInteger(minInclusive) && Number.isInteger(maxExclusive) && minInclusive < maxExclusive,
    `nextInt needs integers with min < max, got [${minInclusive}, ${maxExclusive})`,
  );
  invariant(
    maxExclusive - minInclusive <= UINT32_RANGE,
    `nextInt range is wider than 2**32: [${minInclusive}, ${maxExclusive})`,
  );
  return minInclusive + Math.floor(nextFloat(rng) * (maxExclusive - minInclusive));
}
