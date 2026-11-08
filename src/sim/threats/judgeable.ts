import type { ThreatDef } from '@content/schemas/threat';
import type { StepContext } from '../context.ts';
import { heldSpanMs, plannedWindowMs } from '../director/fairness.ts';
import type { World } from '../world.ts';

/**
 * Whether a threat of `def` telegraphed at `now` could still be judged before `endMs` (the level's
 * `durationMs` by default; a sequence's `endsAt` too, story 4.4): its delay, its window (at the
 * player's tier, and with the instinct's bonus while it is active, as `telegraphThreat` will freeze
 * it, but not the fatigue's penalty, which only shrinks it: the check errs on the side of judging)
 * and the tolerance fit before it. A threat the sim
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
  const delayMs = def.telegraphDelayMs ?? timing.telegraphDelayDefaultMs;
  if (def.response === 'nothing') {
    // A `nothing` counts `nothingMs`, which no tier, fatigue or instinct scales (story 4.9), and has no tolerance.
    return now + delayMs + (def.nothingMs ?? 0) <= endMs;
  }
  // A Firmness is judged when its hold ends, not when its window closes (story 9.7 review).
  const windowMs = plannedWindowMs(world, ctx, def);
  const answerMs = windowMs + timing.toleranceMs;
  const holdMs = heldSpanMs(def, windowMs, timing.toleranceMs, ctx.feel.input.holdMinMs);
  const judgedByMs = now + delayMs + (def.maxDelayMs ?? 0) + Math.max(answerMs, holdMs);
  return judgedByMs <= endMs;
}
