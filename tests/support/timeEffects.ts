// Shared numbers of the hitstop and slow-mo tests (story 1.14): one place, named, instead of a bare
// literal in each spec.

/** A Parry releases this long after its press: shorter than `input.holdMinMs`, so not a Firmness. */
export const PARRY_RELEASE_AFTER_MS = 50;

/** Added to a slow-mo hold that must cover a threat's next cycle (cooldown, telegraph, window). */
export const SLOW_MO_COVER_MARGIN_MS = 3000;
