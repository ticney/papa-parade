import { RESUME_COUNTDOWN_MS } from '@shared/constants';
import type { Emitter } from '@shared/emitter';
import { invariant } from '@shared/invariant';
import { log } from '@shared/log';
import type { RealMs } from '@shared/time';
import type { ClientEvents, PauseReason } from './clientEvents.ts';

export type PauseState = 'running' | 'paused' | 'resuming';

export interface PauseController {
  readonly state: PauseState;
  /** Real ms left before the game goes on: 0 unless `resuming`. Story 1.5 draws "3" "2" "1" from it. */
  readonly countdownRemainingMs: number;
  /** From `running` or `resuming` to `paused` (a countdown in progress is cancelled). Already paused: nothing. */
  requestPause(reason: PauseReason): void;
  /** Only from `paused`, to `resuming`; ignored otherwise. The countdown starts at the next `update`. */
  requestResume(): void;
  /** Called once per frame by the loop with the frame's real timestamp. */
  update(frameAtReal: RealMs): void;
}

export interface PauseControllerOptions {
  events: Emitter<ClientEvents>;
  /** Length of the resume countdown. Default: `RESUME_COUNTDOWN_MS`. */
  countdownMs?: number;
}

/**
 * The pause state machine. It never touches the sim: the loop reads `state` and stops stepping.
 * The countdown is counted in frame time (`update`), not with a timer, so tests drive it with a
 * list of timestamps. Every path to `running` goes through `resuming`: there is no way to skip
 * the countdown.
 */
export function createPauseController(options: PauseControllerOptions): PauseController {
  const { events } = options;
  const countdownMs = options.countdownMs ?? RESUME_COUNTDOWN_MS;
  invariant(
    Number.isFinite(countdownMs) && countdownMs >= 0,
    `pause countdownMs must be a finite number >= 0 (${countdownMs})`,
  );

  let state: PauseState = 'running';
  // Frame time at which the current countdown started (the first update after `requestResume`).
  let countdownStartAtReal: number | null = null;
  let lastUpdateAtReal = 0;

  return {
    get state() {
      return state;
    },
    get countdownRemainingMs() {
      if (state !== 'resuming') return 0;
      if (countdownStartAtReal === null) return countdownMs;
      return Math.max(0, countdownMs - (lastUpdateAtReal - countdownStartAtReal));
    },
    requestPause(reason) {
      if (state === 'paused') return;
      state = 'paused';
      countdownStartAtReal = null;
      events.emit('PauseRequested', { reason });
    },
    requestResume() {
      if (state !== 'paused') {
        if (log.enabled('debug')) log.debug('boot', `requestResume ignored while ${state}`);
        return;
      }
      state = 'resuming';
      countdownStartAtReal = null;
      events.emit('ResumeRequested', {});
    },
    update(frameAtReal) {
      if (state !== 'resuming') return;
      // A timestamp that is not a number would poison the start time and the countdown would
      // never end. The loop already warns about it.
      if (!Number.isFinite(frameAtReal)) return;
      if (countdownStartAtReal === null) countdownStartAtReal = frameAtReal;
      lastUpdateAtReal = frameAtReal;
      if (frameAtReal - countdownStartAtReal >= countdownMs) {
        state = 'running';
        countdownStartAtReal = null;
        events.emit('GameResumed', {});
      }
    },
  };
}
