import type { ContentBundle } from '@content/contentBundle';
import type { Sim, SimEvent } from '@sim';
import type { RenderStats } from '../render/renderer.ts';
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
  pauseState(): PauseState;
  /** The hook run before every step of the level loop; `null` removes it. One at a time. */
  setStepHook(hook: ((sim: Sim) => void) | null): void;
  /** Each `on…` returns its unsubscribe. */
  onLevelStarted(listener: (started: StartedLevel) => void): () => void;
  /** Told each event after the app has handled it (feedback, choreography, mirrors). Do not keep the event. */
  onSimEvent(listener: (event: SimEvent) => void): () => void;
  onGameResumed(listener: () => void): () => void;
  /**
   * Told after each level frame is drawn (the world UI included), with the real time of the frame
   * (`performance.now()`) and the renderer's stats. Level frames only: the start and Result
   * screens draw no level frame. The stats object is reused by the next frame: do not keep it.
   */
  onRenderedFrame(
    listener: (frameAtReal: number, stats: Readonly<RenderStats>) => void,
  ): () => void;
  /** Set by autoplay: the input mapper sends nothing to the sim while true. */
  setGameInputBlocked(isBlocked: boolean): void;
}
