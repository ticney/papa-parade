import type { Feel } from '@content/schemas/feel';

/** The rules of the maths: the part of `feel.calibration` it needs. */
export type CalibrationRules = Pick<
  Feel['calibration'],
  'bpm' | 'outlierMs' | 'offsetMinMs' | 'offsetMaxMs' | 'minValidTaps'
>;

export type PhaseOffset =
  | { isEnough: true; offsetMs: number; validCount: number }
  | { isEnough: false; validCount: number };

const MS_PER_MINUTE = 60_000;

function median(sorted: readonly number[]): number {
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * The offset one phase measured (story 2.7, architecture P5): how late the player's taps land on
 * the beats, in real ms (positive = late). Pure; every instant is on the same real clock.
 *
 * Each tap pairs with the nearest beat and is dropped when it is further than half a beat interval
 * from every beat; a beat keeps its first tap only. The gap is `tap − beat`. Gaps further than
 * `outlierMs` from their median are rejected, and the answer is the median of what is kept, rounded
 * to a whole ms and clamped to `[offsetMinMs, offsetMaxMs]`. Fewer than `minValidTaps` kept: not
 * enough, and the caller starts the phase over.
 */
export function computePhaseOffset(
  beatsAtReal: readonly number[],
  tapsAtReal: readonly number[],
  rules: CalibrationRules,
): PhaseOffset {
  const halfIntervalMs = MS_PER_MINUTE / rules.bpm / 2;
  const gapByBeat = new Map<number, number>();
  for (const tapAtReal of [...tapsAtReal].sort((a, b) => a - b)) {
    let nearest = -1;
    let nearestDistanceMs = Number.POSITIVE_INFINITY;
    for (let i = 0; i < beatsAtReal.length; i++) {
      const distanceMs = Math.abs(tapAtReal - (beatsAtReal[i] as number));
      if (distanceMs < nearestDistanceMs) {
        nearest = i;
        nearestDistanceMs = distanceMs;
      }
    }
    if (nearest < 0 || nearestDistanceMs > halfIntervalMs) continue;
    if (!gapByBeat.has(nearest))
      gapByBeat.set(nearest, tapAtReal - (beatsAtReal[nearest] as number));
  }
  const gaps = [...gapByBeat.values()].sort((a, b) => a - b);
  if (gaps.length === 0) return { isEnough: false, validCount: 0 };
  const firstMedianMs = median(gaps);
  const kept = gaps.filter((gap) => Math.abs(gap - firstMedianMs) <= rules.outlierMs);
  if (kept.length < rules.minValidTaps) return { isEnough: false, validCount: kept.length };
  const rounded = Math.round(median(kept));
  const clamped = Math.min(rules.offsetMaxMs, Math.max(rules.offsetMinMs, rounded));
  // `Math.round(-0.4)` is -0, which would leak into the save and into `toBe(0)`.
  return { isEnough: true, offsetMs: clamped === 0 ? 0 : clamped, validCount: kept.length };
}
