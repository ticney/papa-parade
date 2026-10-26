import type { z } from 'zod';
import { type Feel, FeelSchema } from './schemas/feel.ts';
import { type Strings, StringsSchema } from './schemas/strings.ts';

export interface ContentFile<T> {
  /** Relative to `content/` (`'feel.json'`, later `'threats/outlet.json'`). */
  file: string;
  /** Name of the generated `content/_schemas/<schemaName>.schema.json`. */
  schemaName: string;
  schema: z.ZodType<T>;
}

export const FEEL_FILE: ContentFile<Feel> = {
  file: 'feel.json',
  schemaName: 'feel',
  schema: FeelSchema,
};

export const STRINGS_FILE: ContentFile<Strings> = {
  file: 'strings.fr.json',
  schemaName: 'strings',
  schema: StringsSchema,
};

/**
 * Single source for `loadContent`, `content:check` and `content:schemas`. A story that adds a
 * content file adds its entry here (and a field to `ContentBundle`).
 */
export const CONTENT_FILES: readonly ContentFile<unknown>[] = [FEEL_FILE, STRINGS_FILE];
