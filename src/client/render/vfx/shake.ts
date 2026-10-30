import type { Object3D } from 'three';

/** z wobbles this many times as fast as x, so the shake does not trace a straight line. */
const SHAKE_Z_RATIO = 1.5;
const MS_PER_S = 1000;

export interface Shake {
  /**
   * Starts a shake from `startAtReal` (real ms) that wobbles at `frequencyHz`; a new one replaces
   * the one under way.
   */
  start(amplitudeM: number, durationMs: number, frequencyHz: number, startAtReal: number): void;
  /** Offsets the target for `nowReal` (real ms), and back to exactly zero once the shake is over. */
  update(nowReal: number): void;
  /** Ends the shake at once and puts the target back: the level is over and the loop no longer runs to finish it. */
  reset(): void;
  /** The current offset on x and z, in metres (the debug `fx()` reads it). */
  readonly offsetM: { readonly x: number; readonly z: number };
}

/**
 * A decaying, deterministic wobble of `target`'s position on the floor plane (no random number:
 * the same shake looks the same twice). It moves the scene's content root and never the camera, so
 * the framing and the world UI layer stay where they are. It runs on **real** time: the shake plays
 * during the hitstop, when the sim clock stands still (architecture L210).
 */
export function createShake(target: Object3D): Shake {
  let isActive = false;
  let amplitudeM = 0;
  let durationMs = 1;
  let frequencyHz = 1;
  let startAtReal = 0;
  const set = (x: number, z: number) => {
    target.position.x = x;
    target.position.z = z;
  };
  return {
    start(amplitude, duration, frequency, at) {
      isActive = true;
      amplitudeM = amplitude;
      durationMs = duration;
      frequencyHz = frequency;
      startAtReal = at;
    },
    update(nowReal) {
      if (!isActive) return;
      const elapsedMs = nowReal - startAtReal;
      if (elapsedMs >= durationMs) {
        isActive = false;
        set(0, 0);
        return;
      }
      if (elapsedMs < 0) {
        // Not started yet (or the clock went back): never leave the previous shake's offset on.
        set(0, 0);
        return;
      }
      const decay = amplitudeM * (1 - elapsedMs / durationMs);
      const phase = (2 * Math.PI * frequencyHz * elapsedMs) / MS_PER_S;
      set(decay * Math.sin(phase), decay * Math.sin(phase * SHAKE_Z_RATIO));
    },
    reset() {
      isActive = false;
      set(0, 0);
    },
    get offsetM() {
      return target.position;
    },
  };
}
