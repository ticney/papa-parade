import { invariant } from '@shared/invariant';

/**
 * Every gag a threat can end in, as data. A gag is a harmless, comic consequence (NFR9): the sim
 * only announces it (`GagTriggered`), the presentation and the consequences (noise, mess, near miss,
 * score) come with their own stories. `content:check` checks a threat's `gag` against this list.
 */
export const GAG_IDS = ['outlet_hair'] as const;

export type GagId = (typeof GAG_IDS)[number];

/** The gag a threat def names, as a `GagId`. `createSim` has already refused a def with another, so this guards a bug, not content. */
export function gagIdOf(gag: string): GagId {
  const known = (GAG_IDS as readonly string[]).includes(gag);
  invariant(known, `unknown gag ${gag}`);
  return gag as GagId;
}
