import type { World } from '../world.ts';

/**
 * The level's flow: `playing` until the level's clock runs out, then `ended`. (Story E3's Retour
 * variant adds states between the two: the door, the final rush.)
 */
export type FlowState = 'playing' | 'ended';

/** Every `FlowState`, as data: a snapshot is checked against it. */
export const FLOW_STATES = ['playing', 'ended'] as const satisfies readonly FlowState[];

type UnlistedFlowState = Exclude<FlowState, (typeof FLOW_STATES)[number]>;

/** Compile-time proof that `FLOW_STATES` holds every member of the union (see `THREAT_STATES_ARE_COMPLETE`). */
export const FLOW_STATES_ARE_COMPLETE: [UnlistedFlowState] extends [never]
  ? true
  : UnlistedFlowState = true;

/**
 * The only writer of `flow.state` and `flow.enteredAt`. It emits nothing: `runFlow` does, with the
 * data the transition owns (`LevelEnded` carries its reason).
 */
export function enterFlowState(world: World, next: FlowState): void {
  world.flow.state = next;
  world.flow.enteredAt = world.time.sim;
}
