import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { addBladder } from '../gauges/bladder.ts';
import type { World } from '../world.ts';
import { enterPapaState } from './papaFsm.ts';

/**
 * Papa arrived at the toilet (story 4.3, modelled on {@link startCoffee}): he is out of the room
 * for `toiletDurationMs`, counted from the arrival, and answers nothing meanwhile. His point stays
 * where the walk ended, so he comes back where he left. The need is frozen until the end
 * (`runBladder`), and the room goes on without him.
 */
export function startToilet(world: World, ctx: StepContext, objectId: string): void {
  const { papa } = world;
  const untilAt = asSimMs(world.time.sim + ctx.feel.bladder.toiletDurationMs);
  papa.objectId = null;
  papa.intent = 'none';
  papa.busyUntil = untilAt;
  enterPapaState(world, ctx, 'onToilet');
  ctx.events.push({ type: 'ToiletStarted', t: world.time.sim, objectId, untilAt });
}

/**
 * The visit is over: the need falls to 0 (only now, like the coffee's fatigue), then Papa is idle
 * again. `runBladder` runs later in the step, so the gauge ends that step on one step's gain.
 */
export function finishToilet(world: World, ctx: StepContext): void {
  addBladder(world, ctx, -world.gauges.bladderPct);
  world.papa.busyUntil = asSimMs(0);
  ctx.events.push({ type: 'ToiletFinished', t: world.time.sim });
  enterPapaState(world, ctx, 'idle');
}
