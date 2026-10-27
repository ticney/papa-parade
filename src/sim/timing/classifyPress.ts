export type PressKind = 'parry' | 'firm';

/**
 * The type of a response (ADR-010): a press released before `holdMinMs` is a Parry, one held to
 * `holdMinMs` or longer is a Firmness. It is decided at the release, or, with no release, as soon as
 * the press has been held that long. `null` while it is still open. A release earlier than the
 * press is not its release. Times are sim ms.
 */
export function classifyPress(
  pressT: number,
  releasedAt: number | null,
  nowT: number,
  holdMinMs: number,
): PressKind | null {
  if (releasedAt !== null && releasedAt >= pressT) {
    return releasedAt - pressT < holdMinMs ? 'parry' : 'firm';
  }
  return nowT >= pressT + holdMinMs ? 'firm' : null;
}
