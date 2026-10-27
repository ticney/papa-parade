import { MIN_TIME_SCALE, STEP_MS } from '@shared/constants';
import { clampInvariant } from '@shared/invariant';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { updateTimeScale } from './slowMo.ts';

/**
 * System: advances the clock by one step, applies the `SetTimeScale` commands of this step to the
 * base scale, then republishes the effective scale (base scale and running slow-mos).
 */
export function advanceTime(world: World, ctx: StepContext): void {
  world.time.sim = asSimMs(world.time.sim + STEP_MS);
  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command?.type === 'SetTimeScale') {
      world.time.baseScale = clampInvariant(ctx, command.scale, MIN_TIME_SCALE, 1, 'time.scale');
    }
  }
  updateTimeScale(world, ctx);
}
