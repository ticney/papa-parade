import type { Feel } from '@content/schemas/feel';

// How long a passage between two clips fades, and on which curve (story 7.8, D4). Pure, no Three.

/** `feel.json › characters.fades`, in sim ms. */
export type FadesConfig = Feel['characters']['fades'];

/** What comes in: the loop the state says, a one-shot over it, or the loop again after a one-shot. */
export type FadeKind = 'loop' | 'oneShot' | 'return';

/**
 * The fade of a passage: into a travelling loop from a still one is a start, the reverse a stop, the
 * return from a one-shot its own, and every other (into a one-shot, still to still, travelling to
 * travelling) `otherMs`.
 */
export function fadeMsOf(
  fromTravelling: boolean,
  toTravelling: boolean,
  kind: FadeKind,
  fades: Readonly<FadesConfig>,
): number {
  if (kind === 'oneShot') return fades.otherMs;
  if (kind === 'return') return fades.returnMs;
  if (!fromTravelling && toTravelling) return fades.startMs;
  if (fromTravelling && !toTravelling) return fades.stopMs;
  return fades.otherMs;
}

/** The ease-in-out of a fade: `p²(3 − 2p)` on `p` clamped to 0..1, with a zero slope at both ends. */
export function smoothstep(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return p * p * (3 - 2 * p);
}
