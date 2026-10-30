import type { ThreatDef } from '@content/schemas/threat';
import { instinctWindowModifier } from '../assist/paternalInstinct.ts';
import type { StepContext } from '../context.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import type { World } from '../world.ts';

/**
 * Whether a threat of `def` telegraphed at `now` could still be judged before the level ends: its
 * delay, its window (at the player's tier, and with the instinct's bonus while it is active, as
 * `telegraphThreat` will freeze it, but not the fatigue's penalty, which only shrinks it: the check
 * errs on the side of judging) and the tolerance fit before `durationMs`. A threat the sim
 * spawns on Papa (the micro-sleep, the cry in the arms) checks it first: one that could not be
 * judged would show a telegraph that never resolves. Pure.
 */
export function isJudgeableBeforeEnd(
  world: World,
  ctx: StepContext,
  def: ThreatDef,
  now: number,
): boolean {
  const { timing } = ctx.feel;
  const judgedByMs =
    now +
    (def.telegraphDelayMs ?? timing.telegraphDelayDefaultMs) +
    (def.windowMs ?? timing.windowMs) *
      activeDifficulty(world, ctx).windowMultiplier *
      instinctWindowModifier(world, ctx) +
    timing.toleranceMs;
  return judgedByMs <= ctx.level.durationMs;
}
