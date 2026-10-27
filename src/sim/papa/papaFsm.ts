import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/** `walkPath`: following the waypoints of a tap. `walkDir`: pushed in a direction by keys or stick. */
export type PapaState = 'idle' | 'walkPath' | 'walkDir';

/**
 * The only way to change `world.papa.state` (same pattern as the baby's `enterBabyState`): does
 * nothing when `next` is the current state, else records `enteredAt` and emits `PapaStateChanged`.
 */
export function enterPapaState(world: World, ctx: StepContext, next: PapaState): void {
  const { papa } = world;
  if (papa.state === next) return;
  const from = papa.state;
  papa.state = next;
  papa.enteredAt = world.time.sim;
  ctx.events.push({ type: 'PapaStateChanged', t: world.time.sim, from, to: next });
}
