import type { SimEvent } from '@sim';

/**
 * Whether a sim event is the noise gauge crossing `alertPct` upwards (story 3.1 D10): a
 * `NoiseChanged` whose value was at or below the threshold before the change and is strictly above
 * it after (`noisePct − deltaPct ≤ alertPct < noisePct`: « above 80 % » means strictly above). The
 * event carries both ends, and the decay is silent and runs before the sources in a step, so
 * `noisePct − deltaPct` is the value just before. It fires again on the next upward crossing,
 * after a fall below the threshold, and every source counts, `debug` included.
 */
export function isNoiseAlertCrossing(event: SimEvent, alertPct: number): boolean {
  if (event.type !== 'NoiseChanged') return false;
  return event.noisePct - event.deltaPct <= alertPct && alertPct < event.noisePct;
}
