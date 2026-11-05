import type { ChoreInstance, World } from '../world.ts';

/**
 * The life of a house chore (story 9.4): `untouched` until Papa first works at its station,
 * `working` while he is there, `paused` when he left with beats still to do (the beats done are
 * kept), `done` for good once the last beat was caught. Stories 9.5 and 9.6 read `paused` and its
 * `enteredAt` (« casserole abandonnée plus de 30 s », « lave-vaisselle laissé ouvert »).
 */
export type ChoreState = 'untouched' | 'working' | 'paused' | 'done';

/** Every `ChoreState`, as data: a snapshot is checked against it. */
export const CHORE_STATES = [
  'untouched',
  'working',
  'paused',
  'done',
] as const satisfies readonly ChoreState[];

type UnlistedChoreState = Exclude<ChoreState, (typeof CHORE_STATES)[number]>;

/** Compile-time proof that `CHORE_STATES` holds every member of the union (see `THREAT_STATES_ARE_COMPLETE`). */
export const CHORE_STATES_ARE_COMPLETE: [UnlistedChoreState] extends [never]
  ? true
  : UnlistedChoreState = true;

/**
 * What the beat of a `working` chore is doing: `none` (no beat: not working, or done), `telegraph`
 * (announced, its ring shown until its window closes), `held` (withdrawn while a threat's window is
 * open, announced again afterwards).
 */
export type ChoreBeatState = 'none' | 'telegraph' | 'held';

/** Every `ChoreBeatState`, as data: a snapshot is checked against it. */
export const CHORE_BEAT_STATES = [
  'none',
  'telegraph',
  'held',
] as const satisfies readonly ChoreBeatState[];

type UnlistedChoreBeatState = Exclude<ChoreBeatState, (typeof CHORE_BEAT_STATES)[number]>;

/** Compile-time proof that `CHORE_BEAT_STATES` holds every member of the union. */
export const CHORE_BEAT_STATES_ARE_COMPLETE: [UnlistedChoreBeatState] extends [never]
  ? true
  : UnlistedChoreBeatState = true;

/**
 * The only writer of `chore.state` and `chore.enteredAt`. It emits nothing: the chore system does,
 * with the data each transition owns (as `enterDisruptionState` leaves the phone's events to its helpers).
 */
export function enterChoreState(world: World, chore: ChoreInstance, next: ChoreState): void {
  chore.state = next;
  chore.enteredAt = world.time.sim;
}
