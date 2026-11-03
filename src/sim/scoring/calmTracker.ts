import { STEP_MS } from '@shared/constants';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * The share of the played time the baby was calm (story 3.12, FR34), in `[0, 1]`: `calmMs` over
 * `playedMs`. A level that played no time at all (`playedMs` of 0) gives a share of 1: nothing
 * disturbed the baby. Pure.
 */
export function calmShareOf(calmMs: number, playedMs: number): number {
  if (playedMs <= 0) return 1;
  return Math.min(calmMs / playedMs, 1);
}

/**
 * The calm tracker (story 3.12, D4), called by `runScoring` once per step, after `runGauges` so that
 * it reads this step's noise: the step counts as calm, and adds `STEP_MS` to `world.score.calmMs`,
 * while the noise gauge is strictly below `feel.mama.calmNoiseThresholdPct` (« sous 50 % »). A level
 * with no noise gauge counts the steps where the baby is not crying instead. The step that ends the
 * level is counted (it runs before `runFlow`) and nothing after it: the world is frozen from
 * `LevelEnded` on, and only the systems of a live level run. One comparison per step, no draw,
 * no allocation.
 */
export function tickCalm(world: World, ctx: StepContext): void {
  const isCalm = ctx.level.hasNoise
    ? world.gauges.noisePct < ctx.feel.mama.calmNoiseThresholdPct
    : world.baby.cryEndsAt === null;
  if (isCalm) world.score.calmMs += STEP_MS;
}
