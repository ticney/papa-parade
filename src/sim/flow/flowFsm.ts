import type { World } from '../world.ts';

/**
 * The level's flow: `playing` until the level's clock runs out or the noise wakes Mama (story 3.2),
 * then `ended`. `sequence` (story 4.4) is a stretch of play with its own rules: the level's timer
 * and noise still end it, so it goes to `ended` like `playing`. `finalRush` (story 3.5) is the last
 * stretch of a level that opts in with `finalRush`: the door has opened, the play goes on without the
 * sequences, the micro-sleep and the cry in the arms, and the timer ends it on `photo`, the frozen
 * end of such a level (a `mamaWoke` in the rush still ends on `ended`). `ended` and `photo` are both
 * frozen: see {@link isFlowLive}.
 */
export type FlowState = 'playing' | 'sequence' | 'finalRush' | 'photo' | 'ended';

/** Every `FlowState`, as data: a snapshot is checked against it. */
export const FLOW_STATES = [
  'playing',
  'sequence',
  'finalRush',
  'photo',
  'ended',
] as const satisfies readonly FlowState[];

type UnlistedFlowState = Exclude<FlowState, (typeof FLOW_STATES)[number]>;

/** Compile-time proof that `FLOW_STATES` holds every member of the union (see `THREAT_STATES_ARE_COMPLETE`). */
export const FLOW_STATES_ARE_COMPLETE: [UnlistedFlowState] extends [never]
  ? true
  : UnlistedFlowState = true;

/**
 * Whether the level is still being played: `playing`, in a `sequence` or in the `finalRush`, anything
 * but the frozen `photo` and `ended`. What the phone, the bots, the autoplay, the input, the client's
 * per-frame audio and the sim's own `step()` read, so that a sequence or the rush does not stop them;
 * the micro-sleep and the cry in the arms keep testing `playing` (a sequence and the rush suspend them).
 */
export function isFlowLive(world: World): boolean {
  return world.flow.state !== 'ended' && world.flow.state !== 'photo';
}

/**
 * The only writer of `flow.state` and `flow.enteredAt`. It emits nothing: `runFlow` does, with the
 * data the transition owns (`LevelEnded` carries its reason).
 */
export function enterFlowState(world: World, next: FlowState): void {
  world.flow.state = next;
  world.flow.enteredAt = world.time.sim;
}
