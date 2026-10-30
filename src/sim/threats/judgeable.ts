import type { ThreatDef } from '@content/schemas/threat';
import type { StepContext } from '../context.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import type { World } from '../world.ts';

/**
 * Whether a threat of `def` telegraphed at `now` could still be judged before `endMs` (the level's
 * `durationMs` by default; a sequence's `endsAt` too, story 4.4): its delay, its window (at the
 * player's tier) and the tolerance fit before it. A threat the sim
 * spawns on Papa (the micro-sleep, the cry in the arms) checks it first: one that could not be
 * judged would show a telegraph that never resolves. Pure.
 */
export function isJudgeableBeforeEnd(
  world: World,
  ctx: StepContext,
  def: ThreatDef,
  now: number,
  endMs: number = ctx.level.durationMs,
): boolean {
  const { timing } = ctx.feel;
  const judgedByMs =
    now +
    (def.telegraphDelayMs ?? timing.telegraphDelayDefaultMs) +
    (def.windowMs ?? timing.windowMs) * activeDifficulty(world, ctx).windowMultiplier +
    timing.toleranceMs;
  return judgedByMs <= endMs;
}
