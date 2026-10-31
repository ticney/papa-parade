import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const fixtures = join(here, 'fixtures', 'comfortSettings');

/**
 * « Réduire les animations » and « Grands verbes » (story 2.10) are the player's comfort, client-only
 * (decision D7): they change no value of a game, so the sim, the bots and the headless runner do not
 * know them. A name in these folders would be a setting that leaked into the rules, and into a
 * golden journal. The names of the settings, in code and in JSON, camelCase or snake_case.
 */
const COMFORT_NAMES = /\b(?:reducedMotion|largeVerbs|reduced_motion|large_verbs)\b/;

interface Offender {
  file: string;
  line: number;
  text: string;
}

/** Every `.ts`, `.mts` and `.json` file under `dir`, tests included: a test must not name them either. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return filesUnder(path);
      return /\.(?:m?ts|json)$/.test(name) ? [path] : [];
    });
}

function scanComfortNames(dir: string): Offender[] {
  return filesUnder(dir).flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .flatMap((text, index) =>
        COMFORT_NAMES.test(text)
          ? [
              {
                file: relative(dir, file).split('\\').join('/'),
                line: index + 1,
                text: text.trim(),
              },
            ]
          : [],
      ),
  );
}

describe('the comfort settings stay out of the rules (story 2.10, AC 11)', () => {
  for (const folder of ['src/sim', 'src/bots', 'tools/sim']) {
    it(`${folder} names neither reducedMotion nor largeVerbs`, () => {
      expect(scanComfortNames(join(root, folder))).toEqual([]);
    });
  }

  it.each([
    ['reduced-motion', 'a.ts'],
    ['large-verbs', 'a.ts'],
    ['snake-case', 'a.ts'],
    ['in-a-test', 'a.test.ts'],
  ])('flags the failing fixture "%s"', (name, file) => {
    const offenders = scanComfortNames(join(fixtures, name));
    expect(offenders).toHaveLength(1);
    expect(offenders[0]).toMatchObject({ file, line: 1 });
  });

  it('lets a file with neither name through', () => {
    expect(scanComfortNames(join(fixtures, 'clean'))).toEqual([]);
  });
});
