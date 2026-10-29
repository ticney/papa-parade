import { resolve } from 'node:path';
import { FEEL_WRITER_MAX_BODY_BYTES } from '../../src/shared/constants.ts';

// Imports are relative on purpose: `vite.config.ts` loads this file before the path aliases exist.

/** The one file the `feel-writer` may write, relative to the project root. */
export const FEEL_FILE = 'content/feel.json';

export interface FeelWriteRequest {
  /** The HTTP method, as received. */
  method: string | undefined;
  /** The body, already read; the size is checked here too. */
  bodyText: string;
}

export interface FeelWriteDeps {
  /** The project root: the only file written is `<root>/content/feel.json`. */
  root: string;
  readText(path: string): Promise<string>;
  /** Writes `text` whole, or throws without leaving a half file. */
  writeText(path: string, text: string): Promise<void>;
  /** The paths and messages `FeelSchema` objects to in this feel, or `[]` when it is valid. */
  validate(feel: unknown): string[];
  /** The text as the project's formatter writes it (Biome), or a rejection. It is re-parsed and re-validated before it is written. */
  format(text: string): Promise<string>;
}

export interface FeelWriteResponse {
  status: number;
  body: { ok: boolean; message: string; changed?: string[] };
}

const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const refuse = (status: number, message: string): FeelWriteResponse => ({
  status,
  body: { ok: false, message },
});

/** `patch` laid over `base`: objects merge key by key, anything else (arrays included) replaces. Key order is the file's. */
function merge(base: unknown, patch: unknown): unknown {
  if (!isRecord(base) || !isRecord(patch)) return patch;
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) merged[key] = merge(base[key], value);
  return merged;
}

/** The first unsafe key of a patch, at any depth, or null. */
function unsafeKey(value: unknown): string | null {
  if (!isRecord(value)) return null;
  for (const [key, child] of Object.entries(value)) {
    if (UNSAFE_KEYS.includes(key)) return key;
    const inner = unsafeKey(child);
    if (inner !== null) return inner;
  }
  return null;
}

