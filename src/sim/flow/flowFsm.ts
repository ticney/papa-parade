import type { World } from '../world.ts';

/**
 * The level's flow: `playing` until the level's clock runs out or the noise wakes Mama (story 3.2),
 * then `ended`. `sequence` (story 4.4) is a stretch of play with its own rules: the level's timer
 * and noise still end it, so it goes to `ended` like `playing`. (Story E3's Retour variant adds
 * states between: the door, the final rush, stories 3.5 and 3.10.)
 */
export type FlowState = 'playing' | 'sequence' | 'ended';

/** Every `FlowState`, as data: a snapshot is checked against it. */
export const FLOW_STATES = ['playing', 'sequence', 'ended'] as const satisfies readonly FlowState[];

type UnlistedFlowState = Exclude<FlowState, (typeof FLOW_STATES)[number]>;

/** Compile-time proof that `FLOW_STATES` holds every member of the union (see `THREAT_STATES_ARE_COMPLETE`). */
export const FLOW_STATES_ARE_COMPLETE: [UnlistedFlowState] extends [never]
  ? true
  : UnlistedFlowState = true;

/**
 * Whether the level is still being played: `playing` or in a `sequence`, anything but `ended`. What
 * the phone, the bots, the autoplay, the input and the client's per-frame audio read, so that a
 * sequence does not stop them; the micro-sleep and the cry in the arms keep testing `playing`
 * (a sequence suspends them).
 */
export function isFlowLive(world: World): boolean {
  return world.flow.state !== 'ended';
}

/**
 * The only writer of `flow.state` and `flow.enteredAt`. It emits nothing: `runFlow` does, with the
 * data the transition owns (`LevelEnded` carries its reason).
 */
export function enterFlowState(world: World, next: FlowState): void {
  world.flow.state = next;
  world.flow.enteredAt = world.time.sim;
}
