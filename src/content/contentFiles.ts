import type { z } from 'zod';
import { SNAKE_ID_PATTERN } from './levelNodeNames.ts';
import { type BotSettings, BotsSchema } from './schemas/bots.ts';
import { type DisruptionDef, DisruptionDefSchema } from './schemas/disruption.ts';
import { type FeedbackTable, FeedbackTableSchema } from './schemas/feedback.ts';
import { type Feel, FeelSchema } from './schemas/feel.ts';
import { type Level, LevelSchema } from './schemas/level.ts';
import { type LevelGeometry, LevelGeometrySchema } from './schemas/levelGeometry.ts';
import { PlaytestSchema, type PlaytestThresholds } from './schemas/playtest.ts';
import { type SequenceDef, SequenceDefSchema } from './schemas/sequence.ts';
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

export const BOTS_FILE: ContentFile<BotSettings> = {
  file: 'bots.json',
  schemaName: 'bots',
  schema: BotsSchema,
};

export const STRINGS_FILE: ContentFile<Strings> = {
  file: 'strings.fr.json',
  schemaName: 'strings',
  schema: StringsSchema,
};

/**
 * The thresholds of `npm run playtest:metrics`. A tool-only file: registered below so that
 * `content:check` validates it and `content:schemas` emits its JSON Schema, but `loadContent` does
 * not load it and the browser bundle does not ship it.
 */
export const PLAYTEST_FILE: ContentFile<PlaytestThresholds> = {
  file: 'playtest.json',
  schemaName: 'playtest',
  schema: PlaytestSchema,
};

/**
 * Registry of the files `content:check` and `content:schemas` know. `loadContent` loads the first
 * four by name (a story that adds a game content file adds its entry here and a field to
 * `ContentBundle`); a tool-only file such as `PLAYTEST_FILE` is registered but not loaded.
 */
export const CONTENT_FILES: readonly ContentFile<unknown>[] = [
  FEEL_FILE,
  FEEDBACK_FILE,
  BOTS_FILE,
  STRINGS_FILE,
  PLAYTEST_FILE,
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

export const DISRUPTION_DEF_PATTERN: ContentPattern<DisruptionDef> = {
  dir: 'disruptions',
  suffix: '.json',
  schemaName: 'disruption',
  schema: DisruptionDefSchema,
};

export const SEQUENCE_DEF_PATTERN: ContentPattern<SequenceDef> = {
  dir: 'sequences',
  suffix: '.json',
  schemaName: 'sequence',
  schema: SequenceDefSchema,
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
  DISRUPTION_DEF_PATTERN,
  SEQUENCE_DEF_PATTERN,
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
