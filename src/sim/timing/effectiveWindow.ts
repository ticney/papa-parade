import type { Feel } from '@content/schemas/feel';

/** The response window of one threat, in sim ms, as the judgement reads it. */
export interface EffectiveWindow {
  /** Length of the window, after the modifiers. */
  windowMs: number;
  /** Length of the perfect zone, centred in the window; never longer than the window. */
  perfectMs: number;
  /** Hidden tolerance added on each side of the window. */
  toleranceMs: number;
  /** A press this early before the window (tolerance included) is kept. */
  bufferMs: number;
}

/** The factors that scale a window. 1 changes nothing. */
export interface WindowModifiers {
  /** The difficulty tier's `windowMultiplier`. */
  tier: number;
  /** Fatigue: windows shrink above the threshold (story 1.19). */
  fatigue: number;
  /** Fatherly Instinct: windows grow while it is active (story 2.9). */
  instinct: number;
}

/**
 * The window a threat gets: `base × tier × fatigue × instinct`, in that fixed order (architecture ›
 * Chaîne d'entrées), then the hidden tolerance and the buffer ride along unscaled. The perfect
 * zone is capped at the shrunk window. Pure; the only place that order lives.
 */
export function effectiveWindow(
  timing: Feel['timing'],
  baseWindowMs: number,
  modifiers: WindowModifiers,
): EffectiveWindow {
  const windowMs = baseWindowMs * modifiers.tier * modifiers.fatigue * modifiers.instinct;
  return {
    windowMs,
    perfectMs: Math.min(timing.perfectMs, windowMs),
    toleranceMs: timing.toleranceMs,
    bufferMs: timing.bufferMs,
  };
}
