import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LevelContent } from '@content/contentBundle';
import { formatContentProblem } from '@content/contentError';
import { parseContentFile } from '@content/parseContentFile';
import { type Level, LevelSchema } from '@content/schemas/level';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import type { SequenceDef } from '@content/schemas/sequence';
import type { ThreatDef } from '@content/schemas/threat';
import { createTestSequences, createTestThreats } from './testContent.ts';

// The bedtime cycle's frozen room and level (story 4.10): byte copies of the live `chambre_night`
// (`cmp`), only the `$schema` path of the level differs. Geo retunes the live ones freely, and no test
// result may depend on them. Their sequences and threats are the frozen ones, of the same ids.

function readFixture(file: string): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
}

/** The frozen bedroom. */
export function createTestCycleGeometry(): LevelGeometry {
  const path = 'tests/support/testCycle.geometry.json';
  const parsed = parseContentFile(
    path,
    readFixture('testCycle.geometry.json'),
    LevelGeometrySchema,
  );
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/** What a test may change of the frozen level: any key of the file, and the def of a sequence. */
export interface CycleLevelOptions extends Partial<Level> {
  readonly sequenceDefs?: Readonly<Record<string, SequenceDef>>;
}

/**
 * The frozen `chambre_night` as `loadLevelContent` would give it, with the frozen defs. A test that
 * narrows `sequences` and `cycle.entries` gets only the defs it names.
 */
export function createTestCycleLevel({
  sequenceDefs = {},
  ...overrides
}: CycleLevelOptions = {}): LevelContent {
  const path = 'tests/support/testCycle.level.json';
  const parsed = parseContentFile(path, readFixture('testCycle.level.json'), LevelSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  const level: Level = { ...parsed.value, ...overrides };
  // A test that passes `cycle: undefined` wants a level with no cycle, not a key the hash refuses.
  if (level.cycle === undefined) delete level.cycle;
  const frozenThreats = createTestThreats();
  const threatOf = (id: string): ThreatDef => {
    const def = frozenThreats[id];
    if (def === undefined) throw new Error(`no frozen threat "${id}" in tests/support`);
    return def;
  };
  const threats: Record<string, ThreatDef> = {};
  const add = (id: string | undefined): void => {
    if (id !== undefined) threats[id] = threatOf(id);
  };
  for (const wave of level.waves) for (const entry of wave.threats) add(entry.def);
  add(level.gauges.fatigue?.microSleepDef);
  add(level.carry?.armsCryDef);
  const frozenSequences = createTestSequences();
  const sequences: Record<string, SequenceDef> = {};
  for (const id of level.sequences) {
    const def = sequenceDefs[id] ?? frozenSequences[id];
    if (def === undefined) throw new Error(`no frozen sequence "${id}" in tests/support`);
    sequences[id] = def;
    for (const step of def.steps) {
      if (step.kind === 'duel') add(step.threatDef);
      if (step.kind === 'stealth') {
        add(step.falseAlarmDef);
        add(step.realWakeDef);
      }
    }
  }
  return { level, threats, disruptions: {}, sequences };
}
