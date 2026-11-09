import type { SimEvent } from '@sim';

// Papa's sigh of relief (story 7.12, D5): a success that scraped through, late in its window. Pure, no Three.
// It reads one `ResponseResolved` alone, after its judgement: the window, its hidden tolerance included, is
// that event's `responseWindow`. It takes no threat, so nothing here can give an answer away before a press;
// it is outside `views/` on purpose, and the one client reader of `toleranceMs`.

/** The event the sigh is read from. */
export type ResolvedResponse = Extract<SimEvent, { type: 'ResponseResolved' }>;

/**
 * Whether a judged response makes Papa sigh (D5): a success (never a perfect or a fail) whose press lies in
 * the last `lastSharePct` % of its window as judged, the hidden tolerance included on both sides:
 * `(offsetMs + half) / (2 × half) ≥ 1 − lastSharePct / 100`, `half = windowMs / 2 + toleranceMs`. The early
 * buffer is not the window. A press with no offset, or a window of no length, never does.
 */
export function isReliefSuccess(event: Readonly<ResolvedResponse>, lastSharePct: number): boolean {
  if (event.quality !== 'success' || event.offsetMs === null) return false;
  const half = event.responseWindow.windowMs / 2 + event.responseWindow.toleranceMs;
  if (!(half > 0)) return false;
  return (event.offsetMs + half) / (2 * half) >= 1 - lastSharePct / 100;
}
