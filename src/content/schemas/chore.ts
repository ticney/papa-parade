import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';
import { VERB_KEY_PATTERN } from './threat.ts';

// `content/chores/<id>.json`: one file per house chore (story 9.4, FR76). A chore is played at a
// station, an object of the level (`level.chores: [{ def, object }]`): Papa works there, each beat
// is judged like a parry, a finished chore fills the Maison row of Mama's note. Same rules as the
// other schemas: strict, camelCase, units in the names, no default.

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

/**
 * The kinds of object a chore can be played at, hence the kinds of station: each one is also an
 * `ObjectKind` (`schemas/level.ts` proves it at compile time). The dishwasher joins the stove in
 * story 9.6.
 */
export const CHORE_STATION_KINDS = ['stove'] as const;
export type ChoreStationKind = (typeof CHORE_STATION_KINDS)[number];

const ChoreBeatSchema = z
  .strictObject({
    verbKey: z
      .string()
      .regex(VERB_KEY_PATTERN, 'a verbKey is a `verb.<name>` key of strings.fr.json')
      .describe(
        'Key of `strings.fr.json` (`verb.` group) of the verb shown at the station while the beat is announced (« REMUE ! », story 9.5).',
      ),
    telegraphDelayMs: z
      .number()
      .int()
      .positive()
      .describe(
        'From the beat being announced to its window opening, in sim ms. Above the base window (`windowMs`, or `feel.timing.windowMs`), so that the ring has time to be read: checked by `content:check`.',
      ),
  })
  .describe('One beat of the chore: a moment to tap the station at the right time.');

const ChoreFeedbackSchema = z
  .strictObject({
    telegraph: idSchema('Cue played when a beat is announced.'),
    success: idSchema('Cue played when a beat is caught inside its window.'),
    perfect: idSchema('Cue played when a beat is caught at the centre of its window.'),
    miss: idSchema('Cue played when a beat is missed (the small gag of the chore).'),
    completed: idSchema('Cue played when the last beat is caught: the chore is done.'),
  })
  .describe('Cues of `feedback.json` › `cues` the client plays for this chore.');

export const ChoreDefSchema = z
  .strictObject({
    id: idSchema('The chore id; equals the file name.'),
    station: z
      .enum(CHORE_STATION_KINDS)
      .describe('Where it is played: it must equal the `kind` of the object the level names.'),
    windowMs: z
      .number()
      .positive()
      .nullable()
      .describe(
        'The base response window of a beat, in sim ms. `null`: the base window of the threats (`feel.timing.windowMs`).',
      ),
    beats: z
      .array(ChoreBeatSchema)
      .min(1)
      .describe(
        'The beats of the chore, in order; each one is caught before the next is announced.',
      ),
    homePoints: z
      .number()
      .min(0)
      .refine((points) => Number.isInteger(points * 2), 'a whole or a half point (7.5)')
      .describe(
        'Points of the Maison row of Mama’s note the chore pays once done: whole or half points (7.5), the note counts that way. An unfinished chore pays nothing.',
      ),
    abandonedThreat: z
      .strictObject({
        def: idSchema(
          'The threat the abandoned chore turns into: a file of `content/threats/` with `target: "station"`.',
        ),
        afterMs: z
          .number()
          .int()
          .positive()
          .describe(
            'How long the chore must stay `paused` (Papa away from the station, beats left to do) before the threat starts, in sim ms.',
          ),
      })
      .optional()
      .describe(
        'Optional: what a chore left alone becomes (story 9.5: « une cuisson abandonnée plus de 30 s devient la casserole sur le feu »). Absent: leaving the chore costs nothing but the wait.',
      ),
    feedback: ChoreFeedbackSchema,
  })
  .describe(
    'A house chore: where it is played, how many beats and how far apart, what it is worth (GDD › Tâches de la maison).',
  );

export type ChoreDef = z.infer<typeof ChoreDefSchema>;
