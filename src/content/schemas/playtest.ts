import { z } from 'zod';

// Every key of content/playtest.json lives here: the thresholds `npm run playtest:metrics` judges
// the testers' journals against (NFR11, GDD « Indicateurs de gameplay », assumption 7). It is a
// tool-only file: the game never reads it, so it is not part of `ContentBundle` and retuning it
// never moves the `contentHash` of a recorded journal. Same rules as the other schemas: strict,
// camelCase, units in the names, no `.default()`, `.optional()` or `.transform()`.

/** A threshold in whole percent: the report compares integers (`hits * 100 >= minPct * count`). */
const minPct = (description: string) => z.int().min(0).max(100).describe(description);

export const PlaytestSchema = z.strictObject({
  panelMinTesters: z
    .int()
    .min(1)
    .describe('Fewest testers a playtest needs for its indicators to mean something (FR68).'),
  relaunchMinPct: minPct(
    'Indicator 1: share of testers (in %) who start another game without being asked.',
  ),
  perfectCitedMinPct: minPct(
    'Indicator 2: share of testers (in %) who spontaneously cite the perfect parry as a high point.',
  ),
  identifiedMinPct: minPct(
    'Indicator 3 (observed): share of testers (in %) who identify the right response to a threat at its first encounter, without help. Applies to each threat.',
  ),
  firstEncounterSuccessMinPct: minPct(
    'Indicator 3 (computed proxy): share of testers (in %) whose first resolved response to a threat is a success or a perfect. Applies to each threat.',
  ),
  touchVsKeyboardMinPct: minPct(
    'Indicator 4: success rate on touch, as a share (in %) of the success rate on the keyboard.',
  ),
  laughedMinPct: minPct(
    'Indicator 5: share of testers (in %) who laugh at least once during a level.',
  ),
});

export type PlaytestThresholds = z.infer<typeof PlaytestSchema>;
