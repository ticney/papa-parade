import type { z } from 'zod';
import { SNAKE_ID_PATTERN } from './levelNodeNames.ts';
import { type FeedbackTable, FeedbackTableSchema } from './schemas/feedback.ts';
import { type Feel, FeelSchema } from './schemas/feel.ts';
import { type Level, LevelSchema } from './schemas/level.ts';
import { type LevelGeometry, LevelGeometrySchema } from './schemas/levelGeometry.ts';
import { type Strings, StringsSchema } from './schemas/strings.ts';
import { type ThreatDef, ThreatDefSchema } from './schemas/threat.ts';

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

export const FEEDBACK_FILE: ContentFile<FeedbackTable> = {
  file: 'feedback.json',
  schemaName: 'feedback',
  schema: FeedbackTableSchema,
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
export const CONTENT_FILES: readonly ContentFile<unknown>[] = [
  FEEL_FILE,
  FEEDBACK_FILE,
  STRINGS_FILE,
];

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

export const THREAT_DEF_PATTERN: ContentPattern<ThreatDef> = {
  dir: 'threats',
  suffix: '.json',
  schemaName: 'threat',
  schema: ThreatDefSchema,
};

export const LEVEL_PATTERN: ContentPattern<Level> = {
  dir: 'levels',
  suffix: '.json',
  schemaName: 'level',
  schema: LevelSchema,
};

/** `LEVEL_GEOMETRY_PATTERN` goes before `LEVEL_PATTERN`: both live in `levels/`. */
export const CONTENT_PATTERNS: readonly ContentPattern<unknown>[] = [
  LEVEL_GEOMETRY_PATTERN,
  THREAT_DEF_PATTERN,
  LEVEL_PATTERN,
];

/**
 * The pattern a file (relative to `content/`) belongs to, with the id its name carries. An id is
 * `lower_snake_case`: `levels/salon_crawler.geometry.json` is a geometry, never a level whose id
 * would be `salon_crawler.geometry`.
 */
export function matchContentPattern(
  file: string,
  patterns: readonly ContentPattern<unknown>[] = CONTENT_PATTERNS,
): { pattern: ContentPattern<unknown>; id: string } | undefined {
  for (const pattern of patterns) {
    const prefix = `${pattern.dir}/`;
    if (!file.startsWith(prefix) || !file.endsWith(pattern.suffix)) continue;
    const id = file.slice(prefix.length, file.length - pattern.suffix.length);
    if (SNAKE_ID_PATTERN.test(id)) return { pattern, id };
  }
  return undefined;
}

/** Every schema that has a generated `content/_schemas/<schemaName>.schema.json`. */
export const CONTENT_SCHEMAS: readonly { schemaName: string; schema: z.ZodType }[] = [
  ...CONTENT_FILES,
  ...CONTENT_PATTERNS,
];
