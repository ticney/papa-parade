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

/** A cue the feedback director played: what it drew and how it vibrated (story 2.4). */
export interface CuePlayedRecord {
  readonly cueId: string;
  /** The visual parts that actually ran, in order: `soundWave`, `flash`, `uiElement`. A skipped ring or flash is absent. */
  readonly visuals: readonly string[];
  /** The vibration kind the cue asks for, or `null`. */
  readonly haptic: string | null;
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
  /** Told each cue the feedback director has played, after all its parts (`onCue`). Do not keep the record. */
  onCuePlayed(listener: (record: CuePlayedRecord) => void): () => void;
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
  /**
   * What the debug overlay reads besides `onRenderedFrame` (story 2.1; the loop's timings and the
   * level's geometry come from `levelSession.loopStats` and `levelSession.active.geometry`).
   * Read-only towards the sim.
   *
   * A group in the running level's scene for the debug views to draw in, or `null` without a level.
   * It is part of the level's scene, so it goes with it: a new level has a new, empty one.
   */
  debugGroup(): Group | null;
  /** The icon points of the running level's threats as they are on the page now (a new array per call). */
  threatScreenPoints(): readonly ThreatScreenPoint[];
  /**
   * Plays the sound of the cue `cueId` of `feedback.json` once, its `audio` then its `layers`, and
   * nothing else: no ring, vibration or `onCue` (story 2.3 AC 14, the sound board). Returns `false`
   * and plays nothing when the audio context is not running (no gesture yet: a suspended one is
   * resumed by this call, so the next call plays), or the cue is unknown or has no sound; the
   * caller says so. A part that throws is a `warn` and the others still play.
   */
  auditionCue(cueId: string): boolean;
}