function leafKeys(value: unknown, prefix = ''): string[] {
  if (!isRecord(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    leafKeys(child, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/**
 * The paths of the objects that the file writes on one line (`{ "timeScale": 0.3, … }`), so a write
 * puts them back that way: `JSON.stringify(…, 2)` would expand them and the diff would show more
 * than the key that was changed. A small scanner, not a parser: it only follows brackets, strings
 * and keys.
 */
function collapsedObjectPaths(text: string): Set<string> {
  const collapsed = new Set<string>();
  // One frame per open bracket: its path, and the key being read (objects) or the index (arrays).
  const stack: { path: string; isObject: boolean; key: string; index: number }[] = [];
  let i = 0;
  const readString = (): string => {
    let out = '';
    i++; // the opening quote
    while (i < text.length && text[i] !== '"') {
      if (text[i] === '\\') {
        out += text.slice(i, i + 2);
        i += 2;
      } else out += text[i++];
    }
    i++; // the closing quote
    return out;
  };
  const pathOfChild = (): string => {
    const top = stack[stack.length - 1];
    if (top === undefined) return '';
    const step = top.isObject ? top.key : `[${top.index}]`;
    return top.path === '' ? step : `${top.path}${top.isObject ? '.' : ''}${step}`;
  };
  while (i < text.length) {
    const c = text[i] as string;
    if (c === '"') {
      const value = readString();
      const top = stack[stack.length - 1];
      let j = i;
      while (/\s/.test(text[j] ?? '')) j++;
      if (top?.isObject && text[j] === ':') top.key = value;
    } else if (c === '{' || c === '[') {
      const path = pathOfChild();
      let j = i + 1;
      while (text[j] === ' ' || text[j] === '\t') j++;
      if (c === '{' && text[j] !== '\n' && text[j] !== '\r') collapsed.add(path);
      stack.push({ path, isObject: c === '{', key: '', index: 0 });
      i++;
    } else if (c === '}' || c === ']') {
      stack.pop();
      i++;
    } else if (c === ',') {
      const top = stack[stack.length - 1];
      if (top !== undefined && !top.isObject) top.index++;
      i++;
    } else i++;
  }
  return collapsed;
}

const isScalar = (value: unknown): boolean => typeof value !== 'object' || value === null;

function stringifyAs(value: unknown, path: string, depth: number, collapsed: Set<string>): string {
  if (isScalar(value)) return JSON.stringify(value);
  const pad = '  '.repeat(depth + 1);
  const end = '  '.repeat(depth);
  if (Array.isArray(value)) {
    if (value.every(isScalar)) return `[${value.map((item) => JSON.stringify(item)).join(', ')}]`;
    const items = value.map(
      (item, index) => `${pad}${stringifyAs(item, `${path}[${index}]`, depth + 1, collapsed)}`,
    );
    return `[\n${items.join(',\n')}\n${end}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return '{}';
  if (collapsed.has(path) && entries.every(([, child]) => isScalar(child))) {
    return `{ ${entries.map(([key, child]) => `${JSON.stringify(key)}: ${JSON.stringify(child)}`).join(', ')} }`;
  }
  const lines = entries.map(([key, child]) => {
    const childPath = path === '' ? key : `${path}.${key}`;
    return `${pad}${JSON.stringify(key)}: ${stringifyAs(child, childPath, depth + 1, collapsed)}`;
  });
  return `{\n${lines.join(',\n')}\n${end}}`;
}

/**
 * `value` as JSON text laid out like `original`: two-space indent, scalar arrays on one line, and
 * the objects that `original` wrote on one line still on one line. An unchanged value gives
 * `original` back byte for byte, so a save changes only the keys that were edited.
 */
export function stringifyLike(original: string, value: unknown): string {
  return `${stringifyAs(value, '', 0, collapsedObjectPaths(original))}\n`;
}

/** Why the formatted text cannot be written (not JSON, invalid, or not the merged feel), or null. */
function problemWithFormatted(
  text: string,
  merged: unknown,
  validate: FeelWriteDeps['validate'],
): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return 'text that is not JSON';
  }
  const problems = validate(parsed);
  if (problems.length > 0) return `an invalid feel: ${problems.join('; ')}`;
  if (JSON.stringify(parsed) !== JSON.stringify(merged))
    return 'a feel that differs from the merge';
  return null;
}

/**
 * What the dev server answers to a `POST` on the `feel-writer` endpoint (story 2.1, architecture
 * P6 and its security note: the dev server may be open to the LAN). The request is `{ file, patch }`:
 * `file` must resolve to `<root>/content/feel.json` and nothing else (403), `patch` is merged into
 * the file's own JSON (never into the effective feel, so a level's `feelOverrides` cannot leak
 * in), the result must pass `FeelSchema` (400, file untouched) and is written as the formatter
 * would. A refused request leaves the file byte for byte as it was.
 */
export async function handleFeelWrite(
  request: FeelWriteRequest,
  deps: FeelWriteDeps,
): Promise<FeelWriteResponse> {
  if (request.method !== 'POST') return refuse(405, 'the feel-writer answers POST only');
  if (Buffer.byteLength(request.bodyText, 'utf8') > FEEL_WRITER_MAX_BODY_BYTES) {
    return refuse(413, `the request body is over ${FEEL_WRITER_MAX_BODY_BYTES} bytes`);
  }
  let body: unknown;
  try {
    body = JSON.parse(request.bodyText);
  } catch {
    return refuse(400, 'the request body is not JSON');
  }
  if (!isRecord(body) || typeof body.file !== 'string' || !isRecord(body.patch)) {
    return refuse(400, 'the request must be { file: string, patch: object }');
  }
  const target = resolve(deps.root, FEEL_FILE);
  if (body.file.includes('\0') || resolve(deps.root, body.file) !== target) {
    return refuse(403, `the feel-writer writes ${FEEL_FILE} only`);
  }
  const bad = unsafeKey(body.patch);
  if (bad !== null) return refuse(400, `the patch has the forbidden key ${bad}`);

  let current: unknown;
  let originalText = '';
  try {
    originalText = await deps.readText(target);
    current = JSON.parse(originalText);
  } catch (cause) {
    return refuse(
      500,
      `cannot read ${FEEL_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  const merged = merge(current, body.patch);
  const problems = deps.validate(merged);
  if (problems.length > 0) {
    return refuse(400, `${FEEL_FILE} would be invalid: ${problems.join('; ')}`);
  }
  try {
    const text = await deps.format(stringifyLike(originalText, merged));
    // The formatter's output is what lands in the file: it must still be the feel that was
    // validated (an empty or garbled output from a failing Biome must never become the file).
    const problem = problemWithFormatted(text, merged, deps.validate);
    if (problem !== null) {
      return refuse(500, `cannot write ${FEEL_FILE}: the formatter returned ${problem}`);
    }
    await deps.writeText(target, text);
  } catch (cause) {
    return refuse(
      500,
      `cannot write ${FEEL_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  return {
    status: 200,
    body: { ok: true, message: `saved ${FEEL_FILE}`, changed: leafKeys(body.patch) },
  };
}
