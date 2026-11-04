import type { ContentBundle } from '@content/contentBundle';
import type { Feel } from '@content/schemas/feel';
import { createTestContent } from './testContent.ts';

/**
 * Story 3.16 D14: every rise of the catastrophe gauge at 0. A test that fails threats on purpose
 * and is not about the catastrophe applies it, so that a pile of gags does not bring Mama home and
 * end the level under it. The live values stay in `testFeel.json` (they mirror `feel.json`): never
 * lower them to keep a test green.
 */
export const NO_CATASTROPHE_RISES: Feel['catastrophe']['risePct'] = {
  nearMiss: 0,
  mess: 0,
  microSleep: 0,
  choreBeat: 0,
};

/** The same, as a `SetFeel` patch: a golden scenario that is not about the catastrophe sends it at step 0. */
export const NO_CATASTROPHE_PATCH = { catastrophe: { risePct: { ...NO_CATASTROPHE_RISES } } };

/** `feel` with the catastrophe gauge unable to rise (its decay, drop and thresholds are untouched). */
export function withoutCatastrophe(feel: Feel): Feel {
  return { ...feel, catastrophe: { ...feel.catastrophe, risePct: { ...NO_CATASTROPHE_RISES } } };
}

/**
 * Zeroes the rises of a feel **in place**: for a test that loads the live level (`loadSimLevel`) and, as
 * its siblings do for the noise, patches the loaded feel before it plays an idle game to the end.
 */
export function silenceCatastrophe(feel: Feel): void {
  Object.assign(feel.catastrophe.risePct, NO_CATASTROPHE_RISES);
}

/** The frozen test content with {@link withoutCatastrophe} applied to its feel. */
export function createTestContentWithoutCatastrophe(): ContentBundle {
  const content = createTestContent();
  return { ...content, feel: withoutCatastrophe(content.feel) };
}
