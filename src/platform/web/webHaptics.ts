import { log } from '@shared/log';
import type { HapticKind, Haptics } from '../platform.ts';

/** The slice of `navigator` the web platform reads. Safari iOS has no `vibrate`. */
export interface NavigatorLike {
  vibrate?: (pattern: number[]) => boolean;
  maxTouchPoints?: number;
}

export type HapticPatternsMs = Readonly<Record<HapticKind, readonly number[]>>;

export interface WebHaptics {
  haptics: Haptics;
  /** `navigator.vibrate` is a function. */
  isSupported: boolean;
}

/**
 * Haptics through `navigator.vibrate`. Where it is missing a pulse is silent and costs nothing. A
 * `vibrate` that throws, or that answers `false` (no user activation yet, or vibration off), is a
 * `warn` once per session for each of the two, never one per pulse. Never throws, never branches
 * on the user agent.
 */
export function createWebHaptics(nav: NavigatorLike, patternsMs: HapticPatternsMs): WebHaptics {
  const isSupported = typeof nav.vibrate === 'function';
  // One mutable copy per kind, made once: `vibrate` takes `number[]` and a pulse allocates nothing.
  const patterns: Record<HapticKind, number[]> = {
    light: [...patternsMs.light],
    medium: [...patternsMs.medium],
    heavy: [...patternsMs.heavy],
    heartbeat: [...patternsMs.heartbeat],
  };
  let hasWarnedThrow = false;
  let hasWarnedRefused = false;
  return {
    isSupported,
    haptics: {
      pulse(kind) {
        if (typeof nav.vibrate !== 'function') return;
        try {
          // A method call: `vibrate` needs `navigator` as its receiver.
          if (nav.vibrate(patterns[kind]) === false && !hasWarnedRefused) {
            hasWarnedRefused = true;
            log.warn('platform', 'navigator.vibrate refused the pattern (no user activation yet?)');
          }
        } catch (cause) {
          if (hasWarnedThrow) return;
          hasWarnedThrow = true;
          log.warn('platform', 'navigator.vibrate threw: haptics skipped', {
            cause: String(cause),
          });
        }
      },
    },
  };
}
