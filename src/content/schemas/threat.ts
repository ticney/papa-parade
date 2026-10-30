import { BABY_CRYING_EVERY_MS } from '@shared/constants';
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
 * `Record<ThreatIcon, …>`: a missing glyph is a type error). The marker's shape and colour are
 * separate keys (`THREAT_ICON_SHAPES`, `THREAT_COLORS`, story 2.2).
 */
export const THREAT_ICONS = ['bolt', 'stairs', 'mug', 'eyelids', 'dots', 'cry'] as const;
export type ThreatIcon = (typeof THREAT_ICONS)[number];

/**
 * The shape of a threat's marker (story 2.2). Shape and colour are a pair, so that the response is
 * readable without the colour (NFR8): a `circle` is blue (`parry`), a `triangle` is orange (`dodge`).
 */
export const THREAT_ICON_SHAPES = ['circle', 'triangle'] as const;
export type ThreatIconShape = (typeof THREAT_ICON_SHAPES)[number];

/** The colour of a threat's marker, by DESIGN.md token name (`--pp-color-<color>` in `tokens.css`). */
export const THREAT_COLORS = ['parry', 'dodge'] as const;
export type ThreatColor = (typeof THREAT_COLORS)[number];

/** The pair each shape goes with: the signal is the pair (NFR8). */
export const THREAT_SHAPE_COLORS: Readonly<Record<ThreatIconShape, ThreatColor>> = {
  circle: 'parry',
  triangle: 'dodge',
};

/** `^verb\.[a-z0-9_]+$`: a key of the `verb.` group of `strings.fr.json`. */
const VERB_KEY_PATTERN = /^verb\.[a-z0-9_]+$/;

/** Only a `dodge` response has a default verb of its own (`verb.dodge`, « ESQUIVE ! »). */
const hasDefaultVerb = (response: string): boolean => response === 'dodge';

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
  verbKey: z
    .string()
    .regex(VERB_KEY_PATTERN, 'a verbKey is a `verb.<name>` key of strings.fr.json')
    .nullable()
    .describe(
      'Key of `strings.fr.json` (`verb.` group) of the verb shown above the threat (« SOULÈVE ! »). `null` = the default verb of the response, only for a `dodge` response (story 5.1).',
    ),
  icon: z
    .enum(THREAT_ICONS)
    .describe("Glyph drawn in the threat's marker (the client has one per entry)."),
  iconShape: z
    .enum(THREAT_ICON_SHAPES)
    .describe(
      "Shape of the threat's marker: `circle` goes with `parry`, `triangle` with `dodge` (the pair is the signal, NFR8).",
    ),
  color: z
    .enum(THREAT_COLORS)
    .describe("Colour of the threat's marker, by DESIGN.md token name (`parry` or `dodge`)."),
  feedback: FeedbackCuesSchema,
  cooldownMs: z
    .number()
    .min(0)
    .describe(
      'Time spent resolved or in gag before the threat is idle again, in sim ms (0 = at once).',
    ),
  gagCryMs: z
    .int()
    .min(BABY_CRYING_EVERY_MS)
    .optional()
    .describe(
      'When a miss ends in the gag, the baby cries for this long, in sim ms, at least 1000 (story 3.1: one `BabyCrying` per second, +2 % noise each; a shorter cry would be silent). Absent: the gag does not make him cry.',
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
    if (def.verbKey === null && !hasDefaultVerb(def.response)) {
      ctx.addIssue({
        code: 'custom',
        path: ['verbKey'],
        message: `a \`null\` verbKey (the default verb of the response) is only for a "dodge" response, not "${def.response}": write the \`verb.\` key`,
      });
    }
    // One issue at most per path: a broken pair is reported alone, then the response rule.
    if (THREAT_SHAPE_COLORS[def.iconShape] !== def.color) {
      ctx.addIssue({
        code: 'custom',
        path: ['color'],
        message: `shape and colour are a pair: "${def.iconShape}" goes with "${THREAT_SHAPE_COLORS[def.iconShape]}", not "${def.color}"`,
      });
    } else if (def.iconShape !== 'circle') {
      // `parry` and `firm` are the only responses the sim judges: both are a blue circle.
      ctx.addIssue({
        code: 'custom',
        path: ['iconShape'],
        message: `a "${def.response}" threat is a "circle" + "parry" marker: the "${def.iconShape}" / "${def.color}" marker joins with the dodge response (story 5.1)`,
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
