import { GAUGE_MAX_POINTS, MS_PER_S, STEP_MS } from '@shared/constants';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * The only writer of `world.gauges.bladderPct` (story 4.3, the `addFatigue` pattern): the step's
 * gain, the visit's reset and the debug `SetBladder` all come through here. It holds the value in
 * `[0, 100]` silently, like the other gauges, and does nothing in a level with no need gauge
 * (nothing written, nothing emitted).
 *
 * `isBladderFull` is `bladderPct >= feel.bladder.slowFromPct`, recomputed on every call so that a
 * `SetFeel` that moves the threshold is seen at the next step. A change of it is recorded; only
 * the upward one emits `BladderFilled`, once per crossing.
 */
export function addBladder(world: World, ctx: StepContext, pct: number): void {
  if (!ctx.level.hasBladder) return;
  const { gauges } = world;
  gauges.bladderPct = Math.min(GAUGE_MAX_POINTS, Math.max(0, gauges.bladderPct + pct));
  const isFull = gauges.bladderPct >= ctx.feel.bladder.slowFromPct;
  if (isFull === gauges.isBladderFull) return;
  gauges.isBladderFull = isFull;
  if (isFull) ctx.events.push({ type: 'BladderFilled', t: world.time.sim });
}

/**
 * The need's own rise, called by `runGauges` after `runNoise`: `perSec` for one step. The gauge is
 * frozen while Papa is on the toilet (it falls at the end of the visit), and keeps rising during a
 * coffee, a nap or a call. No `world.rng` draw.
 */
export function runBladder(world: World, ctx: StepContext): void {
  if (!ctx.level.hasBladder || world.papa.state === 'onToilet') return;
  addBladder(world, ctx, (ctx.feel.bladder.perSec * STEP_MS) / MS_PER_S);
}

/**
 * The walking-speed factor of the need: `1 − slowdownPct / 100` while the gauge is full, else 1.
 * A pure reader of `isBladderFull` as the previous step's `runGauges` left it; a level without the
 * gauge never has it set, so its factor is exactly 1.
 */
export function bladderSpeedFactor(world: World, ctx: StepContext): number {
  return world.gauges.isBladderFull ? 1 - ctx.feel.bladder.slowdownPct / 100 : 1;
}
