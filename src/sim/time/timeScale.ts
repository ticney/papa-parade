import { MIN_TIME_SCALE } from '@shared/constants';
import { clampInvariant } from '@shared/invariant';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/** Sets `timeScale` (in `[MIN_TIME_SCALE, 1]`) and reports a change. Steps stay 10 ms of sim time. */
export function setTimeScale(world: World, ctx: StepContext, scale: number): void {
  const next = clampInvariant(ctx, scale, MIN_TIME_SCALE, 1, 'time.scale');
  const from = world.time.scale;
  if (next === from) return;
  world.time.scale = next;
  ctx.events.push({ type: 'TimeScaleChanged', t: world.time.sim, from, to: next });
}
