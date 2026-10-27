import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';

// `content/threats/<id>.json`: one file per kind of threat (a new threat is a new JSON, never a
// class). Same rules as the other schemas: strict, camelCase, units in the names, no default.
// A nullable key is always written in the file; `null` means "use the feel.json value".

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

/**
 * The responses the sim judges today. `firm` (story 1.23), `wait` (4.6), `nothing` (4.9) and
 * `dodge` (5.1) each join with their story: the schema accepts only what the sim can judge.
 */
export const THREAT_RESPONSES = ['parry'] as const;
export type ThreatResponse = (typeof THREAT_RESPONSES)[number];

const FeedbackCuesSchema = z
  .strictObject({
    telegraph: idSchema('Cue played when the threat is telegraphed.'),
    success: idSchema('Cue played on a successful response.'),
    perfect: idSchema('Cue played on a perfect response.'),
    gag: idSchema('Cue played when the gag is triggered.'),
  })
  .describe('Cues of `feedback.json` › `cues` the client plays for this threat (story 1.11).');

export const ThreatDefSchema = z
  .strictObject({
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
    gag: idSchema('The gag played on a miss (a `GAG_IDS` entry of the sim).'),
    feedback: FeedbackCuesSchema,
    cooldownMs: z
      .number()
      .min(0)
      .describe(
        'Time spent resolved or in gag before the threat is idle again, in sim ms (0 = at once).',
      ),
  })
  .describe('A kind of threat: how it is telegraphed, answered and how it ends (GDD › Catalogue).');

export type ThreatDef = z.infer<typeof ThreatDefSchema>;
