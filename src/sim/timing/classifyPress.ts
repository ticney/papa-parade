import type { ThreatResponse } from '@content/schemas/threat';

export type PressKind = 'parry' | 'firm';

/**
 * The press a threat's `response` is answered with (story 4.6): a `wait` is answered by a tap, so a
 * Parry; the others by themselves. Compare a press to this, never to `def.response` itself, which
 * typechecks against `'wait'` and would make every tap a `wrongResponse`.
 */
export function pressKindOf(response: ThreatResponse): PressKind {
  return response === 'wait' ? 'parry' : response;
}

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
  lagMs = 0,
): PressKind | null {
  if (releasedAt !== null && releasedAt >= pressT) {
    return releasedAt - pressT < holdMinMs ? 'parry' : 'firm';
  }
  return nowT >= pressT + holdMinMs + lagMs ? 'firm' : null;
}
