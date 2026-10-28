import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { addFatigue } from '../gauges/fatigue.ts';
import type { World } from '../world.ts';
import { enterPapaState } from './papaFsm.ts';

/**
 * Papa arrived at a coffee machine (story 1.19 D7): he drinks for `coffeeDurationMs`, counted from
 * the arrival, and answers nothing meanwhile (D6). The fatigue only drops at the end.
 */
export function startCoffee(world: World, ctx: StepContext, objectId: string): void {
  const { papa } = world;
  const untilAt = asSimMs(world.time.sim + ctx.feel.fatigue.coffeeDurationMs);
  papa.objectId = null;
  papa.busyUntil = untilAt;
  enterPapaState(world, ctx, 'drink');
  ctx.events.push({ type: 'CoffeeStarted', t: world.time.sim, objectId, untilAt });
}

/** The coffee is drunk: `−coffeeReductionPoints` (held at 0), then Papa is idle again. */
export function finishCoffee(world: World, ctx: StepContext): void {
  addFatigue(world, ctx, -ctx.feel.fatigue.coffeeReductionPoints);
  world.papa.busyUntil = asSimMs(0);
  ctx.events.push({ type: 'CoffeeDrunk', t: world.time.sim, fatigue: world.gauges.fatigue });
  enterPapaState(world, ctx, 'idle');
}
