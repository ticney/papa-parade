import { GAUGE_MAX_POINTS, NEUTRAL_WINDOW_MODIFIER } from '@shared/constants';
import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * How long until the next micro-sleep, in ms, drawn between `microSleepMinMs` and `microSleepMaxMs`.
 * One `nextFloat` even when min = max, so that the number of draws does not depend on the tuning.
 */
export function drawMicroSleepMs(world: World, ctx: StepContext): number {
  const { microSleepMinMs, microSleepMaxMs } = ctx.feel.fatigue;
  return microSleepMinMs + nextFloat(world.rng) * (microSleepMaxMs - microSleepMinMs);
}

/**
 * The only writer of `world.gauges.fatigue` (story 1.19 D5): the step's gain, a coffee, the
 * phone (story 1.20) and the debug `SetFatigue` all come through here, so every change runs the
 * threshold logic. It holds the value in `[0, 100]` silently: reaching the ends is gameplay, not a
 * bug (`clampInvariant` is for bugs). A level with no fatigue gauge has no fatigue system: nothing
 * changes, nothing is drawn, nothing is emitted.
 *
 * The rules apply strictly **above** the threshold (GDD « au-dessus de 70 »): at exactly 70 the
 * HUD gauge is already orange (« dès 70 », story 1.19 D12) but the sim has not changed. A crossing
 * emits `FatigueThresholdCrossed` once; on the way up it draws when the first micro-sleep is due
 * (one `nextFloat`), on the way down it cancels the pending one.
 */
export function addFatigue(world: World, ctx: StepContext, points: number): void {
  if (ctx.level.microSleepIndex < 0) return;
  const { gauges } = world;
  gauges.fatigue = Math.min(GAUGE_MAX_POINTS, Math.max(0, gauges.fatigue + points));
  const isAbove = gauges.fatigue > ctx.feel.fatigue.thresholdPoints;
  if (isAbove === gauges.isFatigueAbove) return;
  gauges.isFatigueAbove = isAbove;
  const now = world.time.sim;
  ctx.events.push({ type: 'FatigueThresholdCrossed', t: now, isAbove });
  gauges.microSleepAt = isAbove ? asSimMs(now + drawMicroSleepMs(world, ctx)) : null;
}

/**
 * The fatigue factor of a window (`base × tier × fatigue × instinct`): `1 − windowPenaltyPct / 100`
 * while Papa is strictly above the threshold, else 1. A pure reader of the value itself, not of
 * `isFatigueAbove`, and the window is frozen at the telegraph (1.10 D8), so a crossing later never
 * moves one. Which value a threat sees depends on the system order: the micro-sleep is telegraphed
 * by `runFatigue`, after this step's gain, so it gets the shrunk window in the very step of the
 * crossing; a wave threat is telegraphed by `runDirector`, before `runGauges`, so it sees the
 * previous step's value. With `startPoints` above the threshold, the first threat therefore gets
 * the shrunk window before `FatigueThresholdCrossed` is emitted (at the end of step 1).
 */
export function fatigueWindowModifier(world: World, ctx: StepContext): number {
  if (ctx.level.microSleepIndex < 0) return NEUTRAL_WINDOW_MODIFIER;
  const { thresholdPoints, windowPenaltyPct } = ctx.feel.fatigue;
  return world.gauges.fatigue > thresholdPoints
    ? 1 - windowPenaltyPct / 100
    : NEUTRAL_WINDOW_MODIFIER;
}
