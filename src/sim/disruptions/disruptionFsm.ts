import type { DisruptionInstance, World } from '../world.ts';

/**
 * The life of a planned disruption (story 1.20): `pending` until its `atMs`, `ringing` while it
 * asks for an answer, then `answered` or `timedOut` for good. One life per level: it never rearms.
 */
export type DisruptionState = 'pending' | 'ringing' | 'answered' | 'timedOut';

/** Every `DisruptionState`, as data: a snapshot is checked against it. */
export const DISRUPTION_STATES = [
  'pending',
  'ringing',
  'answered',
  'timedOut',
] as const satisfies readonly DisruptionState[];

type UnlistedDisruptionState = Exclude<DisruptionState, (typeof DISRUPTION_STATES)[number]>;

/** Compile-time proof that `DISRUPTION_STATES` holds every member of the union (see `THREAT_STATES_ARE_COMPLETE`). */
export const DISRUPTION_STATES_ARE_COMPLETE: [UnlistedDisruptionState] extends [never]
  ? true
  : UnlistedDisruptionState = true;

/**
 * The only writer of `instance.state` and `instance.enteredAt`. It emits nothing: the phone helpers
 * do, with the data each transition owns (as `enterFlowState` leaves `LevelEnded` to `runFlow`).
 */
export function enterDisruptionState(
  world: World,
  instance: DisruptionInstance,
  next: DisruptionState,
): void {
  instance.state = next;
  instance.enteredAt = world.time.sim;
}
