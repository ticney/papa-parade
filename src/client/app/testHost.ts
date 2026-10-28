import type { ContentBundle } from '@content/contentBundle';
import type { Sim, SimEvent } from '@sim';
import type { Group } from 'three';
import type { RenderStats } from '../render/renderer.ts';
import type { LevelSession, StartedLevel } from './levelSession.ts';
import type { PauseState } from './pauseController.ts';

/** Where a threat's icon point is on the page, in CSS px: the point the hit test measures from. */
export interface ThreatScreenPoint {
  readonly threatId: number;
  readonly xPx: number;
  readonly yPx: number;
}

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
  /** Set by autoplay: the input mapper sends nothing to the sim while true. */
  setGameInputBlocked(isBlocked: boolean): void;
  /**
   * What the debug overlay reads (story 2.1; the loop's timings and the level's geometry come from
   * `levelSession.loopStats` and `levelSession.active.geometry`). Read-only towards the sim.
   *
   * The last frame's draw calls and triangles (`renderer.info`).
   */
  renderStats(): Readonly<RenderStats>;
  /**
   * A group in the running level's scene for the debug views to draw in, or `null` without a level.
   * It is part of the level's scene, so it goes with it: a new level has a new, empty one.
   */
  debugGroup(): Group | null;
  /** The icon points of the running level's threats as they are on the page now (a new array per call). */
  threatScreenPoints(): readonly ThreatScreenPoint[];
}
