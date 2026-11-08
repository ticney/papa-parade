import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SMOKE_SPECS, SMOKE_SPECS_MAX } from '../e2e/support/smokeSpecs.ts';

const E2E_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'e2e');

/**
 * The smoke tier is what `npm run ci:story` plays before every merge (Geo, 2026-11-08). It keeps a
 * fixed size: a name that matches no spec would drop a check without a word (Playwright plays the
 * others and says nothing), and a list that grows with each mechanic is the whole suite again.
 */
describe('the e2e smoke tier (tests/e2e/support/smokeSpecs.ts)', () => {
  it('names only specs that exist in tests/e2e', () => {
    const specs = new Set(readdirSync(E2E_DIR).filter((file) => file.endsWith('.spec.ts')));
    const missing = SMOKE_SPECS.filter((file) => !specs.has(file));
    expect(missing).toEqual([]);
  });

  it('names each spec once', () => {
    expect(new Set(SMOKE_SPECS).size).toBe(SMOKE_SPECS.length);
  });

  it(`holds at most ${SMOKE_SPECS_MAX} specs: a new mechanic is proven in Vitest, not here`, () => {
    expect(SMOKE_SPECS.length).toBeLessThanOrEqual(SMOKE_SPECS_MAX);
  });
});
