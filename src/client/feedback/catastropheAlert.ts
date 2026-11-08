import type { SimEvent } from '@sim';

/**
 * Whether a sim event is the catastrophe gauge crossing `alertPct` upwards (story 3.16 AC 14): a
 * `CatastropheChanged` whose value was at or below the threshold before the change and is strictly
 * above it after (`catastrophePct − deltaPct ≤ alertPct < catastrophePct`: « above 70 % » means
 * strictly above, the rule of `isNoiseAlertCrossing`). The event
 * carries both ends, and the decay is silent and runs before the rises in a step, so
 * `catastrophePct − deltaPct` is the value just before. It fires again on the next upward crossing,
 * after a fall below the threshold, and every source counts, `debug` included.
 */
export function isCatastropheAlertCrossing(event: SimEvent, alertPct: number): boolean {
  if (event.type !== 'CatastropheChanged') return false;
  return event.catastrophePct - event.deltaPct <= alertPct && alertPct < event.catastrophePct;
}
