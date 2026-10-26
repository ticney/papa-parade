// Source scanners behind the architecture tests. TypeScript 7 ships no JS compiler API, so these
// work on a masked copy of the source (comments and string contents blanked, same length) and a
// small set of regexes. They are covered by fixtures in tests/architecture/fixtures.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

export interface Violation {
  /** Path of the offending file, relative to the scanned root, with `/` separators. */
  file: string;
  rule: string;
  message: string;
  /** Import specifier or banned identifier that triggered the rule. */
  detail: string;
}

// ---------------------------------------------------------------------------------------------
// Source masking
// ---------------------------------------------------------------------------------------------

export interface MaskedSource {
  /** Same length as the source: comments and literal contents replaced by spaces (newlines kept). */
  masked: string;
  /** Content of each string literal (and substitution-free template), keyed by opening-quote index. */
  literals: Map<number, string>;
}

const REGEX_PRECEDING_CHARS = '(,=:[!&|?{};*%<>~^';
const REGEX_PRECEDING_WORDS = new Set([
  'return',
  'typeof',
  'case',
  'void',
  'delete',
  'in',
  'of',
  'throw',
  'new',
  'else',
  'do',
  'yield',
  'await',
]);

export function maskSource(source: string): MaskedSource {
  const n = source.length;
  const out: string[] = new Array<string>(n);
  const literals = new Map<number, string>();
  const templateStack: number[] = [];
  let braceDepth = 0;
  let i = 0;

  const blank = (ch: string): string => (ch === '\n' ? '\n' : ' ');

  // Consumes template characters from `i` (just after a backtick or a `}` closing a substitution)
  // up to the closing backtick or the next `${`. Returns the text it read and whether a
  // substitution started.
  function scanTemplateChars(): { text: string; opensExpression: boolean } {
    let text = '';
    while (i < n) {
      const c = source[i] as string;
      if (c === '\\') {
        text += c + (source[i + 1] ?? '');
        out[i] = ' ';
        if (i + 1 < n) out[i + 1] = blank(source[i + 1] as string);
        i += 2;
      } else if (c === '`') {
        out[i] = '`';
        i++;
        return { text, opensExpression: false };
      } else if (c === '$' && source[i + 1] === '{') {
        out[i] = '$';
        out[i + 1] = '{';
        templateStack.push(braceDepth);
        braceDepth++;
        i += 2;
        return { text, opensExpression: true };
      } else {
        text += c;
        out[i] = blank(c);
        i++;
      }
    }
    return { text, opensExpression: false };
  }

  function previousSignificant(): { char: string; word: string } {
    let j = i - 1;
    while (j >= 0 && /\s/.test(out[j] ?? ' ')) j--;
    if (j < 0) return { char: '', word: '' };
    const char = out[j] as string;
    let k = j;
    while (k >= 0 && /[\w$]/.test(out[k] ?? '')) k--;
    return { char, word: out.slice(k + 1, j + 1).join('') };
  }

  // Tracks whether the template currently being read had a substitution, per opening backtick.
  const templateStarts: { start: number; text: string; hadExpression: boolean }[] = [];

  function continueTemplate(): void {
    const current = templateStarts[templateStarts.length - 1] as {
      start: number;
      text: string;
      hadExpression: boolean;
    };
    const { text, opensExpression } = scanTemplateChars();
    current.text += text;
    if (opensExpression) {
      current.hadExpression = true;
    } else {
      templateStarts.pop();
      if (!current.hadExpression) literals.set(current.start, current.text);
    }
  }

  while (i < n) {
    const c = source[i] as string;
    const d = source[i + 1];

    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') {
        out[i] = ' ';
        i++;
      }
    } else if (c === '/' && d === '*') {
      out[i] = ' ';
      out[i + 1] = ' ';
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        out[i] = blank(source[i] as string);
        i++;
      }
      if (i < n) {
        out[i] = ' ';
        out[i + 1] = ' ';
        i += 2;
      }
    } else if (c === '"' || c === "'") {
      const start = i;
      out[i] = c;
      i++;
      let text = '';
      while (i < n && source[i] !== c && source[i] !== '\n') {
        if (source[i] === '\\' && i + 1 < n) {
          text += (source[i] as string) + (source[i + 1] as string);
          out[i] = ' ';
          out[i + 1] = blank(source[i + 1] as string);
          i += 2;
        } else {
          text += source[i];
          out[i] = ' ';
          i++;
        }
      }
      if (i < n && source[i] === c) {
        out[i] = c;
        i++;
      }
      literals.set(start, text);
    } else if (c === '`') {
      out[i] = '`';
      templateStarts.push({ start: i, text: '', hadExpression: false });
      i++;
      continueTemplate();
    } else if (c === '{') {
      out[i] = c;
      braceDepth++;
      i++;
    } else if (c === '}') {
      out[i] = c;
      braceDepth--;
      i++;
      if (templateStack.length > 0 && templateStack[templateStack.length - 1] === braceDepth) {
        templateStack.pop();
        continueTemplate();
      }
    } else if (c === '/') {
      const prev = previousSignificant();
      const startsRegex =
        prev.char === '' ||
        (REGEX_PRECEDING_CHARS.includes(prev.char) && prev.word === '') ||
        REGEX_PRECEDING_WORDS.has(prev.word);
      if (startsRegex) {
        out[i] = '/';
        i++;
        let inClass = false;
        while (i < n && source[i] !== '\n') {
          const r = source[i] as string;
          if (r === '\\') {
            out[i] = ' ';
            if (i + 1 < n) out[i + 1] = ' ';
            i += 2;
            continue;
          }
          if (r === '[') inClass = true;
          else if (r === ']') inClass = false;
          else if (r === '/' && !inClass) break;
          out[i] = ' ';
          i++;
        }
        if (i < n && source[i] === '/') {
          out[i] = '/';
          i++;
        }
      } else {
        out[i] = c;
        i++;
      }
    } else {
      out[i] = c;
      i++;
    }
  }

  for (let k = 0; k < n; k++) if (out[k] === undefined) out[k] = ' ';
  return { masked: out.join(''), literals };
}

