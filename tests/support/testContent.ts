import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ContentBundle } from '@content/contentBundle';
import { formatContentProblem } from '@content/contentError';
import { parseContentFile } from '@content/parseContentFile';
import type { FeedbackTable } from '@content/schemas/feedback';
import { FeelSchema } from '@content/schemas/feel';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import type { Sim } from '@sim';

const FEEL_FIXTURE = 'tests/support/testFeel.json';
const GEOMETRY_FIXTURE = 'tests/support/testLevel.geometry.json';

/**
 * A minimal valid feedback table, inline: the sim ignores it (it is client-only), so it does not
 * move `feelHash` or any golden. Client tests that need a real table build their own.
 */
export function createTestFeedback(): FeedbackTable {
  return {
    buses: {
      music: { gainPct: 50 },
      sfx: { gainPct: 90 },
      voice: { gainPct: 80 },
      ui: { gainPct: 80 },
    },
    haptics: {
      light: { patternMs: [15] },
      medium: { patternMs: [30] },
      heavy: { patternMs: [60] },
    },
    loops: {
      babble: { clip: 'baby_babble_loop', bus: 'voice', gainPct: 100, fadeMs: 80 },
      music: { clip: 'music_crawler_calm', bus: 'music', gainPct: 100, fadeMs: 400 },
    },
    cues: {
      papa_bump: {
        audio: { clip: 'papa_bump', bus: 'sfx', gainPct: 100 },
        visual: { kind: 'soundWave', anchor: 'papa', maxRadiusM: 0.6, durationMs: 350 },
        haptic: 'light',
      },
      countdown_tick: { haptic: 'light' },
    },
    events: { PapaBlocked: 'papa_bump', CountdownTicked: 'countdown_tick' },
  };
}

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
  return { feel: parsed.value, feedback: createTestFeedback(), strings: {} };
}

/**
 * The geometry of the living room for sim and golden tests, from a FROZEN byte copy of
 * `content/levels/salon_crawler.geometry.json` (`testLevel.geometry.json`), never from the live
 * file: Geo re-exports the room from Blender freely, and no test result may depend on it.
 */
export function createTestGeometry(): LevelGeometry {
  const text = readFileSync(
    fileURLToPath(new URL('./testLevel.geometry.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(GEOMETRY_FIXTURE, text, LevelGeometrySchema);
  if (!parsed.ok) {
    throw new Error(
      `${GEOMETRY_FIXTURE} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`,
    );
  }
  return parsed.value;
}

/** Runs `n` steps: time in tests is counted in steps (`stepN(sim, 120)` = 1200 ms of sim time). */
export function stepN(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}
