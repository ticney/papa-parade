import type { Feel } from '@content/schemas/feel';
import { GAUGE_MAX_POINTS } from '@shared/constants';
import type { StepContext } from '../context.ts';
import type { NoiseSource } from '../events.ts';
import type { World } from '../world.ts';

/**
 * Holds the gauge in `[0, 100]` and returns the change that actually happened (after the clamp).
 * Reaching 0 or 100 is gameplay, not a bug (story 3.1 D6): the clamp is silent, like the fatigue's.
 */
function moveNoise(world: World, deltaPct: number): number {
  const { gauges } = world;
  const before = gauges.noisePct;
  gauges.noisePct = Math.min(GAUGE_MAX_POINTS, Math.max(0, before + deltaPct));
  return gauges.noisePct - before;
}

/**
 * The only writer of `world.gauges.noisePct` with `decayNoise` (story 3.1 D5, the `addFatigue`
 * pattern): every source event and the debug `SetNoise` come through here. It does nothing in a
 * level with no noise gauge. When the value really changed it emits `NoiseChanged{source,
 * noisePct, deltaPct}`, where `deltaPct` is the change after the clamp; a change of 0 (already at
 * 100, or a 0 tuning) emits nothing.
 */
export function addNoise(
  world: World,
  ctx: StepContext,
  deltaPct: number,
  source: NoiseSource,
): void {
  if (!ctx.level.hasNoise) return;
  const change = moveNoise(world, deltaPct);
  if (change === 0) return;
  ctx.events.push({
    type: 'NoiseChanged',
    t: world.time.sim,
    source,
    noisePct: world.gauges.noisePct,
    deltaPct: change,
  });
}

/**
 * The noise's own fall, `deltaPct` negative or 0, with no event: a 1 %/s decay at 10 ms a step
 * would be 100 events a second in every journal (story 3.1 D5). Readers that need the exact
 * value read `world.gauges.noisePct`.
 */
export function decayNoise(world: World, ctx: StepContext, deltaPct: number): void {
  if (!ctx.level.hasNoise) return;
  moveNoise(world, deltaPct);
}

/**
 * What a falling object costs, in % of the gauge (GDD: +5 to +15 %): `minPct` at `minImpulseNs`,
 * `maxPct` at `maxImpulseNs`, linear between and held outside. Pure.
 */
export function propImpactNoisePct(feel: Feel, impulseNs: number): number {
  const { minPct, maxPct, minImpulseNs, maxImpulseNs } = feel.noise.sources.propImpact;
  const ratio = (impulseNs - minImpulseNs) / (maxImpulseNs - minImpulseNs);
  return minPct + (maxPct - minPct) * Math.min(1, Math.max(0, ratio));
}
