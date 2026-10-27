import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskSource } from './scanners.ts';

// Project-context › Platform & Build Rules: `navigator.vibrate` is called inside `src/platform`
// only, so that haptics stay a no-op where unsupported and a native build can swap them (E8).
// Same masked-source approach as the other scanners: comments and strings are ignored.

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'platformApis');

// Every script extension, not only TypeScript: a `.js` file under `src/` is a way round the guard.
const SOURCE_FILE = /\.(?:ts|mts|cts|tsx|js|mjs|cjs|jsx)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|mts|cts|tsx|js|mjs|cjs|jsx)$/;
/** `navigator.vibrate`, `const { vibrate } = navigator`, `globalThis.navigator?.vibrate?.()`... */
const VIBRATE_IDENTIFIER = /(?<![\w$])vibrate(?![\w$])/;
/** Any mention of the global, however it is reached: `window.navigator`, an alias, a cast. */
const NAVIGATOR_TOKEN = /(?<![\w$])navigator(?![\w$])/i;
// The string forms. A file that holds the literal 'vibrate' (a bracket access, `'vibrate' in
// navigator`, `Reflect.get(navigator, 'vibrate')`) and also names `navigator` (as a token, or as the
// literal of `globalThis['navigator']`) is flagged whatever sits between them: this is a guard, so
// it errs on the strict side. What it cannot see is a name built at run time (`'vib' + 'rate'`).
const VIBRATE_LITERAL = /^vibrate$/;
const NAVIGATOR_LITERAL = /^navigator$/i;

interface Violation {
  file: string;
  message: string;
}

function listSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // `statSync` follows a symlink: a linked source directory is scanned like any other.
    if (statSync(path).isDirectory()) files.push(...listSources(path));
    else if (SOURCE_FILE.test(entry.name) && !TEST_FILE.test(entry.name)) files.push(path);
  }
  return files;
}

/** Every use of `vibrate` in `<rootDir>/src` outside `src/platform` (tests and comments aside). */
function scanPlatformApis(rootDir: string): Violation[] {
  const srcDir = join(rootDir, 'src');
  const violations: Violation[] = [];
  for (const path of listSources(srcDir)) {
    const relativePath = relative(srcDir, path).split(sep).join('/');
    if (relativePath.startsWith('platform/')) continue;
    const { masked, literals } = maskSource(readFileSync(path, 'utf8'));
    const texts = [...literals.values()];
    const hasVibrateLiteral = texts.some((text) => VIBRATE_LITERAL.test(text));
    const namesNavigator =
      NAVIGATOR_TOKEN.test(masked) || texts.some((text) => NAVIGATOR_LITERAL.test(text));
    if (VIBRATE_IDENTIFIER.test(masked) || (hasVibrateLiteral && namesNavigator)) {
      violations.push({
        file: relativePath,
        message: '`navigator.vibrate` belongs in src/platform: call `platform.haptics.pulse(kind)`',
      });
    }
  }
  return violations;
}

describe('platformApis', () => {
  it('src/ calls navigator.vibrate only under src/platform', () => {
    expect(scanPlatformApis(join(here, '..', '..'))).toEqual([]);
  });

  it('really scans the project: it finds the client and the platform sources', () => {
    const srcDir = join(here, '..', '..', 'src');
    const found = listSources(srcDir).map((path) => relative(srcDir, path).split(sep).join('/'));
    expect(found).toEqual(
      expect.arrayContaining(['client/boot.ts', 'platform/web/webHaptics.ts', 'shared/log.ts']),
    );
  });

  it.each([
    ['vibrate-in-client', 'client/a.ts'],
    ['vibrate-bracket', 'client/a.ts'],
    ['vibrate-destructure', 'client/a.ts'],
    ['vibrate-optional-chain', 'shared/a.ts'],
    ['vibrate-window-bracket', 'client/a.ts'],
    ['vibrate-global-bracket', 'client/a.ts'],
    ['vibrate-cast', 'client/a.ts'],
    ['vibrate-alias', 'shared/a.ts'],
    ['vibrate-in-operator', 'client/a.ts'],
    ['vibrate-reflect', 'client/a.ts'],
    ['vibrate-js-file', 'client/a.js'],
  ])('flags the offending fixture "%s"', (name, file) => {
    expect(scanPlatformApis(join(fixtures, name))).toEqual([
      expect.objectContaining({ file, message: expect.stringContaining('src/platform') }),
    ]);
  });

  it('ignores src/platform, comments, strings, templates and test files', () => {
    expect(scanPlatformApis(join(fixtures, 'clean'))).toEqual([]);
  });
});
