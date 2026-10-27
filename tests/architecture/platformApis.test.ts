import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { maskSource } from './scanners.ts';

// Project-context › Platform & Build Rules: `navigator.vibrate` is called inside `src/platform`
// only, so that haptics stay a no-op where unsupported and a native build can swap them (E8).
// Same masked-source approach as the other scanners: comments and strings are ignored.

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'platformApis');

const SOURCE_FILE = /\.(?:ts|mts|tsx)$/;
const TEST_FILE = /\.(?:test|spec)\.(?:ts|mts|tsx)$/;
const VIBRATE_IDENTIFIER = /(?<![\w$])vibrate(?![\w$])/;
const NAVIGATOR_BRACKET = /(?<![\w$.])navigator\s*\[/;
const NAVIGATOR_VIBRATE_LITERAL = /^vibrate$/;

interface Violation {
  file: string;
  message: string;
}

function listSources(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...listSources(path));
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
    const usesBracket =
      NAVIGATOR_BRACKET.test(masked) &&
      [...literals.values()].some((text) => NAVIGATOR_VIBRATE_LITERAL.test(text));
    if (VIBRATE_IDENTIFIER.test(masked) || usesBracket) {
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

  it.each([
    ['vibrate-in-client', 'client/a.ts'],
    ['vibrate-bracket', 'client/a.ts'],
    ['vibrate-destructure', 'client/a.ts'],
    ['vibrate-optional-chain', 'shared/a.ts'],
  ])('flags the offending fixture "%s"', (name, file) => {
    expect(scanPlatformApis(join(fixtures, name))).toEqual([
      expect.objectContaining({ file, message: expect.stringContaining('src/platform') }),
    ]);
  });

  it('ignores src/platform, comments, strings, templates and test files', () => {
    expect(scanPlatformApis(join(fixtures, 'clean'))).toEqual([]);
  });
});
