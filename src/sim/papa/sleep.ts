import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { enterPapaState } from './papaFsm.ts';

/**
 * Papa falls asleep for `feel.fatigue.asleepMs` (story 1.19 D10): the consequence of a missed
 * micro-sleep. He drops his path, his glide, his direction and the object he was walking to, and
 * answers nothing until `busyUntil`. Falling asleep during a coffee cancels it: no `CoffeeDrunk`,
 * no −40, because `drink` is replaced and only `drink` finishes a coffee.
 */
export function putPapaToSleep(world: World, ctx: StepContext): void {
  const { papa } = world;
  papa.path = [];
  papa.pathIndex = 0;
  papa.glide = null;
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  papa.objectId = null;
  papa.busyUntil = asSimMs(world.time.sim + ctx.feel.fatigue.asleepMs);
  enterPapaState(world, ctx, 'asleep');
}
