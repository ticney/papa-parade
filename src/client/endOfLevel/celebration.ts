import type { CelebrationSettings } from '@content/schemas/feedback';
import { EPIC_STAMP_MAX_MS } from '@shared/constants';

// The level's finale on screen (story 7.4, D4): the cue `finale_reached` plays the choir, the ring on
// Papa, the flash and the fanfare; this module adds what a cue cannot hold: the fireworks over the room,
// the « MISSION ACCOMPLIE » stamp and the music muted while the choir sings. Real time throughout: it
// plays over the frozen room of a `cycleDone` end as well as in play. Boot owns the timing of the end.

/** What the celebration drives: the scene's fireworks and an Epic stamp of its own. */
export interface CelebrationDeps {
  /** Sets off the fireworks at `startAtReal` (`levelScene.startFireworks`). */
  startFireworks(
    settings: CelebrationSettings['fireworks'],
    startAtReal: number,
    isMotionReduced: boolean,
  ): void;
  /** When the last firework spark dies, in real ms, or null (`levelScene.fireworksEndAtReal`). */
  fireworksEndAtReal(): number | null;
  /** Hides every spark at once (`levelScene.stopFireworks`). */
  stopFireworks(): void;
  /** The finale's stamp (`createEpicStamp` with `t('stamp.finale')`). */
  readonly stamp: { show(durationMs: number, isMotionReduced: boolean): boolean; cancel(): void };
}

export interface Celebration {
  /** Starts the celebration at `atReal` (real ms), from `settings`. A second start restarts it. */
  start(settings: Readonly<CelebrationSettings>, atReal: number, isMotionReduced: boolean): void;
  /** Whether it still plays at `nowReal`: its fireworks are up, or its stamp. */
  isRunning(nowReal: number): boolean;
  /** Whether the level and sequence music give way to the choir at `nowReal` (`musicMuteMs`). */
  isMusicMuted(nowReal: number): boolean;
  /** When it ends, in real ms, or null when none was started (or after `reset`). */
  readonly endsAtReal: number | null;
  /**
   * Forgets it: the stamp is cancelled and the fireworks hidden (a restart, a loading, an error, and Mama
   * home early: a `mamaHome` is no finished level, so a finale before it is not celebrated on).
   */
  reset(): void;
}

/**
 * The celebration of one level. `start` is called on `FinaleReached`, at most once a level; the end of
 * the level reads `isRunning` to wait for it (D3). Allocates nothing per frame.
 */
export function createCelebration(deps: CelebrationDeps): Celebration {
  let startedAtReal: number | null = null;
  let endsAtReal: number | null = null;
  let musicMuteMs = 0;
  return {
    start(settings, atReal, isMotionReduced) {
      startedAtReal = atReal;
      musicMuteMs = settings.musicMuteMs;
      deps.startFireworks(settings.fireworks, atReal, isMotionReduced);
      const stampMs = Math.min(settings.stampMs, EPIC_STAMP_MAX_MS);
      deps.stamp.show(stampMs, isMotionReduced);
      endsAtReal = Math.max(deps.fireworksEndAtReal() ?? atReal, atReal + stampMs);
    },
    isRunning(nowReal) {
      return endsAtReal !== null && nowReal < endsAtReal;
    },
    isMusicMuted(nowReal) {
      return (
        startedAtReal !== null && nowReal >= startedAtReal && nowReal < startedAtReal + musicMuteMs
      );
    },
    get endsAtReal() {
      return endsAtReal;
    },
    reset() {
      startedAtReal = null;
      endsAtReal = null;
      musicMuteMs = 0;
      deps.stamp.cancel();
      deps.stopFireworks();
    },
  };
}
