/** Why the game was paused. Story 1.5 adds the panel; the reasons already name every cause. */
export type PauseReason = 'visibilityHidden' | 'user' | 'portrait' | 'gamepadDisconnected';

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
}
