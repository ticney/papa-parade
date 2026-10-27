// Scanner behind uiStrings.test.ts: no player-facing text is written in src/client/ui, and every
// string key the client mentions exists in content/strings.fr.json. Same approach as scanners.ts
// (a masked copy of the source plus regexes), covered by fixtures in fixtures/uiStrings.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { maskSource, type Violation } from './scanners.ts';

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const QUOTES = new Set(["'", '"', '`']);
const STRING_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
// French prose: accents, « » and … are all outside ASCII, and no UI code has a reason to hold them.
const PROSE = /\P{ASCII}/u;
// Properties that show text when assigned (`=` or `+=`).
const TEXT_PROPERTY =
  /\.(textContent|innerText|innerHTML|outerHTML|ariaLabel|ariaDescription|ariaValueText|ariaPlaceholder|title|alt|placeholder)\s*\+?=(?!=)\s*/g;
// Calls whose arguments become visible text.
const TEXT_CALL = /\b(append|prepend|replaceChildren|createTextNode|insertAdjacentText)\s*\(/g;
const SET_ATTRIBUTE = /\bsetAttribute\s*\(/g;
const TEXT_ATTRIBUTES = new Set([
  'aria-label',
  'aria-description',
  'aria-valuetext',
  'aria-roledescription',
  'aria-placeholder',
  'title',
  'alt',
  'placeholder',
]);
// Calls whose literal arguments are keys, tags or selectors, not text: `t('key')`,
// `createElement('span')`, `querySelector('.x')`...
const NOT_TEXT_CALL =
  /\b(?:t|createElement|createElementNS|querySelector|querySelectorAll|getElementById|getAttribute|hasAttribute)\s*\([^()]*\)/g;

/** The client's source files (tests excluded), the ones `scanUiStrings` reads. */
export function listClientSources(rootDir: string): string[] {
  const clientDir = join(rootDir, 'src', 'client');
  return existsSync(clientDir) ? walk(clientDir) : [];
}

function walk(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...walk(full));
    else if (SOURCE_FILE.test(name) && !TEST_FILE.test(name)) files.push(full);
  }
  return files;
}

interface Argument {
  /** Index in the masked source of the first non-space character. */
  start: number;
  /** The masked text of the argument. */
  text: string;
}

/** The top-level arguments of the call whose `(` is at `open` (literal contents are blanked). */
function callArguments(masked: string, open: number): Argument[] {
  const args: Argument[] = [];
  let depth = 0;
  let from = open + 1;
  for (let i = open; i < masked.length; i++) {
    const c = masked[i] as string;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      depth--;
      if (depth === 0) {
        args.push(argument(masked, from, i));
        return args;
      }
    } else if (c === ',' && depth === 1) {
      args.push(argument(masked, from, i));
      from = i + 1;
    }
  }
  return args;
}

function argument(masked: string, from: number, to: number): Argument {
  const raw = masked.slice(from, to);
  const lead = raw.length - raw.trimStart().length;
  return { start: from + lead, text: raw.trim() };
}

/** The end of the expression that starts at `from`: the next `;` or `}` at depth 0. */
function expressionEnd(masked: string, from: number): number {
  let depth = 0;
  for (let i = from; i < masked.length; i++) {
    const c = masked[i] as string;
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '}') {
      if (depth === 0) return i;
      depth--;
    } else if (c === ';' && depth === 0) return i;
    if (depth < 0) return i;
  }
  return masked.length;
}

export function scanUiStrings(
  rootDir: string,
  strings: Readonly<Record<string, string>>,
): Violation[] {
  const groups = new Set(Object.keys(strings).map((key) => key.slice(0, key.indexOf('.'))));
  const violations: Violation[] = [];

  for (const path of listClientSources(rootDir)) {
    const file = relative(rootDir, path).split(sep).join('/');
    const isUi = file.startsWith('src/client/ui/');
    const source = readFileSync(path, 'utf8');
    const { masked, literals, templatePrefixes } = maskSource(source);
    const add = (rule: string, message: string, detail: string): void => {
      violations.push({ file, rule, message, detail });
    };

    /**
     * The text of every top-level literal inside masked[from, to), outside `t('key')` calls. A template with
     * substitutions counts through all its text, not only the part before the first `${`.
     */
    const textLiterals = (from: number, to: number): string[] => {
      const span = masked.slice(from, to).replace(NOT_TEXT_CALL, (call) => ' '.repeat(call.length));
      const found: string[] = [];
      // Only literals at the top level of the expression: `cond ? 'a' : 'b'`, `x || 'a'`, `'a' + b`.
      // A literal inside a nested call (`append(svgElement('svg', …))`) is that call's business.
      let depth = 0;
      for (let i = 0; i < span.length; i++) {
        const char = span[i] as string;
        if (char === '(' || char === '[' || char === '{') depth++;
        else if (char === ')' || char === ']' || char === '}') depth--;
        if (depth !== 0 || !QUOTES.has(char)) continue;
        const open = from + i;
        const literal = literals.get(open);
        if (literal !== undefined) {
          if (literal.trim() !== '') found.push(literal);
        } else if (templatePrefixes.has(open)) {
          const close = source.indexOf('`', open + 1);
          const raw = source.slice(open + 1, close === -1 ? source.length : close);
          const text = raw.replace(/\$\{[^}]*\}/g, '');
          if (/\p{L}/u.test(text)) found.push(text);
        }
      }
      return found;
    };

    // U3: a string-key-shaped literal whose group exists but whose key does not.
    for (const text of [...literals.values(), ...templatePrefixes.values()]) {
      if (!STRING_KEY.test(text)) continue;
      const group = text.slice(0, text.indexOf('.'));
      if (groups.has(group) && !Object.hasOwn(strings, text)) {
        add('U3', 'string key is not in content/strings.fr.json', text);
      }
    }

    if (!isUi) continue;

    // U2: French prose in any literal.
    for (const text of [...literals.values(), ...templatePrefixes.values()]) {
      if (PROSE.test(text)) add('U2', 'player-facing prose in src/client/ui: use t(key)', text);
    }

    // U1: a literal reaches a text sink, whatever the expression around it (`+=`, `? :`, `||`, `+`).
    for (const match of masked.matchAll(TEXT_PROPERTY)) {
      const from = match.index + match[0].length;
      for (const text of textLiterals(from, expressionEnd(masked, from))) {
        add('U1', 'literal text assigned to a visible property: use t(key)', text);
      }
    }
    for (const match of masked.matchAll(TEXT_CALL)) {
      for (const arg of callArguments(masked, match.index + match[0].length - 1)) {
        for (const text of textLiterals(arg.start, arg.start + arg.text.length)) {
          add('U1', `literal text passed to ${match[1]}(): use t(key)`, text);
        }
      }
    }
    for (const match of masked.matchAll(SET_ATTRIBUTE)) {
      const [name, value] = callArguments(masked, match.index + match[0].length - 1);
      if (name === undefined || value === undefined) continue;
      const attribute = literals.get(name.start);
      if (attribute === undefined || !TEXT_ATTRIBUTES.has(attribute)) continue;
      for (const text of textLiterals(value.start, value.start + value.text.length)) {
        add('U1', `literal text set as ${attribute}: use t(key)`, text);
      }
    }
  }
  return violations;
}
