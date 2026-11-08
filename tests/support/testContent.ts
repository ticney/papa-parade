import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ContentBundle, LevelContent } from '@content/contentBundle';
import { formatContentProblem } from '@content/contentError';
import { parseContentFile } from '@content/parseContentFile';
import type { BotSettings } from '@content/schemas/bots';
import { type ChoreDef, ChoreDefSchema } from '@content/schemas/chore';
import { type DisruptionDef, DisruptionDefSchema } from '@content/schemas/disruption';
import type { FeedbackTable } from '@content/schemas/feedback';
import { FeelSchema } from '@content/schemas/feel';
import type {
  LevelCarry,
  LevelChore,
  LevelFinalRush,
  LevelGauges,
  LevelObject,
  LevelVariant,
  LevelWave,
  LevelWaveDisruption,
  LevelWaveThreat,
} from '@content/schemas/level';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import type { MamaLines } from '@content/schemas/mamaLines';
import { type SequenceDef, SequenceDefSchema } from '@content/schemas/sequence';
import { type ThreatDef, ThreatDefSchema } from '@content/schemas/threat';
import { MAMA_REACTIONS, SILENCE_SIMULTANEOUS_WEIGHT } from '@shared/constants';
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
      heartbeat: { patternMs: [30, 90, 30] },
    },
    sequenceBar: { slideMs: 250 },
    comboBadge: { cashInHoldMs: 900 },
    papaHint: { holdMs: 1200 },
    bombDrop: { laidHeightM: 0.3 },
    characters: {
      squash: [],
      clipSpeeds: [],
      papaClipFacing: [],
      busyProps: {
        steamSwayDeg: 12,
        steamStretchPct: 15,
        steamPeriodMs: 900,
        blablaTiltDeg: 8,
        blablaBobAmplitudeM: 0.03,
        blablaPeriodMs: 700,
        blablaPlace: { screenOffsetM: 0.35, heightM: 0.8 },
      },
    },
    door: { openMs: 700, openAngleDeg: 100, widthM: 0.9, heightM: 2, thicknessM: 0.05 },
    photo: {
      widthPx: 570,
      heightPx: 360,
      tiltMaxDeg: 3,
      vignetteFromPct: 60,
      vignetteOpacityPct: 28,
      vignetteRadiusPct: 70,
    },
    replay: {
      preRollMs: 2000,
      postRollMs: 1500,
      minSpacingMs: 5000,
      momentCount: 3,
      points: { perfect: 3, messyGag: 2, nearMiss: 2, waveLast: 1 },
      messyGagMinProps: 2,
      messWindowMs: 1000,
      camera: { frameWidthM: 5, frameDepthM: 3.4 },
      delayMs: 400,
      endHoldMs: 300,
    },
    render: {
      toonTones: [96, 178, 255],
      lights: {
        default: {
          ambientColor: '#FFFFFF',
          ambientIntensity: 1.1,
          sunColor: '#FFFFFF',
          sunIntensity: 2.04,
        },
        byLevel: {},
      },
      sunOffsetM: [5, 9, 7],
      outlines: { widthM: 0.025, skipMaterials: ['art_ink'] },
      dangerTint: { radiusM: 0.5, minOpacityPct: 40, peakOpacityPct: 80, pulseHz: 2 },
      decalWallHeightM: 2,
      blobSkipColliderIds: [],
    },
    resultScreen: {
      rowCountUpMs: 600,
      rowStaggerMs: 200,
      starsDelayMs: 300,
      starIntervalMs: 450,
      actionsDelayMs: 400,
      inputGraceMs: 0,
      photoHoldMs: 1200,
      reactionHoldMs: 1200,
    },
    calibration: { beep: { clip: 'ui_calibration_beep', bus: 'ui', gainPct: 100 } },
    loops: {
      babble: { clip: 'baby_babble_loop', bus: 'voice', gainPct: 100, fadeMs: 80 },
      music: {
        stems: { calm: 'music_crawler_calm', tense: 'music_crawler_tense' },
        bus: 'music',
        gainPct: 100,
        fadeMs: 400,
      },
      sequenceMusic: {
        stay_awake: { clip: 'music_stay_awake', bus: 'music', gainPct: 100, fadeMs: 400 },
        lullaby_walk: { clip: 'music_lullaby_pad', bus: 'music', gainPct: 100, fadeMs: 400 },
      },
    },
    beatTracks: {
      lullaby: {
        notes: [
          'music_lullaby_note_1',
          'music_lullaby_note_2',
          'music_lullaby_note_3',
          'music_lullaby_note_4',
        ],
        countIn: 'music_lullaby_tick',
        decoy: 'baby_lullaby_coo',
        bus: 'music',
        gainPct: 100,
      },
    },
    beatScheduler: { scheduleAheadMs: 150, replanToleranceMs: 5 },
    beatRing: { approachMs: 500 },
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
    // Story 9.4: the house chores, at the live starting values. A level with no station never reads
    // them (no draw, no tap), so they move no existing test; a level with a station gets them.
    chores: { isEnabled: true, quietMinMs: 1500 },
    // Story 3.14 AC 6: these values reduce the human model to the one of before the story (no
    // reaction draw, `withChronoRing` at the old jitter, nobody inattentive), except the 9.4 spread of
    // the aim of a Papa who works at a station, which only a level with a station reads.
    human: {
      reactionMeanMs: 250,
      reactionSdMs: 0,
      reactionMinMs: 0,
      readError: {
        withChronoRing: { offsetMs: 0, sdMs: 60 },
        withoutChronoRing: { offsetMs: 0, sdMs: 60 },
      },
      aimOffsetMs: 0,
      jitterSdMs: 60,
      missWhileBusyPct: 0,
      backTurnedSdMs: 150,
      view: { widthPx: 844, heightPx: 390, hudBottomPx: 56, bubbleReadMs: 100 },
    },
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
    mamaLines: createTestMamaLines(),
  };
}

