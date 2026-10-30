import type { Feel } from '@content/schemas/feel';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * The difficulty entry the player's tier selects (`SetDifficultyTier`, story 2.8): the one reader
 * of `feel.difficulty` in the sim. It reads `ctx.feel`, so a level's `feelOverrides` and a live
 * `SetFeel` on the active tier both apply. Fatherly Instinct (story 2.9) reads `hasInstinct` here.
 */
export function activeDifficulty(world: World, ctx: StepContext): Feel['difficulty']['normal'] {
  return ctx.feel.difficulty[world.difficultyTier];
}
