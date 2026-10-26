import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanSimPurity } from './scanners.ts';

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, 'fixtures', 'simPurity');

const OFFENDERS: { name: string; detail: string }[] = [
  { name: 'math-random', detail: 'Math.random' },
  { name: 'math-random-bracket', detail: 'Math.random' },
  { name: 'date', detail: 'Date' },
  { name: 'performance', detail: 'performance' },
  { name: 'window', detail: 'window' },
  { name: 'document', detail: 'document' },
  { name: 'set-timeout', detail: 'setTimeout' },
  { name: 'request-animation-frame', detail: 'requestAnimationFrame' },
  { name: 'local-storage', detail: 'localStorage' },
  { name: 'global-this-window', detail: 'window' },
  { name: 'import-three', detail: 'import three' },
  { name: 'import-three-subpath', detail: 'import three/examples/jsm/loaders/GLTFLoader.js' },
  { name: 'import-type-three', detail: 'import three' },
  { name: 'import-capacitor', detail: 'import @capacitor/haptics' },
  { name: 'side-effect-import-three', detail: 'import three' },
  { name: 'dynamic-import-three', detail: 'import three' },
  { name: 'reexport-three', detail: 'import three' },
];

describe('simPurity', () => {
  it('src/sim is pure', () => {
    expect(scanSimPurity(join(here, '..', '..', 'src', 'sim'))).toEqual([]);
  });

  for (const { name, detail } of OFFENDERS) {
    it(`flags the offending fixture "${name}"`, () => {
      const violations = scanSimPurity(join(fixtures, name));
      expect(violations).toHaveLength(1);
      expect(violations[0]).toMatchObject({ file: 'a.ts', rule: 'sim-purity', detail });
    });
  }

  it('ignores comments, strings, regex literals, property names and *.test.ts files', () => {
    expect(scanSimPurity(join(fixtures, 'clean'))).toEqual([]);
  });
});