// ---------------------------------------------------------------------------------------------
// Import specifiers
// ---------------------------------------------------------------------------------------------

export interface ImportRef {
  specifier: string;
  dynamic: boolean;
}

/** Static imports, re-exports, side-effect imports and `import('…')` calls of a TypeScript file. */
export function findImports(source: string): ImportRef[] {
  const { masked, literals } = maskSource(source);
  const found = new Map<number, ImportRef>();

  const add = (match: RegExpExecArray, dynamic: boolean): void => {
    const quoteIndex = match.index + match[0].length - 1;
    const specifier = literals.get(quoteIndex);
    if (specifier !== undefined && !found.has(quoteIndex))
      found.set(quoteIndex, { specifier, dynamic });
  };

  const staticFrom = /\b(?:import|export)\b(?:(?!\bimport\b|\bexport\b)[^;'"`])*?\bfrom\s*(['"`])/g;
  for (let m = staticFrom.exec(masked); m !== null; m = staticFrom.exec(masked)) add(m, false);

  const dynamicImport = /\bimport\s*\(\s*(['"`])/g;
  for (let m = dynamicImport.exec(masked); m !== null; m = dynamicImport.exec(masked)) add(m, true);

  const sideEffect = /\bimport\s*(['"`])/g;
  for (let m = sideEffect.exec(masked); m !== null; m = sideEffect.exec(masked)) add(m, false);

  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, ref]) => ref);
}

// ---------------------------------------------------------------------------------------------
// File walking
// ---------------------------------------------------------------------------------------------

function listTsFiles(dir: string): string[] {
  const files: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (name === 'node_modules') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) files.push(...listTsFiles(full));
    else if (name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function toPosix(path: string): string {
  return path.split(sep).join('/');
}

// ---------------------------------------------------------------------------------------------
// Sim purity
// ---------------------------------------------------------------------------------------------

const BANNED_GLOBALS = [
  'Date',
  'performance',
  'window',
  'document',
  'setTimeout',
  'requestAnimationFrame',
  'localStorage',
] as const;

const GLOBAL_PATTERN = new RegExp(`(?<![\\w$.])(${BANNED_GLOBALS.join('|')})\\b`, 'g');
const GLOBAL_THIS_PATTERN = new RegExp(
  `\\b(?:globalThis|self)\\s*\\.\\s*(${BANNED_GLOBALS.join('|')})\\b`,
  'g',
);
const MATH_RANDOM_PATTERN = /(?<![\w$.])Math\s*\.\s*random\b/;
const MATH_RANDOM_BRACKET_PATTERN = /(?<![\w$.])Math\s*\[\s*(['"`])/g;

function bannedSimImport(specifier: string): boolean {
  return (
    specifier === 'three' || specifier.startsWith('three/') || specifier.startsWith('@capacitor/')
  );
}

export function scanSimPurity(simDir: string): Violation[] {
  const violations: Violation[] = [];
  for (const path of listTsFiles(simDir)) {
    if (path.endsWith('.test.ts')) continue;
    const file = toPosix(relative(simDir, path));
    const source = readFileSync(path, 'utf8');
    const { masked, literals } = maskSource(source);
    const seen = new Set<string>();
    const report = (detail: string, message: string): void => {
      if (seen.has(detail)) return;
      seen.add(detail);
      violations.push({ file, rule: 'sim-purity', message, detail });
    };

    for (const pattern of [GLOBAL_PATTERN, GLOBAL_THIS_PATTERN]) {
      for (let m = pattern.exec(masked); m !== null; m = pattern.exec(masked)) {
        const name = m[1] as string;
        report(name, `\`${name}\` is forbidden in src/sim (the sim is pure and deterministic)`);
      }
    }
    if (MATH_RANDOM_PATTERN.test(masked)) {
      report('Math.random', '`Math.random` is forbidden in src/sim: use `world.rng`');
    }
    for (
      let m = MATH_RANDOM_BRACKET_PATTERN.exec(masked);
      m !== null;
      m = MATH_RANDOM_BRACKET_PATTERN.exec(masked)
    ) {
      if (literals.get(m.index + m[0].length - 1) === 'random') {
        report('Math.random', '`Math.random` is forbidden in src/sim: use `world.rng`');
      }
    }
    for (const { specifier } of findImports(source)) {
      if (bannedSimImport(specifier)) {
        report(`import ${specifier}`, `src/sim must not import \`${specifier}\``);
      }
    }
  }
  return violations;
}

// ---------------------------------------------------------------------------------------------
// Layer boundaries
// ---------------------------------------------------------------------------------------------

export type Layer = 'shared' | 'content' | 'sim' | 'bots' | 'platform' | 'client' | 'debug';
type Zone = Layer | 'entry' | 'tools';

const LAYERS: readonly Layer[] = [
  'shared',
  'content',
  'sim',
  'bots',
  'platform',
  'client',
  'debug',
];

interface SourceFile {
  /** Path relative to the scanned root. */
  rel: string;
  zone: Zone;
  isTest: boolean;
}

interface Target {
  kind: 'zone' | 'package';
  zone?: Zone;
  /** Package name (`three`, `@capacitor`, `@dimforge`, `zod`…) for `kind: 'package'`. */
  pkg?: string;
  /** Path inside the target zone, without extension (`world`, `log`…). */
  inner: string;
  /** True for the `@sim` alias, the sim's only public entry point. */
  isSimPublicApi: boolean;
}

interface Rule {
  id: string;
  description: string;
  applies(file: SourceFile, imp: ImportRef, target: Target): boolean;
}

const RAPIER_FILE = 'src/sim/physics/rapierPhysics.ts';

const isZone = (target: Target, ...zones: Zone[]): boolean =>
  target.kind === 'zone' && zones.includes(target.zone as Zone);
const isPackage = (target: Target, ...pkgs: string[]): boolean =>
  target.kind === 'package' && pkgs.includes(target.pkg as string);

/** The "Frontières d'architecture" table, one entry per rule. */
export const BOUNDARY_RULES: readonly Rule[] = [
  {
    id: 'R1',
    description: 'shared imports nothing: no other layer, no npm package',
    applies: (file, _imp, target) =>
      file.zone === 'shared' &&
      (isZone(target, 'content', 'sim', 'bots', 'platform', 'client', 'debug') ||
        (target.kind === 'package' &&
          !(file.isTest && (target.pkg === 'vitest' || target.pkg === 'node')))),
  },
  {
    id: 'R2',
    description:
      'content imports only shared and zod (never sim, bots, client, platform, debug, three)',
    applies: (file, _imp, target) =>
      file.zone === 'content' &&
      (isZone(target, 'sim', 'bots', 'client', 'platform', 'debug') || isPackage(target, 'three')),
  },
  {
    id: 'R3',
    description: 'sim never imports three, @capacitor/*, client, platform, debug or bots',
    applies: (file, _imp, target) =>
      file.zone === 'sim' &&
      (isPackage(target, 'three', '@capacitor') ||
        isZone(target, 'client', 'platform', 'debug', 'bots')),
  },
  {
    id: 'R3b',
    description: 'sim never imports @shared/log (the sim emits events, the client logs them)',
    applies: (file, _imp, target) =>
      file.zone === 'sim' && isZone(target, 'shared') && /^log(\/|$)/.test(target.inner),
  },
  {
    id: 'R4',
    description: 'only sim/physics/rapierPhysics.ts imports Rapier',
    applies: (file, _imp, target) =>
      file.zone === 'sim' && file.rel !== RAPIER_FILE && isPackage(target, '@dimforge'),
  },
  {
    id: 'R5',
    description:
      'bots import only the sim public API (@sim) and shared; never client, platform, three',
    applies: (file, _imp, target) =>
      file.zone === 'bots' &&
      (isZone(target, 'client', 'platform') ||
        isPackage(target, 'three') ||
        (isZone(target, 'sim') && !target.isSimPublicApi)),
  },
  {
    id: 'R6',
    description: 'platform never imports sim, client or three',
    applies: (file, _imp, target) =>
      file.zone === 'platform' && (isZone(target, 'sim', 'client') || isPackage(target, 'three')),
  },
  {
    id: 'R7',
    description:
      'client reaches the sim only through @sim; debug and bots only via a dynamic import() in client/boot.ts',
    applies: (file, imp, target) =>
      file.zone === 'client' &&
      ((isZone(target, 'sim') && !target.isSimPublicApi) ||
        (isZone(target, 'debug') && !(imp.dynamic && file.rel === 'src/client/boot.ts')) ||
        (isZone(target, 'bots') && !imp.dynamic)),
  },
  {
    id: 'R8',
    description: 'nothing in src/ imports tools/',
    applies: (file, _imp, target) => file.zone !== 'tools' && isZone(target, 'tools'),
  },
  {
    id: 'R9',
    description:
      'no layer imports debug statically (client/boot.ts imports it dynamically, see R7; sim is covered by R3)',
    applies: (file, imp, target) =>
      file.zone !== 'debug' &&
      file.zone !== 'client' &&
      file.zone !== 'sim' &&
      isZone(target, 'debug') &&
      !imp.dynamic,
  },
];

const ALIAS_PATTERN = /^@(shared|content|sim|bots|client|platform|debug)(?:\/(.*))?$/;

function classifyZone(rel: string): Zone | null {
  const parts = rel.split('/');
  if (parts[0] === 'tools') return 'tools';
  if (parts[0] !== 'src') return null;
  const second = parts[1] as string;
  if (parts.length === 2) return 'entry';
  return (LAYERS as readonly string[]).includes(second) ? (second as Layer) : null;
}

function stripExtension(path: string): string {
  return path.replace(/\.(d\.)?[cm]?[jt]sx?$/, '');
}

function resolveTarget(file: SourceFile, specifier: string): Target | null {
  const bare = specifier.split('?')[0] as string;
  const alias = ALIAS_PATTERN.exec(bare);
  if (alias) {
    const zone = alias[1] as Layer;
    const inner = stripExtension(alias[2] ?? '');
    return {
      kind: 'zone',
      zone,
      inner,
      isSimPublicApi: zone === 'sim' && alias[2] === undefined,
    };
  }
  if (bare.startsWith('./') || bare.startsWith('../')) {
    const resolved = posix.normalize(posix.join(posix.dirname(file.rel), bare));
    if (resolved.startsWith('..')) return null;
    const zone = classifyZone(resolved);
    if (zone === null) return null;
    const parts = resolved.split('/');
    const inner = stripExtension(parts.slice(zone === 'tools' ? 1 : 2).join('/'));
    return { kind: 'zone', zone, inner, isSimPublicApi: false };
  }
  if (bare.startsWith('node:')) {
    return { kind: 'package', pkg: 'node', inner: bare, isSimPublicApi: false };
  }
  const pkg = bare.split('/')[0] as string;
  return { kind: 'package', pkg, inner: bare, isSimPublicApi: false };
}

/** Checks every import under `<rootDir>/src` against {@link BOUNDARY_RULES}. */
export function scanLayerBoundaries(rootDir: string): Violation[] {
  const violations: Violation[] = [];
  const srcDir = join(rootDir, 'src');
  for (const path of listTsFiles(srcDir)) {
    const rel = toPosix(relative(rootDir, path));
    const zone = classifyZone(rel);
    if (zone === null) continue;
    const file: SourceFile = { rel, zone, isTest: rel.endsWith('.test.ts') };
    for (const imp of findImports(readFileSync(path, 'utf8'))) {
      const target = resolveTarget(file, imp.specifier);
      if (target === null) continue;
      for (const rule of BOUNDARY_RULES) {
        if (rule.applies(file, imp, target)) {
          violations.push({
            file: rel,
            rule: rule.id,
            message: `${rule.id}: ${rule.description}`,
            detail: imp.specifier,
          });
        }
      }
    }
  }
  return violations;
}
