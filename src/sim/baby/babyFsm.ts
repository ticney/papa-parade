import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * `wander`: crawling to a destination. `babble`: sitting still and babbling until `wanderAt`.
 * `targetLocked`: staring, still, at the threat the director targeted (the telegraph). `approach`:
 * crawling to it. `act`: playing its mischief after a gag. `mischiefSilent` (story 1.21): off to,
 * then hidden in, the zone of a suspicious silence, until Papa finds it or the mischief comes. Later
 * stories add `carried` (4.1) and `gagRecovery`: each adds its state here, to `BABY_STATES` in
 * `snapshot.ts` and to the system.
 */
export type BabyState =
  | 'wander'
  | 'babble'
  | 'targetLocked'
  | 'approach'
  | 'act'
  | 'mischiefSilent';

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

/**
 * Whether a suspicious silence is under way: a threat is `hidden` (drawn, the baby not yet off to
 * it) or the baby is in one. Pure. The director draws nothing else meanwhile (story 1.21).
 */
export function isSilenceUnderway(world: World): boolean {
  if (world.silence.threatId !== null) return true;
  for (let i = 0; i < world.threats.length; i++) {
    if (world.threats[i]?.state === 'hidden') return true;
  }
  return false;
}

/**
 * Whether the baby is free to take a new errand: wandering or babbling, locked on no threat, in no
 * silence. Pure. The director draws a suspicious silence only then (story 1.21).
 */
export function isBabyFree(world: World): boolean {
  const { baby } = world;
  return (
    (baby.state === 'wander' || baby.state === 'babble') &&
    baby.targetThreatId === null &&
    !isSilenceUnderway(world)
  );
}
