import type { ThreatDef } from '@content/schemas/threat';
import type { StepContext } from '../context.ts';

/**
 * Whether a threat of `def` telegraphed at `now` could still be judged before the level ends: its
 * delay, its window (at the normal tier) and the tolerance fit before `durationMs`. A threat the sim
 * spawns on Papa (the micro-sleep, the cry in the arms) checks it first: one that could not be
 * judged would show a telegraph that never resolves. Pure.
 */
export function isJudgeableBeforeEnd(ctx: StepContext, def: ThreatDef, now: number): boolean {
  const { timing, difficulty } = ctx.feel;
  const judgedByMs =
    now +
    (def.telegraphDelayMs ?? timing.telegraphDelayDefaultMs) +
    (def.windowMs ?? timing.windowMs) * difficulty.normal.windowMultiplier +
    timing.toleranceMs;
  return judgedByMs <= ctx.level.durationMs;
}
