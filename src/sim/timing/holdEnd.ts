/** How a Firmness ended: held to the end of the attack, or let go before it. */
export type FirmHoldOutcome = 'held' | 'released';

/**
 * The instant a held Firmness succeeds (story 1.23 D1): the end of the attack
 * (`windowOpenAt + holdUntilMs`), or `holdMinMs` after the press if that is later, since a hold
 * shorter than `holdMinMs` is not a Firmness at all (ADR-010). Sim ms.
 */
export function holdEndAt(
  pressT: number,
  windowOpenAt: number,
  holdUntilMs: number,
  holdMinMs: number,
): number {
  return Math.max(pressT + holdMinMs, windowOpenAt + holdUntilMs);
}

/**
 * What a press already classified as a Firmness has come to. A release decides on its own time: at
 * or after `endAt` the hold was kept (`held`), before it the finger came up too soon (`released`).
 * With no release it is `held` as soon as `nowT` reaches `endAt`, and `null` (keep waiting) before.
 * A release earlier than the press is not its release.
 */
export function firmHoldOutcome(
  pressT: number,
  releasedAt: number | null,
  endAt: number,
  nowT: number,
): FirmHoldOutcome | null {
  if (releasedAt !== null && releasedAt >= pressT) return releasedAt >= endAt ? 'held' : 'released';
  return nowT >= endAt ? 'held' : null;
}
