import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { addFatigue } from './fatigue.ts';
import { runFatigue } from './fatigueSystem.ts';
import { addNoise } from './noise.ts';
import { runNoise } from './noiseSystem.ts';

/**
 * System: the gauges (story 1.19: fatigue, 3.1: noise), between `runPhysics` and `runFlow`. One
 * system: it calls the gauges' own helpers and never another system. First this step's debug
 * `SetFatigue` and `SetNoise` commands, then the fatigue's step, then the noise's (which reads the
 * events the systems before it made in this step).
 */
export function runGauges(world: World, ctx: StepContext): void {
  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command?.type === 'SetFatigue') {
      addFatigue(world, ctx, command.points - world.gauges.fatigue);
    } else if (command?.type === 'SetNoise') {
      addNoise(world, ctx, command.pct - world.gauges.noisePct, 'debug');
    }
  }
  runFatigue(world, ctx);
  runNoise(world, ctx);
}