/** One generic line per reaction (story 3.8): the sim never reads it, a client test may. */
export function createTestMamaLines(): MamaLines {
  return {
    lines: MAMA_REACTIONS.map((reaction) => ({
      id: `${reaction}_any`,
      reaction,
      text: `Ligne de test (${reaction}).`,
    })),
  };
}

/** The window of the frozen feel with no modifier: what a `ResponseResolved` of a hand-made event carries. */
export function createTestResponseWindow(): {
  windowMs: number;
  perfectMs: number;
  toleranceMs: number;
  bufferMs: number;
} {
  const { windowMs, perfectMs, toleranceMs, bufferMs } = createTestContent().feel.timing;
  return { windowMs, perfectMs, toleranceMs, bufferMs };
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

/** The pot left on the fire, frozen like the outlet (`testPot.threat.json`): the threat on a chore's station (story 9.5). */
export function createTestPot(): ThreatDef {
  return readThreatFixture('testPot.threat.json');
}

/**
 * The frozen cooking that names its pot (story 9.5): `createTestCooking()` plus the `abandonedThreat`,
 * after the live 30 s. A test passes it as `choreDefs: { cooking: createTestAbandonableCooking() }`; the
 * default cooking has none, so that 9.4's chore worlds stay as they were.
 */
export function createTestAbandonableCooking(afterMs = 30_000): ChoreDef {
  return { ...createTestCooking(), abandonedThreat: { def: 'pot_on_stove', afterMs } };
}

/**
 * The open dishwasher, frozen like the outlet (`testDishwasherOpen.threat.json`, story 9.6): the threat of
 * the dishwasher chore's open door, a parry on an anchor that the director may draw only while the chore
 * is paused with its door open.
 */
export function createTestDishwasherOpen(): ThreatDef {
  return readThreatFixture('testDishwasherOpen.threat.json');
}

/** The micro-sleep, frozen like the outlet (`testMicroSleep.threat.json`): the threat on Papa. */
export function createTestMicroSleep(): ThreatDef {
  return readThreatFixture('testMicroSleep.threat.json');
}

/** How long the frozen micro-sleep keeps Papa asleep, in sim ms (its `afterEffect.busyMs`, story 3.15). */
export function testMicroSleepBusyMs(): number {
  const { afterEffect } = createTestMicroSleep();
  if (afterEffect.kind !== 'asleep') throw new Error('testMicroSleep.threat.json is not asleep');
  return afterEffect.busyMs;
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

/**
 * The cooking (story 9.4), frozen like the phone (`testCooking.chore.json`, same values as
 * `content/chores/cooking.json`; only its `$schema` path differs), never from the live file.
 */
export function createTestCooking(): ChoreDef {
  const path = 'tests/support/testCooking.chore.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testCooking.chore.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, ChoreDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/**
 * The dishwasher chore (story 9.6), frozen like the cooking (`testDishwasher.chore.json`, same values as
 * `content/chores/unload_dishwasher.json`; only its `$schema` path differs): four plates to catch, a
 * missed one breaks an object and makes noise, and it names the open dishwasher's threat.
 */
export function createTestUnloadDishwasher(): ChoreDef {
  const path = 'tests/support/testDishwasher.chore.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testDishwasher.chore.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, ChoreDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/**
 * « Rester éveillé », frozen like the phone (`testStayAwake.sequence.json`): the live def's shape,
 * but a short one (3 steps of 5 s) so that a test and a golden scenario stay small.
 */
export function createTestStayAwake(): SequenceDef {
  const path = 'tests/support/testStayAwake.sequence.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testStayAwake.sequence.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, SequenceDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/**
 * « Les 100 pas en rythme », frozen like « Rester éveillé » (`testLullaby.sequence.json`): the live
 * def's shape, but a short one (10 s, a handful of beats and a decoy) so that a test and a golden
 * scenario stay small, and costs of its own that a test can count on.
 */
export function createTestLullabyWalk(): SequenceDef {
  const path = 'tests/support/testLullaby.sequence.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testLullaby.sequence.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, SequenceDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/**
 * « Duel du coucher », frozen like the others (`testBedtimeDuel.sequence.json`, story 4.6): three
 * duel steps of 8 s, 1 s of rest, three retreats to lose. Its threat is `createTestBedtimeEyes()`.
 */
export function createTestBedtimeDuel(): SequenceDef {
  const path = 'tests/support/testBedtimeDuel.sequence.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testBedtimeDuel.sequence.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, SequenceDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/**
 * A duel with the fake sleep, frozen (`testFakeSleepDuel.sequence.json`, story 4.7): the eyes, then the
 * fake sleep, 12 s each. It carries the id `fake_sleep_duel`, so it never replaces `bedtime_duel`.
 */
export function createTestFakeSleepDuel(): SequenceDef {
  const path = 'tests/support/testFakeSleepDuel.sequence.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testFakeSleepDuel.sequence.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, SequenceDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/**
 * The fake sleep's round alone (story 4.7): the frozen duel with its second step as its only one, under
 * the same id, so that a test plays the feint with no round of the eyes before it. Pass it as
 * `sequenceDefs: { [def.id]: def }` of a level that lists `def.id` in its `sequences`.
 */
export function createTestFakeSleepRound(): SequenceDef {
  const duel = createTestFakeSleepDuel();
  const step = duel.steps[1];
  if (step === undefined) throw new Error('the frozen fake sleep duel has no second step');
  return { ...duel, steps: [step] };
}

/**
 * « Dépose-bombe », frozen like the others (`testBombDrop.sequence.json`, story 4.8): one duel step
 * (6 s) on `bomb_drop_lay`, slow motion at 0.4, three retreats to lose, and the baby laid to win.
 */
export function createTestBombDrop(): SequenceDef {
  const path = 'tests/support/testBombDrop.sequence.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testBombDrop.sequence.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, SequenceDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/**
 * « Sortie en infiltration », frozen like the others (`testStealth.sequence.json`, story 4.9): one
 * stealth step to the `door` anchor of the frozen room, an alert every 4 to 7 s, 30 % of them real
 * wakes, on `false_alarm_sigh` and `real_wake`.
 */
export function createTestStealthExit(): SequenceDef {
  const path = 'tests/support/testStealth.sequence.json';
  const text = readFileSync(
    fileURLToPath(new URL('./testStealth.sequence.json', import.meta.url)),
    'utf8',
  );
  const parsed = parseContentFile(path, text, SequenceDefSchema);
  if (!parsed.ok) {
    throw new Error(`${path} is invalid:\n${parsed.error.map(formatContentProblem).join('\n')}`);
  }
  return parsed.value;
}

/** The frozen sequences, by id. */
export function createTestSequences(): Readonly<Record<string, SequenceDef>> {
  const defs = [
    createTestStayAwake(),
    createTestLullabyWalk(),
    createTestBedtimeDuel(),
    createTestFakeSleepDuel(),
    createTestBombDrop(),
    createTestStealthExit(),
  ];
  return Object.fromEntries(defs.map((def) => [def.id, def]));
}

/**
 * A frozen threat whose gag makes the baby cry for 3500 ms (`testCrying.threat.json`, story 3.1):
 * the outlet with a `gagCryMs`. No live threat declares one yet.
 */
export function createTestCryingOutlet(): ThreatDef {
  return readThreatFixture('testCrying.threat.json');
}

/** The cry in the arms, frozen like the outlet (`testArmsCry.threat.json`, story 4.1): the second threat on Papa. */
export function createTestArmsCry(): ThreatDef {
  return readThreatFixture('testArmsCry.threat.json');
}

/**
 * The baby's eyes of the bedtime duel, frozen like the outlet (`testBedtimeEyes.threat.json`, story
 * 4.6): the `wait` threat on Papa. A signal 2 to 4 s after the telegraph, which lasts 800 ms.
 */
export function createTestBedtimeEyes(): ThreatDef {
  return readThreatFixture('testBedtimeEyes.threat.json');
}

/**
 * The fake sleep of the bedtime duel, frozen like the eyes (`testFakeSleep.threat.json`, story 4.7):
 * the `wait` threat on Papa with a feint. The feint 1200 to 2600 ms after the telegraph delay, the
 * signal 3500 to 7000 ms after it, at least 900 ms between the two.
 */
export function createTestFakeSleep(): ThreatDef {
  return readThreatFixture('testFakeSleep.threat.json');
}

/**
 * The bomb drop's Firmness, frozen like the others (`testBombDrop.threat.json`, story 4.8): a `firm`
 * on Papa judged on its release. A 2600 ms descent, a press within 700 ms of the telegraph, a 300 ms
 * window for the release.
 */
export function createTestBombDropLay(): ThreatDef {
  return readThreatFixture('testBombDrop.threat.json');
}

/**
 * The false alarm of the stealth exit, frozen like the others (`testFalseAlarm.threat.json`, story
 * 4.9): a `nothing` on the baby. A 900 ms telegraph, then 2000 ms to sit through.
 */
export function createTestFalseAlarm(): ThreatDef {
  return readThreatFixture('testFalseAlarm.threat.json');
}

/**
 * The real wake of the stealth exit, frozen like the others (`testRealWake.threat.json`, story 4.9):
 * a `parry` on the baby. A 1500 ms telegraph, then the feel's window.
 */
export function createTestRealWake(): ThreatDef {
  return readThreatFixture('testRealWake.threat.json');
}

/** The fourteen frozen threats, by id. */
export function createTestThreats(): Readonly<Record<string, ThreatDef>> {
  const defs = [
    createTestOutlet(),
    createTestStairs(),
    createTestCoffeeTableObject(),
    createTestMicroSleep(),
    createTestSilence(),
    createTestCryingOutlet(),
    createTestArmsCry(),
    createTestBedtimeEyes(),
    createTestFakeSleep(),
    createTestBombDropLay(),
    createTestFalseAlarm(),
    createTestRealWake(),
    createTestPot(),
    createTestDishwasherOpen(),
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

/** The crying outlet (`createTestCryingOutlet`) at the frozen room's `outlet_01` anchor. */
export const CRYING_OUTLET: LevelWaveThreat = { def: 'crying_outlet', anchor: 'outlet_01' };

/** The suspicious silence in the frozen room's `behind_sofa` hidden zone. */
export const SILENCE: LevelWaveThreat = { def: 'silence_mischief', anchor: 'behind_sofa' };

/** The phone of the live level, planned at `atMs` on the object `phone` (the one of `TEST_OBJECTS`). */
export function testPhoneEntry(atMs: number): LevelWaveDisruption {
  return { def: 'phone', object: 'phone', atMs };
}

/**
 * A wave of `threats`: from 0 ms, one at a time, no gap and no lull, no disruption unless `overrides` says so. A
 * test that used `outletEntry(2000)` uses `testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })`:
 * its first telegraph lands at the first step at or after 2000 ms. A wave that plans a silence allows
 * two at once, not one: a silence counts for two against `maxSimultaneous`, and `createSim` refuses a
 * wave where it could never be drawn (story 3.13); a test that wants the refusal passes `maxSimultaneous: 1`.
 */
export function testWave(
  threats: readonly LevelWaveThreat[],
  overrides: Partial<Omit<LevelWave, 'threats'>> = {},
): LevelWave {
  const isSilencePlanned = threats.some((entry) => entry.def === SILENCE.def);
  return {
    fromMs: 0,
    maxSimultaneous: isSilencePlanned ? SILENCE_SIMULTANEOUS_WEIGHT : 1,
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
  /** The level lets Papa carry the baby (story 4.1); absent by default, as in most test levels. */
  carry?: LevelCarry;
  /**
   * The house chores of the level (story 9.4), each on a station object the test also lists in
   * `objects` (`TEST_STOVE`); absent by default, so no other test level moves (not even its hash).
   */
  chores?: readonly LevelChore[];
  /** Replaces the frozen def of a chore id (`createTestCooking()` otherwise), for a test that tunes it. */
  choreDefs?: Readonly<Record<string, ChoreDef>>;
  /** The sequences the level can run (story 4.4), by id; empty by default, so no other test level moves. */
  sequences?: readonly string[];
  /** Replaces the frozen def of a sequence id (`createTestStayAwake()` otherwise), for a test that tunes it. */
  sequenceDefs?: Readonly<Record<string, SequenceDef>>;
  /** The level opts into the final rush (story 3.5); absent by default, so no other test level moves. */
  finalRush?: LevelFinalRush;
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
  carry,
  chores,
  choreDefs = {},
  sequences = [],
  sequenceDefs = {},
  finalRush,
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
  const armsCryDef = carry?.armsCryDef;
  if (armsCryDef !== undefined) {
    const def = all[armsCryDef];
    if (def === undefined) throw new Error(`no frozen threat "${armsCryDef}" in tests/support`);
    threats[def.id] = def;
  }
  // A duel step spawns its own threat on Papa (story 4.6) and a stealth step its two alerts on the baby
  // (story 4.9): the level carries their defs, as `loadLevelContent` does.
  for (const id of sequences) {
    for (const step of (sequenceDefs[id] ?? createTestSequences()[id])?.steps ?? []) {
      const defIds =
        step.kind === 'duel'
          ? [step.threatDef]
          : step.kind === 'stealth'
            ? [step.falseAlarmDef, step.realWakeDef]
            : [];
      for (const defId of defIds) {
        const def = all[defId];
        if (def === undefined) throw new Error(`no frozen threat "${defId}" in tests/support`);
        threats[def.id] = def;
      }
    }
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
  const choreContent = chores?.map((entry) => {
    const def =
      choreDefs[entry.def] ??
      (entry.def === 'unload_dishwasher' ? createTestUnloadDishwasher() : createTestCooking());
    if (def.id !== entry.def) throw new Error(`no frozen chore "${entry.def}" in tests/support`);
    return structuredClone(def);
  });
  // The threat an abandoned chore turns into (story 9.5) is carried by the level, as `loadLevelContent` does.
  for (const def of choreContent ?? []) {
    if (def.abandonedThreat === undefined) continue;
    const pot = all[def.abandonedThreat.def];
    if (pot === undefined) {
      throw new Error(`no frozen threat "${def.abandonedThreat.def}" in tests/support`);
    }
    threats[pot.id] = pot;
  }
  const sequenceContent: Record<string, SequenceDef> = {};
  for (const id of sequences) {
    const def = sequenceDefs[id] ?? createTestSequences()[id];
    if (def === undefined || def.id !== id) {
      throw new Error(`no frozen sequence "${id}" in tests/support`);
    }
    sequenceContent[id] = def;
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
      ...(chores === undefined ? {} : { chores: chores.map((entry) => ({ ...entry })) }),
      gauges: structuredClone(gauges),
      ...(carry === undefined ? {} : { carry: structuredClone(carry) }),
      sequences: [...sequences],
      ...(finalRush === undefined ? {} : { finalRush: structuredClone(finalRush) }),
      camera: 'fixed',
      feelOverrides: { ...feelOverrides },
    },
    threats,
    disruptions,
    sequences: sequenceContent,
    ...(choreContent === undefined ? {} : { chores: choreContent }),
  };
}

/** The coffee machine and the phone of the live level, at the frozen room's anchors of the same names. */
export const TEST_OBJECTS: readonly LevelObject[] = [
  { id: 'coffee_machine', kind: 'coffee_machine', anchor: 'coffee_machine' },
  { id: 'phone', kind: 'phone', anchor: 'phone' },
];

/**
 * A stove (story 9.4) at the frozen room's `stairs_top` anchor, a floor point Papa reaches: the
 * station of the frozen cooking (`TestLevelOptions.chores`: `[TEST_COOKING]`, with this in `objects`).
 */
export const TEST_STOVE: LevelObject = { id: 'stove', kind: 'stove', anchor: 'stairs_top' };

/** The frozen cooking on `TEST_STOVE`. */
export const TEST_COOKING: LevelChore = { def: 'cooking', object: 'stove' };

/**
 * A dishwasher (story 9.6) at the frozen room's `door` anchor, a floor point Papa reaches (not the
 * stove's): the station of the frozen dishwasher chore, and where its open-door threat stands.
 */
export const TEST_DISHWASHER: LevelObject = {
  id: 'dishwasher',
  kind: 'dishwasher',
  anchor: 'door',
};

/** The frozen dishwasher chore on `TEST_DISHWASHER`. */
export const TEST_UNLOAD_DISHWASHER: LevelChore = {
  def: 'unload_dishwasher',
  object: 'dishwasher',
};

/** The open dishwasher at the station's anchor, as a wave plans it (`TEST_DISHWASHER`). */
export const DISHWASHER_OPEN: LevelWaveThreat = { def: 'dishwasher_open', anchor: 'door' };

/** The toilet of the live level (story 4.3), at the frozen room's `toilet` anchor: not in `TEST_OBJECTS`, a test adds it. */
export const TEST_TOILET: LevelObject = { id: 'toilet', kind: 'toilet', anchor: 'toilet' };

/** A level with the pressing need (story 4.3): the toilet needs it (`TestLevelOptions.gauges`). */
export const NEED_GAUGES: LevelGauges = { need: {} };

/** A level with fatigue: the frozen micro-sleep (`TestLevelOptions.gauges`). */
export const FATIGUE_GAUGES: LevelGauges = { fatigue: { microSleepDef: 'papa_microsleep' } };

/** A level that lets Papa carry the baby, with the frozen cry in the arms (story 4.1). */
export const CARRY: LevelCarry = { armsCryDef: 'arms_cry' };

/** A level with the noise gauge (`gauges.noise`, story 3.1). */
export const NOISE_GAUGES: LevelGauges = { noise: {} };

/** Runs `n` steps: time in tests is counted in steps (`stepN(sim, 120)` = 1200 ms of sim time). */
export function stepN(sim: Sim, n: number): void {
  for (let i = 0; i < n; i++) sim.step();
}
