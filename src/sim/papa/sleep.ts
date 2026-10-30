import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { finishCoffee } from './coffee.ts';
import { enterPapaState } from './papaFsm.ts';

/**
 * Papa falls asleep for `feel.fatigue.asleepMs` (story 1.19 D10): the consequence of a missed
 * micro-sleep. He drops his path, his glide, his direction and the object he was walking to, and
 * answers nothing until `busyUntil`. Falling asleep during a coffee cancels it: no `CoffeeDrunk`,
 * no −40, because `drink` is replaced and only `drink` finishes a coffee. Unless the coffee is
 * over this very step (`now >= busyUntil`, which `runPapa` has not recorded yet because
 * `runThreats` runs first): then it is finished first, and Papa falls asleep after it.
 */
export function putPapaToSleep(world: World, ctx: StepContext): void {
  const { papa } = world;
  if (papa.state === 'drink' && world.time.sim >= papa.busyUntil) finishCoffee(world, ctx);
  papa.path.length = 0;
  papa.pathIndex = 0;
  papa.glide = null;
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  papa.objectId = null;
  papa.intent = 'none';
  papa.busyUntil = asSimMs(world.time.sim + ctx.feel.fatigue.asleepMs);
  enterPapaState(world, ctx, 'asleep');
}
