import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ContentBundle } from '@content/contentBundle';
import { formatContentProblem } from '@content/contentError';
import { parseContentFile } from '@content/parseContentFile';
import { FeelSchema } from '@content/schemas/feel';
import type { Sim } from '@sim';

const FEEL_FIXTURE = 'tests/support/testFeel.json';

/**
 * A content bundle for sim and golden tests, built from a FROZEN copy of the feel
 * (`testFeel.json`), never from `content/feel.json`: Geo retunes the live file freely, and no test
 * result may depend on it. A story that adds a feel key also adds it to the fixture.
 */
export function createTestContent(): ContentBundle {
  const text = readFileSync(fileURLToPath(new URL('./testFeel.json', import.meta.url)), 'utf8');
  const parsed = parseContentFile(FEEL_FIXTURE, text, FeelSchema);
  if (!parsed.ok) {
    throw new Error(
      `${FEEL_FIXTURE} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`,
    );
  }
  return { feel: parsed.value, strings: {} };
}

/** Runs `n` steps: time in tests is counted in steps (`stepN(sim, 120)` = 1200 ms of sim time). */
export function stepN(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}
