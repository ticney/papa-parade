import { GAUGE_MAX_POINTS, PHONE_RINGING_EVERY_MS } from '@shared/constants';
import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';

// `content/disruptions/<id>.json`: one file per kind of disruption (story 1.20). A disruption is
// not a threat: nobody parries it, it asks the player to choose what to deal with. A wave plans it
// (`waves[w].disruptions`), on an object of the level. Same rules as the other schemas: strict,
// camelCase, units in the names, no default.

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

/**
 * What a disruption is, hence how the sim handles it: one handler per kind (a
 * `Record<DisruptionKind, …>`, so a kind with no handler does not compile). The E6 dog and pot join
 * the phone here.
 */
export const DISRUPTION_KINDS = ['phone'] as const;
export type DisruptionKind = (typeof DISRUPTION_KINDS)[number];

const DisruptionFeedbackSchema = z
  .strictObject({
    ring: idSchema(
      'Cue played when the phone starts ringing and at each second it goes on ringing.',
    ),
    answer: idSchema('Cue played when Papa picks up.'),
  })
  .describe('Cues of `feedback.json` › `cues` the client plays for this disruption.');

export const DisruptionDefSchema = z
  .strictObject({
    id: idSchema('The disruption id; equals the file name.'),
    kind: z
      .enum(DISRUPTION_KINDS)
      .describe('What it is: it must equal the `kind` of the object it rings at.'),
    ringMaxMs: z
      .number()
      .int()
      .min(PHONE_RINGING_EVERY_MS)
      .describe(
        'How long it rings if nobody answers, in sim ms, at least one `PHONE_RINGING_EVERY_MS` (1000): a shorter ring would never tick. Then it stops for good.',
      ),
    answerBusyMs: z
      .number()
      .int()
      .positive()
      .describe(
        'How long Papa is on the phone once he picks up (« attention détournée »), in sim ms.',
      ),
    answerFatiguePoints: z
      .number()
      .min(0)
      .max(GAUGE_MAX_POINTS)
      .describe('Fatigue points Papa gains when he picks up, in points of the 0-100 gauge.'),
    feedback: DisruptionFeedbackSchema,
  })
  .describe(
    'A kind of disruption: how long it lasts and what answering it costs (GDD › Perturbations).',
  );

export type DisruptionDef = z.infer<typeof DisruptionDefSchema>;
