import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { addFatigue } from './fatigue.ts';
import { runFatigue } from './fatigueSystem.ts';
import { addNoise } from './noise.ts';
import { runNoise } from './noiseSystem.ts';

/**
 * System: the gauges (story 1.19: fatigue, 3.1: noise), between `runPhysics` and `runFlow`. One
 * system: it calls the gauges' own helpers and never another system. First this step's debug
 * `SetFatigue` commands, then the fatigue's step, then the noise's (which reads the events the
 * systems before it made in this step), and last the debug `SetNoise` commands: the commanded
 * value is the one the gauge ends the step on (story 3.2: `runFlow` reads it right after, so
 * `SetNoise{pct: 100}` wakes Mama; applied before the decay it would end the step at 99.99).
 */
export function runGauges(world: World, ctx: StepContext): void {
  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command?.type === 'SetFatigue') {
      addFatigue(world, ctx, command.points - world.gauges.fatigue);
    }
  }
  runFatigue(world, ctx);
  runNoise(world, ctx);
  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command?.type === 'SetNoise') {
      addNoise(world, ctx, command.pct - world.gauges.noisePct, 'debug');
    }
  }
}
