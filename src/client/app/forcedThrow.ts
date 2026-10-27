import { MAX_TIMER_DELAY_MS } from '@shared/constants';

/**
 * The delay of the dev parameter `?throwAfterMs=…`, or `null` when it is not usable. Plain digits
 * only (`Number` would also take `1e21`, `0x10` and ` 300 `), and no more than `setTimeout` can
 * hold: a longer delay overflows and fires at once.
 */
export function parseThrowDelayMs(raw: string): number | null {
  if (!/^\d+$/.test(raw)) return null;
  const delayMs = Number(raw);
  return Number.isSafeInteger(delayMs) && delayMs <= MAX_TIMER_DELAY_MS ? delayMs : null;
}
