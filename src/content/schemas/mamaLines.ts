import { MAMA_REACTIONS } from '@shared/constants';
import { z } from 'zod';
import { SNAKE_ID_PATTERN } from '../levelNodeNames.ts';
import { StringValueSchema } from './strings.ts';

// `content/mama-lines.json`: what Mama says on the Result screen (story 3.8, FR36). A line is picked by
// `chooseMamaLines` (`@sim`) from the reaction she has, what happened in the game and what she remembers
// of the previous ones. Strict, camelCase, no `.default()` or `.transform()`. `content:check` checks what the
// schema cannot (a `tag` is a gag id, an `endReason` a level end reason): the schema may not import the sim.

const idSchema = (description: string) =>
  z.string().regex(SNAKE_ID_PATTERN, 'an id is lower_snake_case').describe(description);

/** A bubble of 750 × 340 must hold the longest line (story 3.8 `[ASSUMPTION]`). */
export const MAMA_LINE_MAX_CHARS = 60;

const MamaLineWhenSchema = z
  .strictObject({
    tag: idSchema(
      'A gag id (`stairs_slide`, `outlet_hair`…) that must have happened in the game she is shown; `content:check` knows the ids.',
    ).optional(),
    minPrevious: z
      .number()
      .int()
      .min(0)
      .describe(
        'With `tag`: in how many *previous* games the tag must have happened at least (0 = first time or not, 1 = « encore »).',
      )
      .optional(),
    endReason: z
      .string()
      .min(1)
      .describe('How the level ended (`timer`, `mamaWoke`, `cycleDone`, `mamaHome`).')
      .optional(),
  })
  .refine(
    (when) =>
      when.tag !== undefined || when.minPrevious !== undefined || when.endReason !== undefined,
    {
      error:
        'a `when` needs at least one of tag, minPrevious, endReason (a line with no condition has no `when`)',
    },
  )
  .refine((when) => when.minPrevious === undefined || when.tag !== undefined, {
    error: '`minPrevious` counts the games of a tag: it needs `tag`',
  })
  .describe(
    'When the line is a candidate. Every key present must hold; the more there are, the more specific the line.',
  );

export const MamaLineSchema = z
  .strictObject({
    id: idSchema('Unique id of the line, lower_snake_case.'),
    reaction: z
      .enum(MAMA_REACTIONS)
      .describe('Which of her three reactions says it: `laugh`, `sigh` or `scream`.'),
    text: StringValueSchema.refine((text) => text.length <= MAMA_LINE_MAX_CHARS, {
      error: `a line is at most ${MAMA_LINE_MAX_CHARS} characters, so the bubble fits a 750 × 340 screen`,
    })
      .refine((text) => (text.match(/\*/g) ?? []).length % 2 === 0, {
        error: 'every `*` opens or closes an emphasis (`*Encore* l’escalier`): they come in pairs',
      })
      .refine((text) => !text.includes('**'), {
        error: 'an emphasis holds a word: `**` is an empty one, or two emphases stuck together',
      })
      .refine((text) => text.replaceAll('*', '').trim() !== '', {
        error: 'a line shows some text besides its asterisks',
      })
      .describe('What she says, in French, tutoiement. `*word*` is shown in italics.'),
    when: MamaLineWhenSchema.optional().describe(
      'Absent: a generic line of its reaction, the fallback when no other line holds.',
    ),
  })
  .describe('One line of Mama.');

export const MamaLinesSchema = z
  .strictObject({
    lines: z
      .array(MamaLineSchema)
      .min(1)
      .describe(
        'Every line she can say. The most specific one that holds wins; a seeded draw breaks a tie.',
      ),
  })
  .superRefine((file, ctx) => {
    // `chooseMamaLines` falls back to a reaction's generic line and throws when it has none: a file that
    // lacks one must not load (a dev server or a playtest build never runs `content:check`).
    for (const reaction of MAMA_REACTIONS) {
      if (!file.lines.some((line) => line.reaction === reaction && line.when === undefined)) {
        ctx.addIssue({
          code: 'custom',
          path: ['lines'],
          message: `no generic line (without \`when\`) for her ${reaction}: she would have nothing to say when no other line holds`,
        });
      }
    }
  })
  .describe('What Mama says on the Result screen, and when (story 3.8, FR36).');

export type MamaLine = z.infer<typeof MamaLineSchema>;
export type MamaLines = z.infer<typeof MamaLinesSchema>;
