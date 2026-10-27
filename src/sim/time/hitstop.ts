import { clampInvariant, type InvariantContext } from '@shared/invariant';

/**
 * Remaining hitstop, in real ms. Lives outside `World`: it is a real-time artefact (a game
 * recorded in the client and replayed headless must hash the same).
 */
export interface FreezeState {
  remainingMs: number;
}

export function createFreezeState(): FreezeState {
  return { remainingMs: 0 };
}

/**
 * Overlapping requests keep the longest (story 1.14 owns the final overlap rule). A negative or
 * non-finite request is a bug of the caller: strict mode throws, otherwise it is reported and
 * ignored (clamping `Infinity` to a huge value would freeze the client forever).
 */
export function requestFreeze(state: FreezeState, ctx: InvariantContext, ms: number): void {
  if (!Number.isFinite(ms) || ms < 0) {
    clampInvariant(ctx, ms, 0, Number.MAX_VALUE, 'freeze.requestMs');
    return;
  }
  if (ms > state.remainingMs) state.remainingMs = ms;
}

/** Called by the client loop with the real time elapsed during a freeze. */
export function consumeFreeze(state: FreezeState, realMs: number): void {
  if (!(realMs > 0)) return;
  state.remainingMs = Math.max(0, state.remainingMs - realMs);
}
