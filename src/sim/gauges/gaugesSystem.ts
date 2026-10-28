import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { addFatigue } from './fatigue.ts';
import { runFatigue } from './fatigueSystem.ts';

/**
 * System: the gauges (story 1.19), between `runPhysics` and `runFlow`. One system so that the noise
 * gauge (story 3.1) joins it: it calls the gauges' own helpers and never another system. First this
 * step's debug `SetFatigue` commands, then the fatigue's step.
 */
export function runGauges(world: World, ctx: StepContext): void {
  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command?.type === 'SetFatigue') {
      addFatigue(world, ctx, command.points - world.gauges.fatigue);
    }
  }
  runFatigue(world, ctx);
}
