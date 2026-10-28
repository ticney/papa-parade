import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';

// `content/threats/<id>.json`: one file per kind of threat (a new threat is a new JSON, never a
// class). Same rules as the other schemas: strict, camelCase, units in the names, no default.
// A nullable key is always written in the file; `null` means "use the feel.json value".

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

/**
 * The responses the sim judges today. `firm` joined in story 1.23; `wait` (4.6), `nothing` (4.9) and
 * `dodge` (5.1) each join with their story: the schema accepts only what the sim can judge.
 */
export const THREAT_RESPONSES = ['parry', 'firm'] as const;
export type ThreatResponse = (typeof THREAT_RESPONSES)[number];

/**
 * The glyphs a threat's marker can draw, as data (the client has one per entry, as a
 * `Record<ThreatIcon, …>`: a missing glyph is a type error). Story 2.2 adds the verb, shape and
 * colour to the def in the same way.
 */
export const THREAT_ICONS = ['bolt', 'stairs', 'mug', 'eyelids', 'dots'] as const;
export type ThreatIcon = (typeof THREAT_ICONS)[number];

/**
 * Where a threat stands: on a planned anchor of the level (a wave plans it), on Papa himself
 * (the sim spawns it: the micro-sleep of story 1.19, which follows him wherever he walks), or in a
 * hidden zone of the room (the suspicious silence of story 1.21: the baby goes there and goes quiet).
 */
export const THREAT_TARGETS = ['anchor', 'papa', 'hiddenZone'] as const;
export type ThreatTarget = (typeof THREAT_TARGETS)[number];

const FeedbackCuesSchema = z
  .strictObject({
    telegraph: idSchema('Cue played when the threat is telegraphed.'),
    success: idSchema('Cue played on a successful response.'),
    perfect: idSchema('Cue played on a perfect response.'),
    gag: idSchema('Cue played when the gag is triggered.'),
  })
  .describe('Cues of `feedback.json` › `cues` the client plays for this threat (story 1.11).');

/** The keys every threat def has, whatever its target. */
const baseShape = {
  id: idSchema('The threat id; equals the file name.'),
  response: z.enum(THREAT_RESPONSES).describe('The response the threat asks for.'),
  telegraphDelayMs: z
    .number()
    .positive()
    .nullable()
    .describe(
      'From the telegraph to the opening of the window, in sim ms; `null` = `feel.timing.telegraphDelayDefaultMs`.',
    ),
  windowMs: z
    .number()
    .positive()
    .nullable()
    .describe('Base response window, in sim ms; `null` = `feel.timing.windowMs`.'),
  holdUntilMs: z
    .number()
    .positive()
    .optional()
    .describe(
      'Only on a `firm` threat (required there, refused elsewhere): from the opening of the window to the end of the attack, in sim ms. A Firmness is held until then (story 1.23).',
    ),
  icon: z
    .enum(THREAT_ICONS)
    .describe("Glyph drawn in the threat's marker (the client has one per entry)."),
  feedback: FeedbackCuesSchema,
  cooldownMs: z
    .number()
    .min(0)
    .describe(
      'Time spent resolved or in gag before the threat is idle again, in sim ms (0 = at once).',
    ),
};

const AnchoredThreatDefSchema = z
  .strictObject({
    ...baseShape,
    target: z
      .enum(['anchor', 'papa'])
      .describe(
        'Where the threat stands: a planned anchor, or on Papa (system-spawned, story 1.19).',
      ),
    gag: idSchema('The gag played on a miss (a `GAG_IDS` entry of the sim).'),
  })
  .describe('A threat that stands on an anchor of the level, or on Papa.');

const HiddenZoneThreatDefSchema = z
  .strictObject({
    ...baseShape,
    target: z
      .literal('hiddenZone')
      .describe(
        'The baby hides in a `ZONE_hidden_*` of the room and goes quiet (the suspicious silence, story 1.21).',
      ),
    findMaxMs: z
      .number()
      .positive()
      .describe(
        'From `SilenceStarted` to the surprise mischief if Papa has not found the baby, in sim ms.',
      ),
    surpriseGags: z
      .array(idSchema('A `GAG_IDS` entry of the sim.'))
      .min(1)
      .describe('The gags a miss draws from, one at random (`world.rng`), never `papa_asleep`.'),
  })
  .describe('A threat the baby hides: find him first, then Parry (GDD › Silence suspect).');

export const ThreatDefSchema = z
  .discriminatedUnion('target', [AnchoredThreatDefSchema, HiddenZoneThreatDefSchema])
  .superRefine((def, ctx) => {
    // `holdUntilMs` is variant-specific, like `findMaxMs`: a `parry` file does not carry a `null` for it.
    if (def.response === 'firm' && def.holdUntilMs === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['holdUntilMs'],
        message:
          'a threat with response "firm" needs `holdUntilMs` (sim ms from the window opening)',
      });
    } else if (def.response !== 'firm' && def.holdUntilMs !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['holdUntilMs'],
        message: `\`holdUntilMs\` is only for a threat with response "firm", not "${def.response}"`,
      });
    }
  })
  .describe('A kind of threat: how it is telegraphed, answered and how it ends (GDD › Catalogue).');

export type ThreatDef = z.infer<typeof ThreatDefSchema>;
export type HiddenZoneThreatDef = Extract<ThreatDef, { target: 'hiddenZone' }>;

/** The gag ids a def can end in: its one `gag`, or the `surpriseGags` a hidden-zone threat draws from. */
export function ThreatGagIds(def: ThreatDef): readonly string[] {
  return def.target === 'hiddenZone' ? def.surpriseGags : [def.gag];
}
