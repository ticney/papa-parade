import type { Settings } from '@content/schemas/save';
import type { AppState } from './appFsm.ts';

/**
 * Why the game was paused. `levelStart` is a pause that lasts one tick: a level always begins
 * through the resume countdown, so it is paused and resumed at once (the panel never shows).
 */
export type PauseReason =
  | 'visibilityHidden'
  | 'user'
  | 'portrait'
  | 'gamepadDisconnected'
  | 'levelStart';

/**
 * Events of the client itself (the sim has its own, `SimEvent`). The client systems that make
 * sound or vibrations subscribe to them: `PauseRequested` and `GameResumed` are what story 1.9
 * uses to suspend and resume the `AudioContext`.
 */
export interface ClientEvents {
  /** The loop stops stepping from now on. */
  PauseRequested: { reason: PauseReason };
  /** The 3 s countdown starts with the next frame. */
  ResumeRequested: Record<string, never>;
  /** The countdown is over: the game goes on at the same sim time. */
  GameResumed: Record<string, never>;
  /** The app moved to another screen (`appFsm`). */
  AppStateChanged: { from: AppState; to: AppState };
  /** The player's first gesture on the start screen. Story 1.9 unlocks the AudioContext here, synchronously. */
  StartGestureReceived: Record<string, never>;
  /**
   * The latency calibration ended and its result is in the save (story 2.7). The offsets are the
   * ones now applied to every input; `audioOffsetMs` equals `visualOffsetMs` when the audio phase was skipped.
   */
  CalibrationDone: { visualOffsetMs: number; audioOffsetMs: number; audioSkipped: boolean };
  /**
   * The player changed a setting (story 2.8). `settings` is the whole value, already in the save in
   * memory: the volumes follow it, the tier waits for the next game, the vibrations read it per pulse.
   */
  SettingsChanged: { settings: Settings };
  /** The digit of the resume countdown changed (including the first « 3 »). Story 1.9: tick sound and vibration. */
  CountdownTicked: { step: 3 | 2 | 1 };
}
