import type { Emitter } from '@shared/emitter';
import { invariant } from '@shared/invariant';
import type { ClientEvents } from './clientEvents.ts';

export type AppState = 'boot' | 'start' | 'calibration' | 'loading' | 'level' | 'result' | 'oops';

/**
 * Which screen may follow which. Data, not code: later stories add rows and entries (`settings`,
 * `fridge`; story 2.8 adds `settings → calibration → settings`) and never remove or change these.
 * `start → loading` stays legal: it is the path of a returning player, and the autoplay's.
 * `calibration` (story 2.7) is the first launch's detour, and a recalibration's later.
 */
export const APP_TRANSITIONS: Readonly<Record<AppState, readonly AppState[]>> = {
  boot: ['start'],
  start: ['loading', 'calibration'],
  calibration: ['loading', 'oops'],
  loading: ['level', 'oops'],
  level: ['loading', 'result', 'oops'], // loading: « Recommencer »
  result: ['loading'],
  oops: ['loading'], // « Réessayer »
};

export interface AppFsm {
  readonly state: AppState;
  /** Moves to `next`: a programmer error if the table does not allow it. Entering the current state does nothing. */
  enter(next: AppState): void;
}

export interface AppFsmOptions {
  events: Emitter<ClientEvents>;
  /** Default: `APP_TRANSITIONS`. Tests pass an extended table. */
  transitions?: Readonly<Record<string, readonly string[]>>;
}

/**
 * The flow of the app. Same pattern as the sim's `enter…State`: the state changes only through
 * `enter`, which emits the event. There is no `enteredAt`: the app has no sim clock.
 */
export function createAppFsm(options: AppFsmOptions): AppFsm {
  const { events } = options;
  const transitions = options.transitions ?? APP_TRANSITIONS;
  let state: AppState = 'boot';

  return {
    get state() {
      return state;
    },
    enter(next) {
      if (next === state) return;
      const allowed = transitions[state] ?? [];
      invariant(allowed.includes(next), `app cannot go from "${state}" to "${next}"`);
      const from = state;
      state = next;
      events.emit('AppStateChanged', { from, to: next });
    },
  };
}
