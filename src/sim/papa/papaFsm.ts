import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * `walkPath`: following the waypoints of a tap. `walkDir`: pushed in a direction by keys or stick.
 * `glide`: sliding to a pressed threat (P3: choreography, the response was judged at the press).
 * `drink` (a coffee) and `asleep` (a missed micro-sleep) are the busy states (story 1.19 D6): Papa
 * answers nothing until `busyUntil`.
 */
export type PapaState = 'idle' | 'walkPath' | 'walkDir' | 'glide' | 'drink' | 'asleep';

/** Every `PapaState`, as data: a snapshot is checked against it. */
export const PAPA_STATES = [
  'idle',
  'walkPath',
  'walkDir',
  'glide',
  'drink',
  'asleep',
] as const satisfies readonly PapaState[];

type UnlistedPapaState = Exclude<PapaState, (typeof PAPA_STATES)[number]>;

/** Compile-time proof that `PAPA_STATES` holds every member of the union (see `THREAT_STATES_ARE_COMPLETE`). */
export const PAPA_STATES_ARE_COMPLETE: [UnlistedPapaState] extends [never]
  ? true
  : UnlistedPapaState = true;

/** Whether Papa is busy (`drink` or `asleep`): he ignores movement commands and presses until `busyUntil`. */
export function isPapaBusy(papa: { readonly state: PapaState }): boolean {
  return papa.state === 'drink' || papa.state === 'asleep';
}

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
