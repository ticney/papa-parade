import type { EffectiveWindow } from './effectiveWindow.ts';

export interface Judgement {
  /** `early` and `late` are misses; the caller decides what they cost. */
  quality: 'perfect' | 'success' | 'early' | 'late';
  /** The press's distance from the window's centre, in sim ms: negative is early. */
  offsetMs: number;
}

/**
 * Rates a press from its own timestamp (never from the step that processes it, nor from Papa's
 * arrival): `perfect` within ±`perfectMs / 2` of the window's centre; `early` before the window
 * minus the tolerance and the buffer; `late` after the window plus the tolerance; else `success`.
 * Every boundary is inclusive on the side of the better rating.
 */
export function judgePress(
  pressT: number,
  windowOpenAt: number,
  effective: EffectiveWindow,
): Judgement {
  const center = windowOpenAt + effective.windowMs / 2;
  const offsetMs = pressT - center;
  if (Math.abs(offsetMs) <= effective.perfectMs / 2) return { quality: 'perfect', offsetMs };
  const half = effective.windowMs / 2 + effective.toleranceMs;
  if (offsetMs < -half - effective.bufferMs) return { quality: 'early', offsetMs };
  if (offsetMs > half) return { quality: 'late', offsetMs };
  return { quality: 'success', offsetMs };
}
