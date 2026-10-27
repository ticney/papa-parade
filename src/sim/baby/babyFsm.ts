import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * `wander`: crawling to a destination. `babble`: sitting still and babbling until `wanderAt`. Later
 * stories add `targetLocked`, `approach`, `act` (1.10), `mischiefSilent` (1.21), `carried` (4.1) and
 * `gagRecovery`: each adds its state here, to `BABY_STATES` in `snapshot.ts` and to the system.
 */
export type BabyState = 'wander' | 'babble';

/**
 * The only way to change `world.baby.state` (same pattern as `enterPapaState`): does nothing when
 * `next` is the current state, else records `enteredAt` and emits `BabyStateChanged`.
 */
export function enterBabyState(world: World, ctx: StepContext, next: BabyState): void {
  const { baby } = world;
  if (baby.state === next) return;
  const from = baby.state;
  baby.state = next;
  baby.enteredAt = world.time.sim;
  ctx.events.push({ type: 'BabyStateChanged', t: world.time.sim, from, to: next });
}
