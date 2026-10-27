import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { setTimeScale } from './timeScale.ts';

/** System: advances the clock by one step, then handles the time commands of this step. */
export function advanceTime(world: World, ctx: StepContext): void {
  world.time.sim = asSimMs(world.time.sim + STEP_MS);
  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command?.type === 'SetTimeScale') setTimeScale(world, ctx, command.scale);
  }
}
