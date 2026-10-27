import type { Object3D } from 'three';

/** Wobbles the shake makes on x over its duration; z wobbles `SHAKE_Z_RATIO` times as fast. */
const SHAKE_CYCLES = 4;
const SHAKE_Z_RATIO = 1.5;

export interface Shake {
  /** Starts a shake from `startAt` (sim ms); a new one replaces the one under way. */
  start(amplitudeM: number, durationMs: number, startAt: number): void;
  /** Offsets the target for `clockMs` (sim ms), and back to exactly zero once the shake is over. */
  update(clockMs: number): void;
}

/**
 * A decaying, deterministic wobble of `target`'s position on the floor plane (no random number:
 * the same shake looks the same twice). It moves the scene's content root and never the camera, so
 * the framing and the world UI layer stay where they are.
 */
export function createShake(target: Object3D): Shake {
  let isActive = false;
  let amplitudeM = 0;
  let durationMs = 1;
  let startAt = 0;
  return {
    start(amplitude, duration, at) {
      isActive = true;
      amplitudeM = amplitude;
      durationMs = duration;
      startAt = at;
    },
    update(clockMs) {
      if (!isActive) return;
      const progress = (clockMs - startAt) / durationMs;
      if (progress >= 1) {
        isActive = false;
        target.position.x = 0;
        target.position.z = 0;
        return;
      }
      if (progress < 0) return;
      const decay = amplitudeM * (1 - progress);
      target.position.x = decay * Math.sin(progress * 2 * Math.PI * SHAKE_CYCLES);
      target.position.z = decay * Math.sin(progress * 2 * Math.PI * SHAKE_CYCLES * SHAKE_Z_RATIO);
    },
  };
}
