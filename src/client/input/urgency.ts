import type { ThreatInstance } from '@sim';

// The one definition of « most urgent » (story 1.17 D3, story 2.2 D7): the threat whose window closes
// first, ties to the lower id. `pickAutoTarget` and the verb layout both read it from here, so the
// threat Space parries and the verb that is in front can never disagree.

/**
 * When the threat's window closes, in sim ms (`windowOpenAt + responseWindow.windowMs`), or null while
 * it has no frozen window (the window is frozen at the telegraph, so an active threat always has one).
 */
export function threatCloseAt(
  threat: Readonly<Pick<ThreatInstance, 'windowOpenAt' | 'responseWindow'>>,
): number | null {
  return threat.responseWindow === null
    ? null
    : threat.windowOpenAt + threat.responseWindow.windowMs;
}

/** Negative when A is more urgent than B, positive when B is, 0 for the same threat. Allocates nothing. */
export function compareUrgency(
  aCloseAt: number,
  aId: number,
  bCloseAt: number,
  bId: number,
): number {
  return aCloseAt === bCloseAt ? aId - bId : aCloseAt - bCloseAt;
}

/** True when A is strictly more urgent than B. */
export function isMoreUrgent(
  aCloseAt: number,
  aId: number,
  bCloseAt: number,
  bId: number,
): boolean {
  return compareUrgency(aCloseAt, aId, bCloseAt, bId) < 0;
}
