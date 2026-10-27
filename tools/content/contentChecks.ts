import { access, readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { FEEDBACK_CLIENT_EVENTS } from '@client/feedback/feedbackEvents';
import type { ContentProblem } from '@content/contentError';
import {
  CONTENT_FILES,
  CONTENT_SCHEMAS,
  FEEDBACK_FILE,
  matchContentPattern,
  STRINGS_FILE,
} from '@content/contentFiles';
import { formatJsonPath } from '@content/jsonPath';
import { renderContentJsonSchema } from '@content/jsonSchema';
import { parseContentFile } from '@content/parseContentFile';
import type { FeedbackTable } from '@content/schemas/feedback';
import { checkStringReferences } from '@content/stringRefs';
import { SIM_EVENT_TYPES } from '@sim';

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
 * of a sim or client event (a typo is a cue that never plays), an `events` value is a cue of
 * `cues`, and every clip is a file under `public/assets/audio/`.
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
    if (!Object.hasOwn(table.cues, cueId)) {
      problems.push({
        file,
        jsonPath: formatJsonPath(['events', name]),
        message: `the cue "${cueId}" is not in cues`,
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

  if (feedback !== undefined) problems.push(...(await checkFeedbackReferences(rootDir, feedback)));

  if (strings !== undefined) {
    problems.push(...checkStringReferences(parsed, strings, `content/${STRINGS_FILE.file}`));
    problems.push(...(await checkSourceReferences(rootDir, strings)));
  }
  return problems;
}
