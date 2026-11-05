import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';

/**
 * `walkPath`: following the waypoints of a tap. `walkDir`: pushed in a direction by keys or stick.
 * `glide`: sliding to a pressed threat (P3: choreography, the response was judged at the press).
 * `drink` (a coffee), `asleep` (a missed micro-sleep), `onPhone` (a call, story 1.20) and `onToilet`
 * (out of the room, story 4.3) are the busy states (story 1.19 D6): Papa answers nothing until `busyUntil`.
 * Story 3.15 adds three: `electrified` (the outlet's séquelle) and `carryingUp` (the stairs': the
 * baby is carried back up) are after-effect states, and `pickingUp` (a debris, a chosen occupation).
 * Story 9.4 adds `chore`: Papa works at a house chore's station. It is not busy (a chore gives way
 * to anything: a press, a tap, a séquelle), and the chore system pauses the chore when he leaves it.
 */
export type PapaState =
  | 'idle'
  | 'walkPath'
  | 'walkDir'
  | 'glide'
  | 'drink'
  | 'asleep'
  | 'onPhone'
  | 'onToilet'
  | 'electrified'
  | 'carryingUp'
  | 'pickingUp'
  | 'chore';

/** Every `PapaState`, as data: a snapshot is checked against it. */
export const PAPA_STATES = [
  'idle',
  'walkPath',
  'walkDir',
  'glide',
  'drink',
  'asleep',
  'onPhone',
  'onToilet',
  'electrified',
  'carryingUp',
  'pickingUp',
  'chore',
] as const satisfies readonly PapaState[];

type UnlistedPapaState = Exclude<PapaState, (typeof PAPA_STATES)[number]>;

/** Compile-time proof that `PAPA_STATES` holds every member of the union (see `THREAT_STATES_ARE_COMPLETE`). */
export const PAPA_STATES_ARE_COMPLETE: [UnlistedPapaState] extends [never]
  ? true
  : UnlistedPapaState = true;

/**
 * What a tapped walk does on arrival besides an object's action (story 4.1): `takeBaby` takes the
 * baby when he is then within reach, `putDownBaby` sets the carried baby down (in a safe zone).
 * `fetchBaby` (story 3.15) walks to a baby left at the bottom of the stairs and carries him up.
 */
export type PapaIntent = 'none' | 'takeBaby' | 'putDownBaby' | 'fetchBaby';

/** Every `PapaIntent`, as data: a snapshot is checked against it. */
export const PAPA_INTENTS = [
  'none',
  'takeBaby',
  'putDownBaby',
  'fetchBaby',
] as const satisfies readonly PapaIntent[];

type UnlistedPapaIntent = Exclude<PapaIntent, (typeof PAPA_INTENTS)[number]>;

/** Compile-time proof that `PAPA_INTENTS` holds every member of the union (see `PAPA_STATES_ARE_COMPLETE`). */
export const PAPA_INTENTS_ARE_COMPLETE: [UnlistedPapaIntent] extends [never]
  ? true
  : UnlistedPapaIntent = true;

/** One entry per `PapaState`: a new state must say whether it keeps Papa busy (a type error otherwise). */
const BUSY_PAPA_STATES: Readonly<Record<PapaState, boolean>> = {
  idle: false,
  walkPath: false,
  walkDir: false,
  glide: false,
  drink: true,
  asleep: true,
  onPhone: true,
  onToilet: true,
  electrified: true,
  carryingUp: true,
  pickingUp: true,
  chore: false,
};

/**
 * Whether Papa is busy (`drink`, `asleep`, `onPhone`, `onToilet`, `electrified`, `carryingUp` or
 * `pickingUp`): he ignores movement commands and presses until `busyUntil`.
 */
export function isPapaBusy(papa: { readonly state: PapaState }): boolean {
  return BUSY_PAPA_STATES[papa.state];
}

/**
 * Whether the state is a séquelle that occupies Papa (story 3.15, GDD mechanic 13): `electrified`,
 * `carryingUp` and `asleep`. They do not stack: a new one replaces the one under way without
 * extending it (`occupyPapa`). A chosen occupation (`drink`, `onPhone`, `onToilet`, `pickingUp`) is
 * not one, and a séquelle that lands on it cancels it.
 */
export function isAfterEffectState(
  state: PapaState,
): state is 'electrified' | 'carryingUp' | 'asleep' {
  return state === 'electrified' || state === 'carryingUp' || state === 'asleep';
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
