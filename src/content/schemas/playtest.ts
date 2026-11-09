import { DIFFICULTY_TIER_IDS, UINT32_RANGE } from '@shared/constants';
import { z } from 'zod';

// Every key of content/playtest.json lives here: the thresholds `npm run playtest:metrics` judges
// the testers' journals against (NFR11, GDD « Indicateurs de gameplay », assumption 7). It is a
// tool-only file: the game never reads it, so it is not part of `ContentBundle` and retuning it
// never moves the `contentHash` of a recorded journal. Same rules as the other schemas: strict,
// camelCase, units in the names, no `.default()`, `.optional()` or `.transform()`.

/** A threshold in whole percent: the report compares integers (`hits * 100 >= minPct * count`). */
const minPct = (description: string) => z.int().min(0).max(100).describe(description);

/**
 * The indicator « Le joueur simulé humain joue comme un humain » (GDD v2.3, story 3.14): `npm run sim --
 * --compare <dir>` judges the `human` bot against the testers' journals with these two numbers.
 */
const HumanBotThresholdsSchema = z
  .strictObject({
    maxStarGap: z
      .number()
      .positive()
      .describe(
        "The bot's mean stars must stay within this many stars of the testers' median (strictly under).",
      ),
    maxPerfectExcessPct: z
      .number()
      .min(0)
      .max(100)
      .describe(
        "How many points of perfect rate (in %) the bot may have above the testers' median rate.",
      ),
  })
  .describe('The thresholds of the human-bot comparison (`npm run sim -- --compare`).');

/**
 * The indicator « La défaite est possible sans être un mur » (GDD gameplay indicators, story 9.8): what
 * `npm run sim:balance` demands of the first level's rhythm over simulated games, each bot with the same seeds.
 */
const SimulatedTargetsSchema = z
  .strictObject({
    runs: z
      .int()
      .min(1)
      .max(10_000)
      .describe('Games per bot (the GDD says 200 seeds): run i uses seed + i.'),
    seed: z
      .int()
      .min(0)
      .max(UINT32_RANGE - 1)
      .describe('The seed of the first game.'),
    tier: z
      .enum(DIFFICULTY_TIER_IDS)
      .describe('The difficulty tier the games are played at (the GDD says Normal).'),
    humanLossPct: z
      .strictObject({
        min: z
          .number()
          .min(0)
          .max(100)
          .describe('Fewest games the `human` bot may lose, in % (inclusive).'),
        max: z
          .number()
          .min(0)
          .max(100)
          .describe('Most games the `human` bot may lose, in % (inclusive).'),
      })
      .refine((range) => range.min <= range.max, { message: 'min must not be above max' })
      .describe(
        'The share of games, in %, the `human` bot loses (Mama came home early: `endsByReason.mamaHome`): a loss is possible without being a wall.',
      ),
    humanMustFailDefs: z
      .array(z.string().regex(/^[a-z][a-z0-9_]*$/))
      .describe(
        'Threat defs the `human` bot must fail at least once over the games (a threat nobody can fail is not a threat): the big room’s new mischiefs. A def the games never met counts as not failed.',
      ),
    humanOpenDoorMustGag: z
      .boolean()
      .describe(
        'True: over the games the baby gets into the open dishwasher at least once (`chores.open.gagged` above 0) with the `human` bot.',
      ),
    perfectChoresEveryRun: z
      .boolean()
      .describe('True: the `perfect` bot finishes every house chore of the level in every game.'),
    idleLosesBeforeTimer: z
      .boolean()
      .describe('True: the `idle` bot loses every game, before the level’s timer runs out.'),
  })
  .describe(
    'The simulated-games targets of the first level (`npm run sim:balance`, part of `npm run ci`).',
  );

/**
 * The indicator « Papa se lit sans sa bulle » (GDD gameplay indicators, story 7.12, D14): Geo shows each
 * tester an extract with Papa's activity bubble off (`?bubble=off`) and notes whether they name what he does.
 */
const BodyReadSchema = z
  .strictObject({
    activities: z
      .array(
        z
          .string()
          .regex(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/, 'an activity id is lower_snake_case')
          .describe('One activity of Papa a tester is asked to name.'),
      )
      .min(1)
      .refine((ids) => new Set(ids).size === ids.length, { message: 'an activity is listed twice' })
      .describe(
        "Indicator 6 (observed): Papa's activities the testers are asked to name, the `activityId` of Geo's notes.",
      ),
    namedMinPct: minPct(
      'Indicator 6 (observed): share of the testers with a note (in %) who name what Papa does, without his bubble. Applies to each activity.',
    ),
    repetitivePoseMaxTesters: z
      .int()
      .min(0)
      .max(100)
      .describe(
        'Indicator 6 (observed): most testers who may spontaneously find one of his poses repetitive.',
      ),
  })
  .describe('Indicator 6, « Papa se lit sans sa bulle » (story 7.12).');

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
  bodyRead: BodyReadSchema,
  humanBot: HumanBotThresholdsSchema,
  simulated: SimulatedTargetsSchema,
});

/** The whole file. */
export type PlaytestFile = z.infer<typeof PlaytestSchema>;

/** What `playtest:metrics` judges the testers by: the file without the human-bot and simulated-games blocks, which it does not read. */
export type PlaytestThresholds = Omit<PlaytestFile, 'humanBot' | 'simulated'>;
