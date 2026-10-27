import { nextFloat, type RngState } from '@shared/rng';

/** A draw from the standard normal distribution (mean 0, sd 1), by Box–Muller; advances `rng` by two draws. */
export function nextGaussian(rng: RngState): number {
  // `1 - nextFloat` is in (0, 1]: the logarithm never sees 0.
  const u1 = 1 - nextFloat(rng);
  const u2 = nextFloat(rng);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}
