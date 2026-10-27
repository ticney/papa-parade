import { BOT_SEED_SALT } from '@shared/constants';

/** The seed of a bot's own RNG for a run seeded `runSeed`: a uint32 that is not the world's. */
export function botSeed(runSeed: number): number {
  return (runSeed ^ BOT_SEED_SALT) >>> 0;
}
