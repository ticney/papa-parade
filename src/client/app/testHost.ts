import type { ContentBundle } from '@content/contentBundle';
import type { Sim, SimEvent } from '@sim';
import type { AppState } from './appFsm.ts';
import type { LevelSession, StartedLevel } from './levelSession.ts';
import type { PauseState } from './pauseController.ts';

/**
 * What the debug code (autoplay, `window.__PP__`) may do to the app. Built by `boot.ts` only, in
 * debug builds only. The debug modules receive it and never reach into `boot.ts`; a test passes a
 * fake. No logic lives here.
 */
export interface TestHost {
  readonly content: ContentBundle;
  readonly levelSession: LevelSession;
  appState(): AppState;
  pauseState(): PauseState;
  /** The hook run before every step of the level loop; `null` removes it. One at a time. */
  setStepHook(hook: ((sim: Sim) => void) | null): void;
  /** Each `on…` returns its unsubscribe. */
  onLevelStarted(listener: (started: StartedLevel) => void): () => void;
  /** Told each event after the app has handled it (feedback, choreography, mirrors). Do not keep the event. */
  onSimEvent(listener: (event: SimEvent) => void): () => void;
  onGameResumed(listener: () => void): () => void;
  onAppStateChanged(listener: (to: AppState) => void): () => void;
  /** Set by autoplay: the input mapper sends nothing to the sim while true. */
  setGameInputBlocked(isBlocked: boolean): void;
}
