// Scanner behind uiStrings.test.ts: no player-facing text is written in src/client/ui, and every
// string key the client mentions exists in content/strings.fr.json. Same approach as scanners.ts
// (a masked copy of the source plus regexes), covered by fixtures in fixtures/uiStrings.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { maskSource, type Violation } from './scanners.ts';

const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const QUOTES = new Set(["'", '"', '`']);
const STRING_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
// French prose: accents, « » and … are all outside ASCII, and no UI code has a reason to hold them.
const PROSE = /\P{ASCII}/u;
// Properties that show text when assigned.
const TEXT_PROPERTY =
  /\.(textContent|innerText|innerHTML|outerHTML|ariaLabel|title|alt|placeholder)\s*=(?!=)\s*/g;
// Calls whose arguments become visible text.
const TEXT_CALL = /\b(append|prepend|replaceChildren|createTextNode|insertAdjacentText)\s*\(/g;
const SET_ATTRIBUTE = /\bsetAttribute\s*\(/g;
const TEXT_ATTRIBUTES = new Set(['aria-label', 'title', 'alt', 'placeholder']);

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

export function scanUiStrings(
  rootDir: string,
  strings: Readonly<Record<string, string>>,
): Violation[] {
  const clientDir = join(rootDir, 'src', 'client');
  const groups = new Set(Object.keys(strings).map((key) => key.slice(0, key.indexOf('.'))));
  const violations: Violation[] = [];

  let files: string[];
  try {
    files = walk(clientDir);
  } catch {
    // No src/client in this root: nothing to scan (a fixture may be that minimal).
    return violations;
  }

  for (const path of files) {
    const file = relative(rootDir, path).split(sep).join('/');
    const isUi = file.startsWith('src/client/ui/');
    const source = readFileSync(path, 'utf8');
    const { masked, literals, templatePrefixes } = maskSource(source);
    const textAt = (open: number): string => literals.get(open) ?? templatePrefixes.get(open) ?? '';
    const add = (rule: string, message: string, detail: string): void => {
      violations.push({ file, rule, message, detail });
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

    // U1: a literal reaches a text sink.
    for (const match of masked.matchAll(TEXT_PROPERTY)) {
      const open = match.index + match[0].length;
      if (QUOTES.has(masked[open] as string) && textAt(open) !== '') {
        add('U1', 'literal text assigned to a visible property: use t(key)', textAt(open));
      }
    }
    for (const match of masked.matchAll(TEXT_CALL)) {
      const args = callArguments(masked, match.index + match[0].length - 1);
      for (const arg of args) {
        if (QUOTES.has(arg.text[0] as string) && textAt(arg.start) !== '') {
          add('U1', `literal text passed to ${match[1]}(): use t(key)`, textAt(arg.start));
        }
      }
    }
    for (const match of masked.matchAll(SET_ATTRIBUTE)) {
      const [name, value] = callArguments(masked, match.index + match[0].length - 1);
      if (name === undefined || value === undefined) continue;
      if (!TEXT_ATTRIBUTES.has(textAt(name.start))) continue;
      if (QUOTES.has(value.text[0] as string) && textAt(value.start) !== '') {
        add('U1', `literal text set as ${textAt(name.start)}: use t(key)`, textAt(value.start));
      }
    }
  }
  return violations;
}
