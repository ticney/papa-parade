import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanUiStrings } from './uiStringScanner.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const fixtures = join(here, 'fixtures', 'uiStrings');

const STRINGS: Record<string, string> = JSON.parse(
  readFileSync(join(repoRoot, 'content', 'strings.fr.json'), 'utf8'),
);

const OFFENDERS: { name: string; rule: string; file: string; detail: string }[] = [
  { name: 'u1-text-content', rule: 'U1', file: 'src/client/ui/a.ts', detail: 'Pause' },
  { name: 'u1-aria-label', rule: 'U1', file: 'src/client/ui/a.ts', detail: 'Pause' },
  { name: 'u1-append', rule: 'U1', file: 'src/client/ui/a.ts', detail: 'Salut' },
  { name: 'u1-template-prefix', rule: 'U1', file: 'src/client/ui/a.ts', detail: 'Reprise dans ' },
  { name: 'u2-french-prose', rule: 'U2', file: 'src/client/ui/a.ts', detail: 'été' },
  { name: 'u3-unknown-key-ui', rule: 'U3', file: 'src/client/ui/a.ts', detail: 'pause.nope' },
  {
    name: 'u3-unknown-key-app',
    rule: 'U3',
    file: 'src/client/app/a.ts',
    detail: 'countdown.step_9',
  },
];

describe('uiStrings', () => {
  it('the repository writes no UI text in src/client/ui and mentions only known string keys', () => {
    expect(scanUiStrings(repoRoot, STRINGS)).toEqual([]);
  });

  it('accepts the clean fixture (t() calls, empty strings, class names, test files, comments)', () => {
    expect(scanUiStrings(join(fixtures, 'clean'), STRINGS)).toEqual([]);
  });

  for (const { name, rule, file, detail } of OFFENDERS) {
    it(`flags the offending fixture "${name}"`, () => {
      const violations = scanUiStrings(join(fixtures, name), STRINGS);
      expect(
        violations.some((v) => v.rule === rule && v.file === file && v.detail === detail),
      ).toBe(true);
    });
  }

  it('returns nothing for a root without src/client', () => {
    expect(scanUiStrings(join(fixtures, 'does-not-exist'), STRINGS)).toEqual([]);
  });
});
