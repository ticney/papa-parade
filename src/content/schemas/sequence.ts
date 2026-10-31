import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';
import { CUE_ID_PATTERN } from './feedback.ts';

/** The fastest tempo a `beats` step takes, in beats per minute (a typo such as 90000 is refused). */
const MAX_BEATS_BPM = 300;

// `content/sequences/<id>.json`: one file per special sequence (story 4.4). A sequence is a short
// stretch of play with its own rules (« Rester éveillé », later the lullaby walk and the bomb
// drop): the flow leaves `playing` for `sequence`, the director stops, and a list of steps runs on
// the sim clock. Same rules as the other schemas: strict, camelCase, units in the names, no
// default, a `.describe()` on every key. The schema accepts only what the sim can judge (the rule
// of `THREAT_RESPONSES`): 4.5 and later add their step kinds, success and failure kinds here.

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

/** What a step is, hence how the sim runs it: one handler per kind (`Record<SequenceStepKind, …>`). */
export const SEQUENCE_STEP_KINDS = ['microSleeps', 'beats'] as const;
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

const BeatsStepSchema = z
  .strictObject({
    kind: z
      .literal('beats')
      .describe('Papa walks to the beat of a track whose tempo changes (story 4.5).'),
    durationMs: z
      .number()
      .int()
      .positive()
      .describe(
        'How long the step lasts, in sim ms. The tempo goes linearly from `bpmStart` at the first beat (`leadInMs`) to `bpmEnd` at the end of the step.',
      ),
    track: z
      .string()
      .regex(CUE_ID_PATTERN, 'a track id is lower_snake_case')
      .describe(
        'Id of `feedback.json › beatTracks`: the notes, the count-in tick and the decoy sound.',
      ),
    bpmStart: z
      .number()
      .positive()
      .max(MAX_BEATS_BPM)
      .describe('Tempo of the first beat, in beats per minute.'),
    bpmEnd: z
      .number()
      .positive()
      .max(MAX_BEATS_BPM)
      .describe(
        'Tempo the ramp reaches at the end of the step, in beats per minute. A beat is placed with the tempo of the beat before it, and the last one falls before the end of the step, so this tempo itself is never played.',
      ),
    leadInMs: z
      .number()
      .int()
      .min(0)
      .describe(
        'Wait before the first beat of the count-in, in sim ms from the start of the step.',
      ),
    countInBeats: z
      .number()
      .int()
      .min(0)
      .describe('Beats at the start that are only heard (a tap there is free), counted in beats.'),
    windowMs: z
      .number()
      .int()
      .positive()
      .describe(
        'Length of the window around each judged beat, in sim ms, before the tier and the fatigue.',
      ),
    decoyBeats: z
      .array(z.number().int().min(0))
      .describe(
        'Judged-beat numbers (0-based, count-in excluded) after which an off-beat decoy sits halfway to the next beat. Strictly increasing.',
      ),
  })
  .refine(
    (step) => step.decoyBeats.every((beat, i) => i === 0 || beat > (step.decoyBeats[i - 1] ?? -1)),
    { path: ['decoyBeats'], error: 'decoyBeats must be strictly increasing' },
  )
  .describe('A stretch of the sequence where Papa taps to a lullaby that slows down.');

const SequenceStepSchema = z
  .discriminatedUnion('kind', [MicroSleepsStepSchema, BeatsStepSchema])
  .describe('One step of a sequence.');

/** What ends a sequence well: the sim judges each kind. */
export const SEQUENCE_SUCCESS_KINDS = ['stepsDone'] as const;
/** What ends a sequence badly: the sim judges each kind. */
export const SEQUENCE_FAILURE_KINDS = ['gag', 'babyAwake'] as const;

// Whole percents: a cost such as 33.3 added three times would stop at 99.9 and the baby never wake.
const wakePct = (description: string) => z.number().int().min(0).max(100).describe(description);

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
    z.strictObject({
      kind: z
        .literal('babyAwake')
        .describe(
          'Every miss, decoy tap and stray tap wakes the baby a little; at 100 % he is up.',
        ),
      missWakePct: wakePct('Wake added by a judged beat nobody tapped, in % of the way to awake.'),
      decoyWakePct: wakePct('Wake added by a tap on a decoy, in % of the way to awake.'),
      strayWakePct: wakePct(
        'Wake added by a tap that is on no beat and no decoy (a second tap in a window, a tap between windows), in % of the way to awake.',
      ),
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
export const SEQUENCE_BAR_VALUES = ['timeLeft', 'calmLeft'] as const;

const BarSchema = z
  .strictObject({
    labelKey: z
      .string()
      .min(1)
      .describe('Key of `strings.fr.json` for the bar label (and its accessible name).'),
    fill: z
      .enum(SEQUENCE_BAR_FILLS)
      .describe('`opponent` fills in `gauge-warn` (a boss health bar), `player` in `gauge-calm`.'),
    value: z
      .enum(SEQUENCE_BAR_VALUES)
      .describe(
        "What the bar shows; `timeLeft` is the time left, `calmLeft` the baby's calm left (100 − his wake, needs a `babyAwake` failure).",
      ),
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
  .superRefine((def, ctx) => {
    // The shape rules of the beats, in the words of `sequenceBeatProblems` (the sim's `simLevelOf`
    // and `content:check` also run it, for a def that did not go through this schema; it alone has
    // the rules that need other files: the track, the decoy zones against the feel).
    // A `beats` step is judged by the baby's wake and nothing else, and a wake is only moved by a
    // `beats` step: the pair is one rule, so neither half can be left alone.
    const hasBeats = def.steps.some((step) => step.kind === 'beats');
    const { failure } = def;
    if (hasBeats && failure.kind !== 'babyAwake') {
      ctx.addIssue({
        code: 'custom',
        path: ['failure', 'kind'],
        message: `has a beats step, so its failure must be "babyAwake", not "${failure.kind}"`,
      });
    }
    if (failure.kind === 'babyAwake' && !hasBeats) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure', 'kind'],
        message: 'has a "babyAwake" failure, but no beats step to wake the baby',
      });
    }
    if (hasBeats && def.steps.length > 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['steps'],
        message: `has a beats step among ${def.steps.length} steps, but a beats step must be the only step of its sequence`,
      });
    }
    if (def.framing.bar?.value === 'calmLeft' && failure.kind !== 'babyAwake') {
      ctx.addIssue({
        code: 'custom',
        path: ['framing', 'bar', 'value'],
        message:
          'has a bar that shows calmLeft, but no "babyAwake" failure (nothing wakes the baby)',
      });
    }
    if (
      failure.kind === 'babyAwake' &&
      failure.missWakePct + failure.decoyWakePct + failure.strayWakePct <= 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['failure'],
        message:
          'has a "babyAwake" failure whose missWakePct, decoyWakePct and strayWakePct are all 0 (the baby could never wake)',
      });
    }
  })
  .describe('A special sequence: its steps, how it ends and how it looks (stories 4.4, 4.5).');

export type SequenceDef = z.infer<typeof SequenceDefSchema>;
export type SequenceStep = z.infer<typeof SequenceStepSchema>;
export type BeatsStep = z.infer<typeof BeatsStepSchema>;

/** The sequence's duration: the sum of its steps, never a second key that could disagree. */
export function sequenceDurationMs(def: Pick<SequenceDef, 'steps'>): number {
  let total = 0;
  for (const step of def.steps) total += step.durationMs;
  return total;
}
