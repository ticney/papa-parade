import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';

// `content/sequences/<id>.json`: one file per special sequence (story 4.4). A sequence is a short
// stretch of play with its own rules (« Rester éveillé », later the lullaby walk and the bomb
// drop): the flow leaves `playing` for `sequence`, the director stops, and a list of steps runs on
// the sim clock. Same rules as the other schemas: strict, camelCase, units in the names, no
// default, a `.describe()` on every key. The schema accepts only what the sim can judge (the rule
// of `THREAT_RESPONSES`): 4.5 and later add their step kinds, success and failure kinds here.

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

/** What a step is, hence how the sim runs it: one handler per kind (`Record<SequenceStepKind, …>`). */
export const SEQUENCE_STEP_KINDS = ['microSleeps'] as const;
export type SequenceStepKind = (typeof SEQUENCE_STEP_KINDS)[number];

const MicroSleepsStepSchema = z
  .strictObject({
    kind: z
      .literal('microSleeps')
      .describe('Papa fights off sleep: micro-sleeps come at a cadence.'),
    durationMs: z.number().int().positive().describe('How long the step lasts, in sim ms.'),
    gapMinMs: z
      .number()
      .int()
      .positive()
      .describe('Shortest wait between two micro-sleeps in this step, in sim ms.'),
    gapMaxMs: z
      .number()
      .int()
      .positive()
      .describe('Longest wait between two micro-sleeps in this step, in sim ms.'),
  })
  .refine((step) => step.gapMinMs <= step.gapMaxMs, {
    path: ['gapMinMs'],
    error: 'gapMinMs must not be above gapMaxMs',
  })
  .describe('A stretch of the sequence where micro-sleeps come every gapMinMs to gapMaxMs.');

const SequenceStepSchema = z
  .discriminatedUnion('kind', [MicroSleepsStepSchema])
  .describe('One step of a sequence.');

/** What ends a sequence well: the sim judges each kind. */
export const SEQUENCE_SUCCESS_KINDS = ['stepsDone'] as const;
/** What ends a sequence badly: the sim judges each kind. */
export const SEQUENCE_FAILURE_KINDS = ['gag'] as const;

const SuccessSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z
        .literal('stepsDone')
        .describe('Every step ran to its end with no open response left behind.'),
    }),
  ])
  .describe('How the sequence is won.');

const FailureSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('gag').describe('Any gag during the sequence ends it.'),
      hasSnore: z
        .boolean()
        .describe('Whether the failure makes Papa snore and wakes the baby (+noise).'),
    }),
  ])
  .describe('How the sequence is lost.');

const CameraFramingSchema = z
  .strictObject({
    zoomPct: z
      .number()
      .min(0)
      .max(100)
      .describe('Extra zoom at full framing, in % of the base zoom.'),
    focusPct: z
      .number()
      .min(0)
      .max(100)
      .describe('How far the camera pans toward Papa at full framing, in % of the way to him.'),
    inMs: z.number().int().positive().describe('Time to reach full framing, in sim ms.'),
    outMs: z.number().int().positive().describe('Time to come back after the end, in sim ms.'),
  })
  .describe('The light zoom on Papa while the sequence lasts (sim clock: a pause holds it).');

export const SEQUENCE_BAR_FILLS = ['opponent', 'player'] as const;
export const SEQUENCE_BAR_VALUES = ['timeLeft'] as const;

const BarSchema = z
  .strictObject({
    labelKey: z
      .string()
      .min(1)
      .describe('Key of `strings.fr.json` for the bar label (and its accessible name).'),
    fill: z
      .enum(SEQUENCE_BAR_FILLS)
      .describe('`opponent` fills in `gauge-warn` (a boss health bar), `player` in `gauge-calm`.'),
    value: z.enum(SEQUENCE_BAR_VALUES).describe('What the bar shows; `timeLeft` is the time left.'),
  })
  .describe('The sequence bar under the timer.');

const FramingSchema = z
  .strictObject({
    camera: CameraFramingSchema,
    musicLoop: idSchema(
      'Id of `feedback.json › loops.sequenceMusic`: the level stems give way to it.',
    )
      .nullable()
      .describe('The sequence music, or null for no change of music.'),
    bar: BarSchema.nullable().describe(
      'The bar under the timer, or null for no bar (and no compact timer).',
    ),
  })
  .describe('What the client shows around the sequence. The sim ignores it.');

const SequenceFeedbackSchema = z
  .strictObject({
    started: idSchema('Cue played when the sequence starts.'),
    succeeded: idSchema('Cue played when the sequence is won.'),
    failed: idSchema('Cue played when the sequence is lost.'),
  })
  .describe('Cues of `feedback.json` › `cues` the client plays for this sequence.');

export const SequenceDefSchema = z
  .strictObject({
    id: idSchema('The sequence id; equals the file name.'),
    babyCarried: z
      .boolean()
      .describe('Whether Papa holds the baby for the whole sequence (he is taken at the start).'),
    steps: z
      .array(SequenceStepSchema)
      .min(1)
      .describe('The steps, in order. The sequence lasts the sum of their durations.'),
    success: SuccessSchema,
    failure: FailureSchema,
    framing: FramingSchema,
    feedback: SequenceFeedbackSchema,
  })
  .describe('A special sequence: its steps, how it ends and how it looks (story 4.4).');

export type SequenceDef = z.infer<typeof SequenceDefSchema>;
export type SequenceStep = z.infer<typeof SequenceStepSchema>;

/** The sequence's duration: the sum of its steps, never a second key that could disagree. */
export function sequenceDurationMs(def: Pick<SequenceDef, 'steps'>): number {
  let total = 0;
  for (const step of def.steps) total += step.durationMs;
  return total;
}
