import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { FEEDBACK_CLIENT_EVENTS } from '@client/feedback/feedbackEvents';
import type { ContentProblem } from '@content/contentError';
import {
  CONTENT_FILES,
  CONTENT_SCHEMAS,
  FEEDBACK_FILE,
  LEVEL_GEOMETRY_PATTERN,
  LEVEL_PATTERN,
  matchContentPattern,
  STRINGS_FILE,
  THREAT_DEF_PATTERN,
} from '@content/contentFiles';
import { formatJsonPath } from '@content/jsonPath';
import { renderContentJsonSchema } from '@content/jsonSchema';
import { parseContentFile } from '@content/parseContentFile';
import type { FeedbackTable } from '@content/schemas/feedback';
import type { Level } from '@content/schemas/level';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import type { ThreatDef } from '@content/schemas/threat';
import { checkStringReferences } from '@content/stringRefs';
import { GAG_IDS, SIM_EVENT_TYPES } from '@sim';

const SCHEMAS_DIR = '_schemas';
const AUDIO_DIR = ['public', 'assets', 'audio'];
// `t('some.key')` with a literal key and nothing else. A non-literal argument cannot be checked.
const LITERAL_T_CALL = /(?<![\w$.])t\(\s*(['"])([^'"\n]+)\1\s*\)/g;

async function walk(dir: string, skip: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (skip(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path, skip)));
    else files.push(path);
  }
  return files;
}

const posixRelative = (from: string, to: string): string => relative(from, to).split(sep).join('/');

/** Every `*.json` under `<rootDir>/content` except `_schemas/`, as paths relative to `content/`. */
export async function listContentFiles(rootDir: string): Promise<string[]> {
  const contentDir = join(rootDir, 'content');
  const files = await walk(contentDir, (name) => name === SCHEMAS_DIR);
  return files
    .filter((file) => file.endsWith('.json'))
    .map((file) => posixRelative(contentDir, file));
}

/** The `_schemas/*.schema.json` files that no registered content file generates: stale or hand-made. */
export async function listOrphanSchemas(rootDir: string): Promise<string[]> {
  const expected = new Set(CONTENT_SCHEMAS.map((entry) => `${entry.schemaName}.schema.json`));
  const names = await readdir(join(rootDir, 'content', SCHEMAS_DIR)).catch(() => [] as string[]);
  return names.filter((name) => name.endsWith('.schema.json') && !expected.has(name)).sort();
}

/** Blanks `//` and block comments, leaving string literals (and newlines) as they are. */
export function stripComments(source: string): string {
  let out = '';
  let quote = '';
  for (let i = 0; i < source.length; i++) {
    const c = source[i] as string;
    const next = source[i + 1];
    if (quote !== '') {
      out += c;
      if (c === '\\') out += source[++i] ?? '';
      // Only a template literal spans lines: a lone quote (in a regex literal, say) ends with its line.
      else if (c === quote || (c === '\n' && quote !== '`')) quote = '';
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop - 1;
    } else {
      if (c === '"' || c === "'" || c === '`') quote = c;
      out += c;
    }
  }
  return out;
}

function isCheckedSource(name: string): boolean {
  return name.endsWith('.ts') && !name.endsWith('.test.ts') && !name.endsWith('.spec.ts');
}

async function checkSourceReferences(
  rootDir: string,
  strings: Record<string, string>,
): Promise<ContentProblem[]> {
  const files = await walk(
    join(rootDir, 'src'),
    (name) => name === 'fixtures' || name === 'node_modules',
  );
  const problems: ContentProblem[] = [];
  for (const path of files.filter((file) => isCheckedSource(file))) {
    const source = stripComments(await readFile(path, 'utf8'));
    for (const match of source.matchAll(LITERAL_T_CALL)) {
      const key = match[2] as string;
      if (Object.hasOwn(strings, key)) continue;
      const line = source.slice(0, match.index).split('\n').length;
      problems.push({
        file: posixRelative(rootDir, path),
        jsonPath: '',
        message: `line ${line}: string key "${key}" is not in content/${STRINGS_FILE.file}`,
      });
    }
  }
  return problems;
}

const exists = (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

/**
 * The cross-references of `feedback.json` that its schema cannot see: an `events` key is the name
 * of a sim or client event (a typo is a cue that never plays), a client event's cue has neither
 * visual nor camera (they need a world), a cue an event points at has no `threat`-anchored visual
 * (a generic event names no threat), and every clip is a file under `public/assets/audio/`.
 * (That an `events` value is a cue of `cues` is the schema's own check.)
 */
async function checkFeedbackReferences(
  rootDir: string,
  table: FeedbackTable,
): Promise<ContentProblem[]> {
  const file = `content/${FEEDBACK_FILE.file}`;
  const problems: ContentProblem[] = [];
  const eventNames = new Set<string>([...SIM_EVENT_TYPES, ...FEEDBACK_CLIENT_EVENTS]);
  for (const [name, cueId] of Object.entries(table.events)) {
    if (!eventNames.has(name)) {
      problems.push({
        file,
        jsonPath: formatJsonPath(['events', name]),
        message: `"${name}" is not an event name (a SimEvent type or a client event the director listens to)`,
      });
    }
    // A client event has no sim world to read: its cue cannot draw a ring or shake the room (the
    // director would skip them without a word). The schema has already checked that the cue exists.
    const cue = Object.hasOwn(table.cues, cueId) ? table.cues[cueId] : undefined;
    const isClientEvent = (FEEDBACK_CLIENT_EVENTS as readonly string[]).includes(name);
    if (
      isClientEvent &&
      cue !== undefined &&
      (cue.visual !== undefined || cue.camera !== undefined)
    ) {
      problems.push({
        file,
        jsonPath: formatJsonPath(['events', name]),
        message: `"${name}" is a client event with no world: its cue "${cueId}" cannot have a visual or a camera`,
      });
    }
    // A generic event names no threat: a ring anchored on one has nowhere to start from.
    if (cue?.visual?.anchor === 'threat') {
      problems.push({
        file,
        jsonPath: formatJsonPath(['cues', cueId, 'visual', 'anchor']),
        message: `the cue "${cueId}" is played by the event "${name}", which names no threat: its visual cannot be anchored on a threat`,
      });
    }
  }
  const clipPaths: { clip: string; path: (string | number)[] }[] = [
    { clip: table.loops.babble.clip, path: ['loops', 'babble', 'clip'] },
    { clip: table.loops.music.clip, path: ['loops', 'music', 'clip'] },
    ...Object.entries(table.cues).flatMap(([id, cue]) =>
      cue.audio === undefined
        ? []
        : [{ clip: cue.audio.clip, path: ['cues', id, 'audio', 'clip'] }],
    ),
  ];
  for (const { clip, path } of clipPaths) {
    if (await exists(join(rootDir, ...AUDIO_DIR, `${clip}.m4a`))) continue;
    problems.push({
      file,
      jsonPath: formatJsonPath(path),
      message: `no file public/assets/audio/${clip}.m4a (\`npm run assets:audio\` makes the placeholders)`,
    });
  }
  return problems;
}

/** What the cross-reference checks need of the files that parsed, by id. */
interface ParsedFamilies {
  threats: Map<string, ThreatDef>;
  levels: Map<string, Level>;
  geometries: Map<string, LevelGeometry>;
}

/**
 * The references a threat file makes that its schema cannot see: its gag is one the sim knows, and
 * each of its feedback cues is a cue of `feedback.json`.
 */
function checkThreatReferences(
  threats: ReadonlyMap<string, ThreatDef>,
  feedback: FeedbackTable | undefined,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  for (const [id, threat] of threats) {
    const file = `content/${THREAT_DEF_PATTERN.dir}/${id}${THREAT_DEF_PATTERN.suffix}`;
    if (!(GAG_IDS as readonly string[]).includes(threat.gag)) {
      problems.push({
        file,
        jsonPath: 'gag',
        message: `"${threat.gag}" is not a gag of the sim (${GAG_IDS.join(', ')}; a new gag is added to GAG_IDS in src/sim/threats/gags.ts)`,
      });
    }
    if (feedback === undefined) continue;
    for (const [role, cueId] of Object.entries(threat.feedback)) {
      if (Object.hasOwn(feedback.cues, cueId)) continue;
      problems.push({
        file,
        jsonPath: formatJsonPath(['feedback', role]),
        message: `"${cueId}" is not a cue of content/${FEEDBACK_FILE.file} › cues`,
      });
    }
  }
  return problems;
}

/**
 * The references a level file makes: it has its geometry beside it, each planned threat is a threat
 * file, and each anchor is an anchor of that geometry. A file that exists but did not parse was
 * already reported on its own: it is not reported again here.
 */
function checkLevelReferences(
  families: ParsedFamilies,
  present: ReadonlySet<string>,
): ContentProblem[] {
  const problems: ContentProblem[] = [];
  for (const [id, level] of families.levels) {
    const file = `content/${LEVEL_PATTERN.dir}/${id}${LEVEL_PATTERN.suffix}`;
    const geometryFile = `${LEVEL_GEOMETRY_PATTERN.dir}/${id}${LEVEL_GEOMETRY_PATTERN.suffix}`;
    const geometry = families.geometries.get(id);
    if (geometry === undefined && !present.has(geometryFile)) {
      problems.push({
        file,
        jsonPath: '',
        message: `the level has no content/${geometryFile} (\`npm run assets:extract\` writes it)`,
      });
    }
    level.threats.forEach((entry, index) => {
      const defFile = `${THREAT_DEF_PATTERN.dir}/${entry.def}${THREAT_DEF_PATTERN.suffix}`;
      if (!families.threats.has(entry.def) && !present.has(defFile)) {
        problems.push({
          file,
          jsonPath: formatJsonPath(['threats', index, 'def']),
          message: `no threat "${entry.def}" (content/${defFile} does not exist)`,
        });
      }
      if (
        geometry !== undefined &&
        !geometry.anchors.some((anchor) => anchor.id === entry.anchor)
      ) {
        problems.push({
          file,
          jsonPath: formatJsonPath(['threats', index, 'anchor']),
          message: `"${entry.anchor}" is not an anchor of content/${geometryFile}`,
        });
      }
    });
  }
  return problems;
}

/**
 * Everything `npm run content:check` verifies, as a list of problems (empty = OK):
 * every content file against its schema, no content file without a schema, string references from
 * content (`…Key`) and from code (`t('…')`), and the generated JSON Schemas being up to date.
 */
export async function checkContent(rootDir: string): Promise<ContentProblem[]> {
  const problems: ContentProblem[] = [];
  const contentDir = join(rootDir, 'content');
  const parsed: { file: string; value: unknown }[] = [];
  let strings: Record<string, string> | undefined;
  let feedback: FeedbackTable | undefined;
  const families: ParsedFamilies = {
    threats: new Map(),
    levels: new Map(),
    geometries: new Map(),
  };

  for (const file of await listContentFiles(rootDir)) {
    const display = `content/${file}`;
    const entry = CONTENT_FILES.find((candidate) => candidate.file === file);
    const matched = entry === undefined ? matchContentPattern(file) : undefined;
    if (entry === undefined && matched !== undefined) {
      const result = parseContentFile(
        display,
        await readFile(join(contentDir, file), 'utf8'),
        matched.pattern.schema,
      );
      if (!result.ok) {
        problems.push(...result.error);
        continue;
      }
      const id = (result.value as { id?: unknown }).id;
      if (id !== matched.id) {
        problems.push({
          file: display,
          jsonPath: 'id',
          message: `the id "${String(id)}" must equal the file name ("${matched.id}")`,
        });
      }
      parsed.push({ file: display, value: result.value });
      if (matched.pattern === THREAT_DEF_PATTERN) {
        families.threats.set(matched.id, result.value as ThreatDef);
      } else if (matched.pattern === LEVEL_PATTERN) {
        families.levels.set(matched.id, result.value as Level);
      } else if (matched.pattern === LEVEL_GEOMETRY_PATTERN) {
        families.geometries.set(matched.id, result.value as LevelGeometry);
      }
      continue;
    }
    if (entry === undefined) {
      problems.push({
        file: display,
        jsonPath: '',
        message:
          'no schema registered for this file (add it to CONTENT_FILES or CONTENT_PATTERNS in src/content/contentFiles.ts)',
      });
      continue;
    }
    const result = parseContentFile(
      display,
      await readFile(join(contentDir, file), 'utf8'),
      entry.schema,
    );
    if (!result.ok) {
      problems.push(...result.error);
      continue;
    }
    if (entry === STRINGS_FILE) strings = result.value as Record<string, string>;
    else parsed.push({ file: display, value: result.value });
    if (entry === FEEDBACK_FILE) feedback = result.value as FeedbackTable;
  }

  const present = new Set(await listContentFiles(rootDir));
  for (const entry of CONTENT_FILES) {
    if (present.has(entry.file)) continue;
    problems.push({
      file: `content/${entry.file}`,
      jsonPath: '',
      message: 'registered content file is missing',
    });
  }

  for (const name of await listOrphanSchemas(rootDir)) {
    problems.push({
      file: `content/${SCHEMAS_DIR}/${name}`,
      jsonPath: '',
      message:
        'no registered content file generates this schema: delete it or run `npm run content:schemas`',
    });
  }

  for (const entry of CONTENT_SCHEMAS) {
    const display = `content/${SCHEMAS_DIR}/${entry.schemaName}.schema.json`;
    const onDisk = await readFile(join(rootDir, display), 'utf8').catch(() => null);
    if (onDisk !== renderContentJsonSchema(entry.schema)) {
      problems.push({
        file: display,
        jsonPath: '',
        message: 'missing or out of date: run `npm run content:schemas`',
      });
    }
  }

  problems.push(...checkThreatReferences(families.threats, feedback));
  problems.push(...checkLevelReferences(families, present));

  if (feedback !== undefined) problems.push(...(await checkFeedbackReferences(rootDir, feedback)));

  if (strings !== undefined) {
    problems.push(...checkStringReferences(parsed, strings, `content/${STRINGS_FILE.file}`));
    problems.push(...(await checkSourceReferences(rootDir, strings)));
  }
  return problems;
}
