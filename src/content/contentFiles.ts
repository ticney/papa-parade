import type { z } from 'zod';
import { type Feel, FeelSchema } from './schemas/feel.ts';
import { type LevelGeometry, LevelGeometrySchema } from './schemas/levelGeometry.ts';
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

/**
 * A family of content files that share one schema and are named after what they describe (one per
 * level): `content/<dir>/<id><suffix>`. Not listed one by one in `CONTENT_FILES`, which stays the
 * registry of files that must exist.
 */
export interface ContentPattern<T> {
  /** Folder under `content/`. */
  dir: string;
  /** What follows the id in the file name (`'.geometry.json'`). */
  suffix: string;
  schemaName: string;
  schema: z.ZodType<T>;
}

export const LEVEL_GEOMETRY_PATTERN: ContentPattern<LevelGeometry> = {
  dir: 'levels',
  suffix: '.geometry.json',
  schemaName: 'levelGeometry',
  schema: LevelGeometrySchema,
};

export const CONTENT_PATTERNS: readonly ContentPattern<unknown>[] = [LEVEL_GEOMETRY_PATTERN];

/** The pattern a file (relative to `content/`) belongs to, with the id its name carries. */
export function matchContentPattern(
  file: string,
): { pattern: ContentPattern<unknown>; id: string } | undefined {
  for (const pattern of CONTENT_PATTERNS) {
    const prefix = `${pattern.dir}/`;
    if (!file.startsWith(prefix) || !file.endsWith(pattern.suffix)) continue;
    const id = file.slice(prefix.length, file.length - pattern.suffix.length);
    if (id !== '' && !id.includes('/')) return { pattern, id };
  }
  return undefined;
}

/** Every schema that has a generated `content/_schemas/<schemaName>.schema.json`. */
export const CONTENT_SCHEMAS: readonly { schemaName: string; schema: z.ZodType }[] = [
  ...CONTENT_FILES,
  ...CONTENT_PATTERNS,
];
