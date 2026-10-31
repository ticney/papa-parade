import { z } from 'zod';

/** `group.name`: at least two dot-separated `lower_snake_case` segments. */
export const STRING_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;

/**
 * The player never reads that a level failed (EXPERIENCE.md › Voice and Tone, NFR9). Unicode-aware
 * because JS `\b` is ASCII-only.
 */
export const FORBIDDEN_FAILURE_WORDS =
  /(?<![\p{L}])(?:[eé]chec\p{L}*|[eé]chou\p{L}*|perd\p{L}*|ratée?s?|défaites?|game[\s-]?over|mort(?:e|s|es)?)(?![\p{L}])/iu;

/** Tutoiement register: the game says « tu », never « vous ». */
const VOUVOIEMENT = /(?<![\p{L}])(vous|votre|vos)(?![\p{L}])/iu;

/**
 * Action verbs are shouted: `SOULÈVE !` (plain space, then `!`). The one that asks for patience ends
 * with an ellipsis instead, `ATTENDS…` (story 4.6): nothing is to be done yet.
 */
const VERB_SHAPE = /^[\p{Lu}'’ -]+( !|…)$/u;

const StringValueSchema = z
  .string()
  .min(1, 'a string must not be empty')
  .refine((value) => value === '' || value.trim() !== '', { error: 'a string must not be blank' })
  .refine((value) => !FORBIDDEN_FAILURE_WORDS.test(value), {
    error: 'never name failure to the player (échec, perdu, raté, game over, mort): reword it',
  })
  .refine((value) => !VOUVOIEMENT.test(value), {
    error: 'use the tutoiement register (tu), not vous/votre/vos',
  });

export const StringsSchema = z
  .record(
    z.string().regex(STRING_KEY_PATTERN, 'a string key is group.lower_snake_case'),
    StringValueSchema,
  )
  .check((context) => {
    for (const [key, value] of Object.entries(context.value)) {
      if (key.startsWith('verb.') && !VERB_SHAPE.test(value)) {
        context.issues.push({
          code: 'custom',
          input: value,
          path: [key],
          message:
            'a verb is uppercase and ends with " !" (for example "SOULÈVE !") or with "…" (for example "ATTENDS…")',
        });
      }
    }
  })
  .describe('Every player-facing string, in French, keyed by `group.lower_snake_case`.');

export type Strings = z.infer<typeof StringsSchema>;
