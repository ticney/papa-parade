import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ContentBundle, LevelContent } from '@content/contentBundle';
import { formatContentProblem } from '@content/contentError';
import { parseContentFile } from '@content/parseContentFile';
import type { BotSettings } from '@content/schemas/bots';
import { type DisruptionDef, DisruptionDefSchema } from '@content/schemas/disruption';
import type { FeedbackTable } from '@content/schemas/feedback';
import { FeelSchema } from '@content/schemas/feel';
import type {
  LevelGauges,
  LevelObject,
  LevelVariant,
  LevelWave,
  LevelWaveDisruption,
  LevelWaveThreat,
} from '@content/schemas/level';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import { type ThreatDef, ThreatDefSchema } from '@content/schemas/threat';
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
    resultScreen: {
      rowCountUpMs: 600,
      rowStaggerMs: 200,
      starsDelayMs: 300,
      starIntervalMs: 450,
      actionsDelayMs: 400,
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
 * Bot settings, inline like the feedback table: the sim ignores them, so they move no hash and no
 * golden. Frozen on purpose: retuning `content/bots.json` must not change a bot test.
 */
export function createTestBots(): BotSettings {
  return {
    tapMs: 80,
    human: { reactionMs: 250, aimOffsetMs: 0, jitterSdMs: 60 },
    random: { actionsPerSec: 2, floorReachM: 3, maxHoldMs: 800 },
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
  return {
    feel: parsed.value,
    feedback: createTestFeedback(),
    bots: createTestBots(),
    strings: {},
  };
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

/** Reads a frozen threat fixture of `tests/support/`, named by its file. */
function readThreatFixture(file: string): ThreatDef {
  const path = `tests/support/${file}`;
  const text = readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
  const parsed = parseContentFile(path, text, ThreatDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/**
 * The outlet for sim and golden tests, from a FROZEN copy of `content/threats/outlet.json`
 * (`testOutlet.threat.json`, same values; only its `$schema` path differs), never from the live file: Geo retunes it freely, and no test result
 * may depend on it.
 */
export function createTestOutlet(): ThreatDef {
  return readThreatFixture('testOutlet.threat.json');
}

/** The stairs, frozen like the outlet (`testStairs.threat.json`). */
export function createTestStairs(): ThreatDef {
  return readThreatFixture('testStairs.threat.json');
}

/** The object on the coffee table, frozen like the outlet (`testCoffeeTableObject.threat.json`). */
export function createTestCoffeeTableObject(): ThreatDef {
  return readThreatFixture('testCoffeeTableObject.threat.json');
}

/** The micro-sleep, frozen like the outlet (`testMicroSleep.threat.json`): the threat on Papa. */
export function createTestMicroSleep(): ThreatDef {
  return readThreatFixture('testMicroSleep.threat.json');
}

/** The suspicious silence, frozen like the outlet (`testSilence.threat.json`): the threat in a hidden zone. */
export function createTestSilence(): ThreatDef {
  return readThreatFixture('testSilence.threat.json');
}

/**
 * The phone, frozen like the threats (`testPhone.disruption.json`, same values as
 * `content/disruptions/phone.json`; only its `$schema` path differs), never from the live file.
 */
export function createTestPhone(): DisruptionDef {
  const path = 'tests/support/testPhone.disruption.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testPhone.disruption.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, DisruptionDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/** The five frozen threats, by id. */
export function createTestThreats(): Readonly<Record<string, ThreatDef>> {
  const defs = [
    createTestOutlet(),
    createTestStairs(),
    createTestCoffeeTableObject(),
    createTestMicroSleep(),
    createTestSilence(),
  ];
  return Object.fromEntries(defs.map((def) => [def.id, def]));
}

/**
 * A test level lasts longer than any test, so that `ended` stays out of the tests that are not
 * about it (10 minutes of sim time).
 */
export const TEST_LEVEL_DURATION_MS = 600_000;

/** The outlet at the frozen room's `outlet_01` anchor, as a wave adds it. */
export const OUTLET: LevelWaveThreat = { def: 'outlet', anchor: 'outlet_01' };

/** The stairs at the frozen room's `stairs_top` anchor. */
export const STAIRS: LevelWaveThreat = { def: 'stairs', anchor: 'stairs_top' };

/** The object on the coffee table at the frozen room's `coffee_table` anchor. */
export const COFFEE_TABLE: LevelWaveThreat = { def: 'coffee_table_object', anchor: 'coffee_table' };

/** The suspicious silence in the frozen room's `behind_sofa` hidden zone. */
export const SILENCE: LevelWaveThreat = { def: 'silence_mischief', anchor: 'behind_sofa' };

/** The phone of the live level, planned at `atMs` on the object `phone` (the one of `TEST_OBJECTS`). */
export function testPhoneEntry(atMs: number): LevelWaveDisruption {
  return { def: 'phone', object: 'phone', atMs };
}

/**
 * A wave of `threats`: from 0 ms, one at a time, no gap and no lull, no disruption unless `overrides` says so. A
 * test that used `outletEntry(2000)` uses `testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })`:
 * its first telegraph lands at the first step at or after 2000 ms.
 */
export function testWave(
  threats: readonly LevelWaveThreat[],
  overrides: Partial<Omit<LevelWave, 'threats'>> = {},
): LevelWave {
  return {
    fromMs: 0,
    maxSimultaneous: 1,
    gapMinMs: 0,
    gapMaxMs: 0,
    lullMs: 0,
    ...overrides,
    threats: [...threats],
    disruptions: [...(overrides.disruptions ?? [])],
  };
}

export interface TestLevelOptions {
  waves?: readonly LevelWave[];
  objects?: readonly LevelObject[];
  /** The level's gauges; none by default (golden and most test levels have no fatigue). */
  gauges?: LevelGauges;
  durationMs?: number;
  variant?: LevelVariant;
  feelOverrides?: Record<string, unknown>;
}

/**
 * The level of the frozen living room that plans `waves` (none: it plans nothing, as the golden
 * scenarios without threats). Each planned def is resolved from the frozen threats, once, in order
 * of first reference; an unknown one throws.
 */
export function createTestLevel({
  waves = [],
  objects = [],
  gauges = {},
  durationMs = TEST_LEVEL_DURATION_MS,
  variant = 'nap',
  feelOverrides = {},
}: TestLevelOptions = {}): LevelContent {
  const all = createTestThreats();
  const threats: Record<string, ThreatDef> = {};
  for (const wave of waves) {
    for (const entry of wave.threats) {
      const def = all[entry.def];
      if (def === undefined) throw new Error(`no frozen threat "${entry.def}" in tests/support`);
      threats[def.id] = def;
    }
  }
  const microSleepDef = gauges.fatigue?.microSleepDef;
  if (microSleepDef !== undefined) {
    const def = all[microSleepDef];
    if (def === undefined) throw new Error(`no frozen threat "${microSleepDef}" in tests/support`);
    threats[def.id] = def;
  }
  const disruptions: Record<string, DisruptionDef> = {};
  for (const wave of waves) {
    for (const entry of wave.disruptions) {
      const def = createTestPhone();
      if (def.id !== entry.def) {
        throw new Error(`no frozen disruption "${entry.def}" in tests/support`);
      }
      disruptions[def.id] = def;
    }
  }
  return {
    level: {
      id: 'salon_crawler',
      variant,
      durationMs,
      waves: waves.map((wave) => ({
        ...wave,
        threats: [...wave.threats],
        disruptions: wave.disruptions.map((entry) => ({ ...entry })),
      })),
      objects: [...objects],
      gauges: structuredClone(gauges),
      feelOverrides: { ...feelOverrides },
    },
    threats,
    disruptions,
  };
}

/** The coffee machine and the phone of the live level, at the frozen room's anchors of the same names. */
export const TEST_OBJECTS: readonly LevelObject[] = [
  { id: 'coffee_machine', kind: 'coffee_machine', anchor: 'coffee_machine' },
  { id: 'phone', kind: 'phone', anchor: 'phone' },
];

/** A level with fatigue: the frozen micro-sleep (`TestLevelOptions.gauges`). */
export const FATIGUE_GAUGES: LevelGauges = { fatigue: { microSleepDef: 'papa_microsleep' } };

/** Runs `n` steps: time in tests is counted in steps (`stepN(sim, 120)` = 1200 ms of sim time). */
export function stepN(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}
