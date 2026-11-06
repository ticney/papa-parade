import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LevelContent } from '@content/contentBundle';
import { parseContentFile } from '@content/parseContentFile';
import { type ChoreDef, ChoreDefSchema } from '@content/schemas/chore';
import { LevelSchema } from '@content/schemas/level';
import { type SequenceDef, SequenceDefSchema } from '@content/schemas/sequence';
import {
  type ThreatDef,
  ThreatDefSchema,
  ThreatGagIds,
  type ThreatResponse,
} from '@content/schemas/threat';
import { DIFFICULTY_TIER_IDS, type DifficultyTierId, STEP_MS } from '@shared/constants';
import { nextFloat, type RngState } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { createSim, GAG_IDS, type Sim, type SimEvent, type World } from '@sim';
import { describe, expect, it } from 'vitest';
import { FLOAT_MAX, FLOAT_ZERO } from '../support/stealthSupport.ts';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';

// One "perfect / success / too early / too late" set per file of content/threats/, generated from
// the JSON: adding a threat adds its four tests, and nothing in this file knows a threat by name.
// The test-only defs of tests/threats/fixtures/ (story 1.23: a Firmness, which no live level asks for
// yet) run the same set, and each response adds its own cases (a Firmness released early, a Parry held).
// Story 2.8: the set runs at each difficulty tier (a window wider or tighter, the same verdicts), the
// tier being sent as the client sends it, a `SetDifficultyTier` at t = 0 (none at `normal`).
// Each case plays on the frozen room with EVERY def planned, at the anchor a live level plans it,
// so that the three threats share one level. The frozen feel and geometry are used, so that
// retuning feel.json cannot move a result; the threats and the levels are the live files, since
// this test is there to prove them.

const THREATS_DIR = fileURLToPath(new URL('../../content/threats/', import.meta.url));
const LEVELS_DIR = fileURLToPath(new URL('../../content/levels/', import.meta.url));
const SEQUENCES_DIR = fileURLToPath(new URL('../../content/sequences/', import.meta.url));
const CHORES_DIR = fileURLToPath(new URL('../../content/chores/', import.meta.url));
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

/**
 * The anchors of the frozen room that no live def uses, one per fixture (two defs cannot share an
 * anchor): where the fixture defs are planned. `test_wait` (story 4.6) goes to the `phone` anchor, as
 * `door` is the Firmness's; no object stands there in this level.
 */
const FIXTURE_ANCHORS: Readonly<Record<string, string>> = {
  test_firm: 'door',
  test_wait: 'phone',
};

/** How long the catalogue's chore must be abandoned before its pot starts, in sim ms (a short wait, the live one is 30 s). */
const STATION_AFTER_MS = 1000;

/** A release time beyond every case's horizon: the other defs stay idle while one is tested. */
const CATALOG_OTHERS_FROM_MS = 600_000;

function readDefs(dir: string, shown: string): ThreatDef[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const text = readFileSync(`${dir}${name}`, 'utf8');
      const parsed = parseContentFile(`${shown}${name}`, text, ThreatDefSchema);
      if (!parsed.ok) throw new Error(`${name} is invalid: ${JSON.stringify(parsed.error)}`);
      return parsed.value;
    });
}

const liveDefs = readDefs(THREATS_DIR, 'content/threats/');
/**
 * Test-only defs (story 1.23 D5): a response no live level asks for yet (the Firmness) is proved on
 * a fixture. They are planned at their `FIXTURE_ANCHORS` entry, never by a live level.
 */
const fixtureDefs = readDefs(FIXTURES_DIR, 'tests/threats/fixtures/');
const fixtureIds = new Set(fixtureDefs.map((def) => def.id));
const defs: ThreatDef[] = [...liveDefs, ...fixtureDefs];

/**
 * The anchor of the first entry of a live level that plans each def (`*.geometry.json` are not levels),
 * among those of the frozen room these tests play in (`chambre_night` plans a def at its own anchors).
 * A silence is planned at a zone, hence the two lists.
 */
const frozenRoom = createTestGeometry();
const frozenAnchorIds = new Set(
  [...frozenRoom.anchors, ...frozenRoom.zones].map((point) => point.id),
);
const anchors = new Map<string, string>();
/**
 * The defs a live level spawns on Papa (`gauges.fatigue.microSleepDef`, `carry.armsCryDef`): they
 * have no anchor.
 */
const spawnedOnPapa = new Set<string>();
/** The ones that are a cry in the arms (story 4.1): the baby must be carried for them to come. */
const armsCryDefs = new Set<string>();
/**
 * The ones a live sequence's `duel` step spawns on Papa (story 4.6): they come when the sequence
 * starts, so they are tested through a one-step sequence of their own.
 */
const duelDefs = new Set<string>();
/**
 * The ones a live sequence's `stealth` step spawns on the baby (story 4.9): a false alarm (a `nothing`)
 * and a real wake (a `parry`), both on `target: "baby"`, which no wave can plan.
 */
const stealthDefs = new Set<string>();
/**
 * The ones a live chore turns into when it is abandoned (story 9.5), on `target: "station"`: no wave plans
 * them, they come when the chore has been `paused` for the chore's `afterMs`, so they are tested through a
 * level with the chore (its own, with a short `afterMs`).
 */
const stationDefs = new Map<string, ChoreDef>();
let liveStealthSequence: SequenceDef | undefined;
for (const name of readdirSync(LEVELS_DIR).sort()) {
  if (!name.endsWith('.json') || name.endsWith('.geometry.json')) continue;
  const text = readFileSync(`${LEVELS_DIR}${name}`, 'utf8');
  const parsed = parseContentFile(`content/levels/${name}`, text, LevelSchema);
  if (!parsed.ok) throw new Error(`${name} is invalid: ${JSON.stringify(parsed.error)}`);
  for (const entry of parsed.value.waves.flatMap((wave) => wave.threats)) {
    if (!anchors.has(entry.def) && frozenAnchorIds.has(entry.anchor)) {
      anchors.set(entry.def, entry.anchor);
    }
  }
  for (const entry of parsed.value.chores ?? []) {
    const choreText = readFileSync(`${CHORES_DIR}${entry.def}.json`, 'utf8');
    const chore = parseContentFile(`content/chores/${entry.def}.json`, choreText, ChoreDefSchema);
    if (!chore.ok) throw new Error(`${entry.def} is invalid: ${JSON.stringify(chore.error)}`);
    if (chore.value.abandonedThreat !== undefined) {
      stationDefs.set(chore.value.abandonedThreat.def, chore.value);
    }
  }
  const microSleepDef = parsed.value.gauges.fatigue?.microSleepDef;
  if (microSleepDef !== undefined) spawnedOnPapa.add(microSleepDef);
  const armsCryDef = parsed.value.carry?.armsCryDef;
  if (armsCryDef !== undefined) {
    spawnedOnPapa.add(armsCryDef);
    armsCryDefs.add(armsCryDef);
  }
  for (const sequenceId of parsed.value.sequences) {
    const sequenceText = readFileSync(`${SEQUENCES_DIR}${sequenceId}.json`, 'utf8');
    const sequence = parseContentFile(
      `content/sequences/${sequenceId}.json`,
      sequenceText,
      SequenceDefSchema,
    );
    if (!sequence.ok) {
      throw new Error(`${sequenceId} is invalid: ${JSON.stringify(sequence.error)}`);
    }
    for (const step of sequence.value.steps) {
      if (step.kind === 'stealth') {
        // Story 4.9: a stealth step spawns its two alerts on the baby. They are tested through the live
        // sequence itself (the real exit, the real gaps), the alert being forced at the telegraph.
        stealthDefs.add(step.falseAlarmDef);
        stealthDefs.add(step.realWakeDef);
        liveStealthSequence ??= sequence.value;
        continue;
      }
      if (step.kind !== 'duel') continue;
      spawnedOnPapa.add(step.threatDef);
      duelDefs.add(step.threatDef);
    }
  }
}

/** The cry in the arms a duel level carries with (the schema asks for one): the first a live level has. */
const CARRY_CRY_DEF = [...armsCryDefs][0] ?? 'arms_cry';

/**
 * The one-step sequence a duel def is tested through: its threat on Papa, no rest, a length that
 * fits any tier, three retreats to lose. Built by hand (the sim takes the structure, not the schema).
 */
function duelSequenceOf(def: ThreatDef): SequenceDef {
  return {
    id: 'catalog_duel',
    babyCarried: true,
    steps: [{ kind: 'duel', durationMs: 60_000, threatDef: def.id, restMs: 0 }],
    // A Firmness judged on its release lays the baby down (story 4.8); every other duel just ends.
    success: { kind: def.release === undefined ? 'stepsDone' : 'babyLaid' },
    failure: { kind: 'retreats', maxRetreats: 3 },
    framing: {
      camera: { zoomPct: 0, focusPct: 0, inMs: 1000, outMs: 1000 },
      musicLoop: null,
      bar: null,
    },
    feedback: {
      started: 'sequence_started',
      succeeded: 'sequence_succeeded',
      failed: 'sequence_failed',
    },
  };
}

const content = createTestContent();
const geometry = createTestGeometry();
const { holdMinMs } = content.feel.input;

/** How a right answer is given: when the finger comes up (null: it stays down), and when it is over. */
interface Answer {
  /** When the finger goes down; the instant asked for when absent (a Firmness judged on its release presses early). */
  pressAt?: number;
  releaseAt: number | null;
  settledAt: number;
}

/**
 * The right answer to a press at `pressT` on a threat whose window opens at `openAt`: a Parry is
 * released at half the minimum hold; a Firmness is held to the end of the attack, with no release.
 * An exhaustive `switch`: a new response breaks the typecheck until the catalogue knows how to answer it.
 */
function answerOf(def: ThreatDef, pressT: number, openAt: number): Answer {
  const response: ThreatResponse = def.response;
  switch (response) {
    // A `wait` is answered with a tap too: the signal decides when, not how (story 4.6).
    case 'parry':
    case 'wait':
      return { releaseAt: pressT + holdMinMs / 2, settledAt: pressT + holdMinMs };
    case 'firm': {
      if (def.release !== undefined) {
        // Story 4.8: pressed at the first steps of the descent, released at the instant asked for (the
        // pose, if it is a perfect answer); the verdict comes when the window is open.
        const telegraphDelayMs = def.telegraphDelayMs ?? Number.NaN;
        return {
          pressAt: openAt - telegraphDelayMs + STEP_MS,
          releaseAt: pressT,
          settledAt: Math.max(pressT, openAt) + 2 * STEP_MS,
        };
      }
      if (def.holdUntilMs === undefined) throw new Error(`"${def.id}" is firm with no holdUntilMs`);
      return {
        releaseAt: null,
        settledAt: Math.max(pressT + holdMinMs, openAt + def.holdUntilMs) + STEP_MS,
      };
    }
    case 'nothing':
      // Story 4.9: nothing is answered by not pressing; its block below never calls this.
      throw new Error(`"${def.id}" is answered by leaving it alone, not by a press`);
  }
}

/** Presses `def` at `t` and answers it as it asks. */
function answer(sim: Sim, def: ThreatDef, threatId: number, t: number, openAt: number): Answer {
  const given = answerOf(def, t, openAt);
  sim.enqueue({ type: 'PressThreat', t: asSimMs(given.pressAt ?? t), threatId });
  if (given.releaseAt !== null) sim.enqueue({ type: 'Release', t: asSimMs(given.releaseAt) });
  return given;
}

/** The anchor `def` is planned at: a fixture's own, else a live level's; a def no level plans fails here, with its name. */
function anchorOf(def: ThreatDef): string {
  if (fixtureIds.has(def.id)) {
    const fixtureAnchor = FIXTURE_ANCHORS[def.id];
    if (fixtureAnchor === undefined) throw new Error(`fixture "${def.id}" has no anchor`);
    return fixtureAnchor;
  }
  const anchor = anchors.get(def.id);
  if (anchor === undefined) throw new Error(`"${def.id}" is planned by no level`);
  return anchor;
}

/**
 * The frozen room planning every anchored def at its live anchor: `tested` from 0 ms, the others
 * much later. A def spawned on Papa has no anchor and no wave: it is the level's micro-sleep, and
 * `contentFor` makes it due at once.
 */
function levelPlanning(tested: ThreatDef): LevelContent {
  const anchored = defs.filter(
    (def) => def.target !== 'papa' && def.target !== 'baby' && def.target !== 'station',
  );
  const planned = (def: ThreatDef) => ({ def: def.id, anchor: anchorOf(def) });
  if (duelDefs.has(tested.id)) {
    const cry = defs.find((def) => def.id === CARRY_CRY_DEF);
    if (cry === undefined) throw new Error(`no live cry in the arms "${CARRY_CRY_DEF}"`);
    return {
      level: {
        id: 'salon_crawler',
        variant: 'nap' as const,
        durationMs: CATALOG_OTHERS_FROM_MS,
        objects: [],
        gauges: {},
        carry: { armsCryDef: cry.id },
        sequences: ['catalog_duel'],
        camera: 'fixed',
        feelOverrides: {},
        waves: [],
      },
      threats: Object.fromEntries([tested, cry].map((def) => [def.id, def])),
      disruptions: {},
      sequences: { catalog_duel: duelSequenceOf(tested) },
    };
  }
  const stationChore = stationDefs.get(tested.id);
  if (stationChore !== undefined) {
    // The chore of a live level, the stove at a floor point of the frozen room, a short wait.
    const chore: ChoreDef = {
      ...stationChore,
      abandonedThreat: { def: tested.id, afterMs: STATION_AFTER_MS },
    };
    return {
      level: {
        id: 'salon_crawler',
        variant: 'nap' as const,
        durationMs: CATALOG_OTHERS_FROM_MS,
        objects: [{ id: 'stove', kind: 'stove' as const, anchor: 'stairs_top' }],
        chores: [{ def: chore.id, object: 'stove' }],
        gauges: {},
        sequences: [],
        camera: 'fixed',
        feelOverrides: {},
        waves: [],
      },
      threats: { [tested.id]: tested },
      disruptions: {},
      sequences: {},
      chores: [chore],
    };
  }
  if (stealthDefs.has(tested.id)) {
    const cry = defs.find((def) => def.id === CARRY_CRY_DEF);
    if (cry === undefined) throw new Error(`no live cry in the arms "${CARRY_CRY_DEF}"`);
    if (liveStealthSequence === undefined) throw new Error('no live stealth sequence');
    return {
      level: {
        id: 'salon_crawler',
        variant: 'nap' as const,
        durationMs: CATALOG_OTHERS_FROM_MS,
        objects: [],
        gauges: {},
        carry: { armsCryDef: cry.id },
        sequences: [liveStealthSequence.id],
        camera: 'fixed',
        feelOverrides: {},
        waves: [],
      },
      threats: Object.fromEntries(defs.map((def) => [def.id, def])),
      disruptions: {},
      sequences: { [liveStealthSequence.id]: liveStealthSequence },
    };
  }
  if (armsCryDefs.has(tested.id)) {
    return {
      level: {
        id: 'salon_crawler',
        variant: 'nap' as const,
        durationMs: CATALOG_OTHERS_FROM_MS,
        objects: [],
        gauges: {},
        carry: { armsCryDef: tested.id },
        sequences: [],
        camera: 'fixed',
        feelOverrides: {},
        waves: [],
      },
      threats: Object.fromEntries(defs.map((def) => [def.id, def])),
      disruptions: {},
      sequences: {},
    };
  }
  if (tested.target === 'papa') {
    return {
      level: {
        id: 'salon_crawler',
        variant: 'nap' as const,
        durationMs: CATALOG_OTHERS_FROM_MS,
        objects: [],
        gauges: { fatigue: { microSleepDef: tested.id } },
        sequences: [],
        camera: 'fixed',
        feelOverrides: {},
        waves: [],
      },
      threats: Object.fromEntries(defs.map((def) => [def.id, def])),
      disruptions: {},
      sequences: {},
    };
  }
  // Two, not one: a silence counts for two against `maxSimultaneous` (story 3.13), and the catalog plans one.
  const wave = { maxSimultaneous: 2, gapMinMs: 0, gapMaxMs: 0, lullMs: 0, disruptions: [] };
  return {
    level: {
      id: 'salon_crawler',
      variant: 'nap' as const,
      durationMs: CATALOG_OTHERS_FROM_MS + CATALOG_OTHERS_FROM_MS,
      objects: [],
      gauges: {},
      sequences: [],
      camera: 'fixed',
      feelOverrides: {},
      waves: [
        { ...wave, fromMs: 0, threats: [planned(tested)] },
        {
          ...wave,
          fromMs: CATALOG_OTHERS_FROM_MS,
          threats: anchored.filter((def) => def !== tested).map(planned),
        },
      ],
    },
    threats: Object.fromEntries(defs.map((def) => [def.id, def])),
    disruptions: {},
    sequences: {},
  };
}

/**
 * The content a def is tested with. A def spawned on Papa is due at the first step: he starts
 * exhausted and the delay between micro-sleeps is nil. A cry in the arms is due at the step after
 * the baby is taken (its delay is nil, and the baby is always within reach).
 */
function contentFor(def: ThreatDef) {
  if (duelDefs.has(def.id) || stealthDefs.has(def.id)) {
    // The cry in the arms the level carries with must not come during the duel.
    return {
      ...content,
      feel: {
        ...content.feel,
        carry: { ...content.feel.carry, armsCryMinMs: 600_000, armsCryMaxMs: 600_000 },
      },
    };
  }
  if (armsCryDefs.has(def.id)) {
    return {
      ...content,
      feel: {
        ...content.feel,
        carry: { ...content.feel.carry, reachM: 100, armsCryMinMs: 0, armsCryMaxMs: 0 },
      },
    };
  }
  if (def.target !== 'papa') return content;
  return {
    ...content,
    feel: {
      ...content.feel,
      fatigue: {
        ...content.feel.fatigue,
        startPoints: 100,
        microSleepMinMs: 0,
        microSleepMaxMs: 0,
      },
    },
  };
}

/**
 * Plays a hidden-zone threat up to its telegraph: the director hides it at the first step, the baby
 * goes quiet and the silence starts, then the player taps the baby (story 1.21). Bounded: a silence
 * that never starts fails the test rather than hanging it.
 */
function findTheBaby(sim: Sim): void {
  const events: SimEvent[] = [];
  const stepUntil = (isDone: () => boolean): void => {
    for (let i = 0; i < 2000 && !isDone(); i++) {
      sim.step();
      for (const event of sim.drainEvents()) events.push(event);
    }
  };
  stepUntil(() => sim.world.silence.startedAt !== null);
  expect(events.some((event) => event.type === 'ThreatHidden')).toBe(true);
  expect(sim.world.silence.startedAt).not.toBeNull();
  sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });
  stepUntil(() => events.some((event) => event.type === 'ThreatTelegraphed'));
  expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
}

/** How many `nextFloat` it takes to go from the rng state `before` to `after` (at most 8; -1 if never). */
function drawsBetween(before: RngState, after: RngState): number {
  const replay = { ...before };
  for (let draws = 0; draws <= 8; draws++) {
    if (
      replay.a === after.a &&
      replay.b === after.b &&
      replay.c === after.c &&
      replay.d === after.d
    ) {
      return draws;
    }
    nextFloat(replay);
  }
  return -1;
}

/** A sim stopped on the step that telegraphed the threat, with the times its window gives. */
async function telegraphed(
  def: ThreatDef,
  tier: DifficultyTierId,
  earlyPress: 'fail' | 'guard' = 'fail',
  lagMs = 0,
) {
  const base = contentFor(def);
  const sim = await createSim({
    content: { ...base, feel: { ...base.feel, input: { ...base.feel.input, earlyPress } } },
    geometry,
    level: levelPlanning(def),
    seed: 1,
  });
  if (tier !== 'normal') sim.enqueue({ type: 'SetDifficultyTier', t: asSimMs(0), tier });
  if (lagMs > 0) sim.enqueue({ type: 'SetInputLag', t: asSimMs(0), lagMs });
  // The rng around the step that telegraphs a duel def (story 4.7: the draws it makes there).
  let rngBefore: RngState | null = null;
  if (def.target === 'hiddenZone') {
    findTheBaby(sim);
  } else if (duelDefs.has(def.id)) {
    // Story 4.6: the sequence takes the baby and spawns the threat on Papa (no rest in the test's step).
    sim.enqueue({
      type: 'StartSequence',
      t: asSimMs(sim.world.time.sim),
      sequenceId: 'catalog_duel',
    });
    rngBefore = { ...sim.world.rng };
    sim.step();
    const events = [...sim.drainEvents()];
    expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
  } else if (stealthDefs.has(def.id)) {
    // Story 4.9: the sequence starts, then the alert of the tested def is forced at the next step (the
    // rng set so that the kind's draw is extreme, the alert due now): the real thing, the gaps apart.
    if (liveStealthSequence === undefined) throw new Error('no live stealth sequence');
    sim.enqueue({
      type: 'StartSequence',
      t: asSimMs(sim.world.time.sim),
      sequenceId: liveStealthSequence.id,
    });
    sim.step();
    sim.drainEvents();
    (sim.world as World).rng = { ...(def.response === 'nothing' ? FLOAT_MAX : FLOAT_ZERO) };
    sim.world.sequence.stealth.nextAlertAt = asSimMs(sim.world.time.sim);
    sim.step();
    const events = [...sim.drainEvents()];
    expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
    sim.world.sequence.stealth.nextAlertAt = asSimMs(CATALOG_OTHERS_FROM_MS);
  } else if (stationDefs.has(def.id)) {
    // Story 9.5: Papa starts the chore, leaves it, and the pot comes when the wait is over.
    sim.enqueue({ type: 'TapObject', t: asSimMs(sim.world.time.sim), objectId: 'stove' });
    for (let i = 0; i < 1000 && sim.world.chores[0]?.state !== 'working'; i++) sim.step();
    expect(sim.world.chores[0]?.state).toBe('working');
    sim.enqueue({ type: 'TapFloor', t: asSimMs(sim.world.time.sim), xM: 0, zM: 0 });
    const events: SimEvent[] = [];
    for (let i = 0; i < 1000 && !events.some((e) => e.type === 'ThreatTelegraphed'); i++) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
  } else if (armsCryDefs.has(def.id)) {
    // Papa takes the baby (he is in reach); the cry in the arms is telegraphed at the next step.
    sim.enqueue({ type: 'TapBaby', t: asSimMs(sim.world.time.sim) });
    sim.step();
    sim.step();
    const events = [...sim.drainEvents()];
    expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
  } else {
    sim.step();
    const events = [...sim.drainEvents()];
    expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
  }
  const threat = sim.world.threats.find((candidate) => candidate.defId === def.id);
  if (threat === undefined || threat.responseWindow === null) throw new Error('not telegraphed');
  const { windowOpenAt, responseWindow, feintAt } = threat;
  return {
    sim,
    threatId: threat.id,
    enteredAt: threat.enteredAt,
    openAt: windowOpenAt,
    feintAt,
    // How many floats the telegraph step drew (a duel def only): counted by replaying the stream.
    rngDraws: rngBefore === null ? null : drawsBetween(rngBefore, sim.world.rng),
    center: windowOpenAt + responseWindow.windowMs / 2,
    window: responseWindow,
  };
}

function runUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const results = (events: readonly SimEvent[]) =>
  events.filter((event) => event.type === 'ResponseResolved');
const gags = (events: readonly SimEvent[]) =>
  events.filter((event) => event.type === 'GagTriggered');

describe('the threat catalogue', () => {
  it('is not empty', () => {
    expect(defs.length).toBeGreaterThan(0);
  });

  it('only names gags the sim knows', () => {
    for (const def of defs) {
      for (const gag of ThreatGagIds(def)) expect(GAG_IDS as readonly string[]).toContain(gag);
    }
  });

  it.each(liveDefs.map((def) => [def.id, def.target] as const))(
    '"%s" is planned by a live level',
    (id, target) => {
      const planned =
        target === 'papa'
          ? spawnedOnPapa.has(id)
          : target === 'baby'
            ? stealthDefs.has(id)
            : target === 'station'
              ? stationDefs.has(id)
              : anchors.has(id);
      expect(planned, `"${id}" is planned by no level`).toBe(true);
    },
  );

  it('keeps the fixture anchor free of live defs, and fixtures out of the live folder', () => {
    for (const fixtureAnchor of Object.values(FIXTURE_ANCHORS)) {
      expect([...anchors.values()]).not.toContain(fixtureAnchor);
    }
    expect(new Set(Object.values(FIXTURE_ANCHORS)).size).toBe(fixtureDefs.length);
    for (const def of fixtureDefs) {
      expect(liveDefs.map((live) => live.id)).not.toContain(def.id);
      expect(def.target).toBe('anchor');
    }
  });

  it('proves every response: the live defs and the fixtures between them cover parry, firm, wait and nothing', () => {
    expect(new Set(defs.map((def) => def.response))).toEqual(
      new Set(['parry', 'firm', 'wait', 'nothing']),
    );
  });

  it('draws one float more at the telegraph of a def with a feint than of a wait with none (story 4.7)', async () => {
    // The step that starts a sequence draws something of its own too (the same for every def), so the
    // proof is the difference: the feint's draw, after the signal's, and nothing else.
    const waits = defs.filter((def) => def.response === 'wait' && duelDefs.has(def.id));
    const withFeint = waits.filter((def) => def.feint !== undefined);
    const withoutFeint = waits.filter((def) => def.feint === undefined);
    expect(withFeint.length).toBeGreaterThan(0);
    expect(withoutFeint.length).toBeGreaterThan(0);
    for (const tier of DIFFICULTY_TIER_IDS) {
      const base = (await telegraphed(withoutFeint[0] as ThreatDef, tier)).rngDraws;
      expect(base).not.toBeNull();
      for (const def of withoutFeint) {
        expect((await telegraphed(def, tier)).rngDraws, def.id).toBe(base);
      }
      for (const def of withFeint) {
        expect((await telegraphed(def, tier)).rngDraws, def.id).toBe((base as number) + 1);
      }
    }
  });

  it('proves the wait on an anchored def, beside the one a sequence spawns on Papa', () => {
    const waits = defs.filter((def) => def.response === 'wait');
    expect(waits.some((def) => def.target === 'anchor')).toBe(true);
    expect(waits.some((def) => duelDefs.has(def.id))).toBe(true);
  });
});

describe.each(
  DIFFICULTY_TIER_IDS.flatMap((tier) =>
    // A `nothing` is sat through, not answered: its set is the one below (story 4.9).
    defs.filter((def) => def.response !== 'nothing').map((def) => [def.id, tier, def] as const),
  ),
)('threat %s at the %s tier', (_id, tier, def) => {
  // A Firmness judged on its release (story 4.8) is pressed early and judged on the release: its own set below.
  const release = def.release;

  it('is perfect when answered at the centre of the window', async () => {
    const { sim, center, openAt, threatId } = await telegraphed(def, tier);
    const { settledAt } = answer(sim, def, threatId, center, openAt);
    const events = runUntil(sim, settledAt);
    expect(results(events)).toEqual([
      expect.objectContaining({ response: def.response, quality: 'perfect', offsetMs: 0 }),
    ]);
    expect(gags(events)).toEqual([]);
  });

  it('is a success when answered as the window opens, tolerance included', async () => {
    const { sim, center, openAt, window, threatId } = await telegraphed(def, tier);
    // A wait has no tolerance before its signal (story 4.6, D2): it opens at the signal, to the ms.
    const t = def.response === 'wait' ? openAt : openAt - window.toleranceMs;
    const { settledAt } = answer(sim, def, threatId, t, openAt);
    const events = runUntil(sim, Math.max(settledAt, center + holdMinMs));
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'success', offsetMs: t - center }),
    ]);
    expect(gags(events)).toEqual([]);
  });

  it.skipIf(release !== undefined)('is a gag when answered too early', async () => {
    const { sim, center, openAt, window, threatId } = await telegraphed(def, tier);
    const t = openAt - window.toleranceMs - window.bufferMs - 1;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId });
    const events = runUntil(sim, openAt);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'early', offsetMs: t - center }),
    ]);
    expect(gags(events)).toEqual([expect.objectContaining({ reason: 'early', threatId })]);
    expect(ThreatGagIds(def)).toContain((gags(events)[0] as { gag: string }).gag);
  });

  it('is a gag when not answered in time', async () => {
    const { sim, enteredAt, openAt, window, threatId } = await telegraphed(def, tier);
    // A release def is not answered at all within `pressWithinMs` of the telegraph, long before its pose.
    const horizonMs =
      release === undefined
        ? openAt + window.windowMs + window.toleranceMs + 100
        : enteredAt + release.pressWithinMs + window.toleranceMs + 100;
    const events = runUntil(sim, horizonMs);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
    expect(gags(events)).toEqual([expect.objectContaining({ reason: 'late', threatId })]);
    expect(ThreatGagIds(def)).toContain((gags(events)[0] as { gag: string }).gag);
  });

  if (def.response === 'firm' && release === undefined) {
    it('is a wrongResponse gag when released before holdMinMs (a Parry)', async () => {
      const { sim, center, threatId } = await telegraphed(def, tier);
      sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId });
      sim.enqueue({ type: 'Release', t: asSimMs(center + holdMinMs - 1) });
      const events = runUntil(sim, center + holdMinMs + STEP_MS);
      expect(results(events)).toEqual([
        expect.objectContaining({ quality: 'fail', reason: 'wrongResponse', offsetMs: 0 }),
      ]);
      expect(gags(events)).toEqual([
        expect.objectContaining({ reason: 'wrongResponse', threatId }),
      ]);
      expect(events.filter((event) => event.type === 'ResponseHeld')).toEqual([]);
    });

    it('is a "released" gag when released between holdMinMs and the end of the attack', async () => {
      const { sim, center, openAt, threatId } = await telegraphed(def, tier);
      const releaseAt = center + holdMinMs;
      expect(releaseAt).toBeLessThan(openAt + (def.holdUntilMs ?? 0));
      sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId });
      sim.enqueue({ type: 'Release', t: asSimMs(releaseAt) });
      const events = runUntil(sim, releaseAt + STEP_MS);
      expect(results(events)).toEqual([
        expect.objectContaining({ quality: 'fail', reason: 'released', offsetMs: 0 }),
      ]);
      expect(gags(events)).toEqual([expect.objectContaining({ reason: 'released', threatId })]);
      expect(ThreatGagIds(def)).toContain((gags(events)[0] as { gag: string }).gag);
    });
  }

  if (release !== undefined) {
    const { pressWithinMs } = release;
    const pressedAt = (enteredAt: number) => enteredAt + STEP_MS;

    it('has no hold to the end of the attack: the release is what is judged', () => {
      expect(def.holdUntilMs).toBeUndefined();
      expect(def.feedback.signal).toBeDefined();
    });

    it('is a "released" gag when released a ms before the tolerance of the pose, and a tap is one too', async () => {
      for (const tooEarly of ['beforeTolerance', 'quickTap'] as const) {
        const { sim, center, enteredAt, openAt, window, threatId } = await telegraphed(def, tier);
        const releaseAt =
          tooEarly === 'beforeTolerance'
            ? openAt - window.toleranceMs - 1
            : pressedAt(enteredAt) + holdMinMs / 2;
        sim.enqueue({ type: 'PressThreat', t: asSimMs(pressedAt(enteredAt)), threatId });
        sim.enqueue({ type: 'Release', t: asSimMs(releaseAt) });
        const events = runUntil(sim, releaseAt + 2 * STEP_MS);
        expect(results(events), tooEarly).toEqual([
          expect.objectContaining({
            quality: 'fail',
            reason: 'released',
            offsetMs: releaseAt - center,
          }),
        ]);
        expect(gags(events)).toEqual([expect.objectContaining({ reason: 'released', threatId })]);
        expect(ThreatGagIds(def)).toContain((gags(events)[0] as { gag: string }).gag);
      }
    });

    it('is a "late" gag when released a ms after the window and its tolerance', async () => {
      const { sim, center, enteredAt, openAt, window, threatId } = await telegraphed(def, tier);
      const releaseAt = openAt + window.windowMs + window.toleranceMs + 1;
      sim.enqueue({ type: 'PressThreat', t: asSimMs(pressedAt(enteredAt)), threatId });
      sim.enqueue({ type: 'Release', t: asSimMs(releaseAt) });
      const events = runUntil(sim, releaseAt + 2 * STEP_MS);
      expect(results(events)).toEqual([
        expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: releaseAt - center }),
      ]);
    });

    it('is a "late" gag, with no offset, when the finger never lets go (the hold is never kept)', async () => {
      const { sim, enteredAt, openAt, window, threatId } = await telegraphed(def, tier);
      sim.enqueue({ type: 'PressThreat', t: asSimMs(pressedAt(enteredAt)), threatId });
      const events = runUntil(sim, openAt + window.windowMs + window.toleranceMs + 100);
      expect(results(events)).toEqual([
        expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
      ]);
      expect(events.filter((event) => event.type === 'ResponseHeld')).toHaveLength(1);
    });

    it('is a "late" gag for a press a ms past pressWithinMs plus the tolerance, and kept at the limit', async () => {
      const limit = await telegraphed(def, tier);
      const atLimit = limit.enteredAt + pressWithinMs + limit.window.toleranceMs;
      limit.sim.enqueue({ type: 'PressThreat', t: asSimMs(atLimit), threatId: limit.threatId });
      limit.sim.enqueue({ type: 'Release', t: asSimMs(limit.center) });
      expect(results(runUntil(limit.sim, limit.center + 2 * STEP_MS))).toEqual([
        expect.objectContaining({ quality: 'perfect', offsetMs: 0 }),
      ]);
      const past = await telegraphed(def, tier);
      past.sim.enqueue({
        type: 'PressThreat',
        t: asSimMs(atLimit + 1),
        threatId: past.threatId,
      });
      const events = runUntil(past.sim, atLimit + 2 * STEP_MS);
      expect(results(events)).toEqual([
        expect.objectContaining({ quality: 'fail', reason: 'late' }),
      ]);
    });

    it.each(['fail', 'guard'] as const)(
      'is judged the same whatever earlyPress says (%s)',
      async (earlyPress) => {
        const { sim, center, enteredAt, openAt, window, threatId } = await telegraphed(
          def,
          tier,
          earlyPress,
        );
        const releaseAt = openAt - window.toleranceMs - 1;
        sim.enqueue({ type: 'PressThreat', t: asSimMs(pressedAt(enteredAt)), threatId });
        sim.enqueue({ type: 'Release', t: asSimMs(releaseAt) });
        const events = runUntil(sim, releaseAt + 2 * STEP_MS);
        expect(results(events)).toEqual([
          expect.objectContaining({ reason: 'released', offsetMs: releaseAt - center }),
        ]);
      },
    );

    it('gives its signal once, right before the window opens, at the same time', async () => {
      const { sim, enteredAt, openAt, threatId } = await telegraphed(def, tier);
      sim.enqueue({ type: 'PressThreat', t: asSimMs(pressedAt(enteredAt)), threatId });
      const events = runUntil(sim, openAt + STEP_MS);
      const names = events
        .filter((event) => event.type === 'WaitSignalGiven' || event.type === 'WindowOpened')
        .map((event) => event.type);
      expect(names).toEqual(['WaitSignalGiven', 'WindowOpened']);
    });
  }

  if (def.response === 'wait') {
    it('gives its signal once, right before the window opens, at the same time', async () => {
      const { sim, openAt } = await telegraphed(def, tier);
      const events = runUntil(sim, openAt + STEP_MS);
      const names = events
        .filter((event) => event.type === 'WaitSignalGiven' || event.type === 'WindowOpened')
        .map((event) => event.type);
      expect(names).toEqual(['WaitSignalGiven', 'WindowOpened']);
      const signal = events.filter((event) => event.type === 'WaitSignalGiven');
      // The step that reaches `windowOpenAt`: the sim steps on a 10 ms grid, the signal's instant does not.
      expect(signal[0]?.t).toBe(Math.ceil(openAt / STEP_MS) * STEP_MS);
    });

    it.each(['fail', 'guard'] as const)(
      'gags a press one ms before the signal, and one before the buffer, whatever earlyPress says (%s)',
      async (earlyPress) => {
        for (const beforeMs of ['oneMs', 'beyondBuffer'] as const) {
          const { sim, center, openAt, window, threatId } = await telegraphed(
            def,
            tier,
            earlyPress,
          );
          const t =
            beforeMs === 'oneMs' ? openAt - 1 : openAt - window.toleranceMs - window.bufferMs - 1;
          sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId });
          const events = runUntil(sim, openAt + STEP_MS);
          expect(results(events)).toEqual([
            expect.objectContaining({ quality: 'fail', reason: 'early', offsetMs: t - center }),
          ]);
          expect(gags(events)).toEqual([expect.objectContaining({ reason: 'early', threatId })]);
        }
      },
    );
  }

  // The feint of a fake sleep (story 4.7): a def that has one is proved on its live numbers, at every tier.
  if (def.feint !== undefined) {
    const { minGapMs } = def.feint;

    it('gives its feint once, before its signal, at the first step at or after feintAt, with the gap the def asks', async () => {
      const { sim, openAt, feintAt } = await telegraphed(def, tier);
      expect(feintAt).not.toBeNull();
      const events = runUntil(sim, openAt + STEP_MS);
      const names = events
        .filter((event) => event.type === 'WaitFeintGiven' || event.type === 'WaitSignalGiven')
        .map((event) => event.type);
      expect(names).toEqual(['WaitFeintGiven', 'WaitSignalGiven']);
      const given = events.filter((event) => event.type === 'WaitFeintGiven');
      expect(given[0]?.t).toBe(Math.ceil((feintAt as number) / STEP_MS) * STEP_MS);
      const signal = events.filter((event) => event.type === 'WaitSignalGiven');
      expect((signal[0]?.t ?? 0) - (given[0]?.t ?? 0)).toBeGreaterThanOrEqual(minGapMs - STEP_MS);
    });

    it.each(['fail', 'guard'] as const)(
      'gags a press on the feint as an early gag whatever earlyPress says (%s)',
      async (earlyPress) => {
        const { sim, center, feintAt, threatId } = await telegraphed(def, tier, earlyPress);
        const t = feintAt as number;
        sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId });
        const events = runUntil(sim, t + 2 * STEP_MS);
        expect(results(events)).toEqual([
          expect.objectContaining({ quality: 'fail', reason: 'early', offsetMs: t - center }),
        ]);
        expect(gags(events)).toEqual([expect.objectContaining({ reason: 'early', threatId })]);
        expect(ThreatGagIds(def)).toContain((gags(events)[0] as { gag: string }).gag);
      },
    );

    it('is a success for a press in the window after the feint, as with no feint', async () => {
      const { sim, center, openAt, threatId } = await telegraphed(def, tier);
      const { settledAt } = answer(sim, def, threatId, openAt, openAt);
      const events = runUntil(sim, Math.max(settledAt, center + holdMinMs));
      expect(events.filter((event) => event.type === 'WaitFeintGiven')).toHaveLength(1);
      expect(results(events)).toEqual([
        expect.objectContaining({ quality: 'success', offsetMs: openAt - center }),
      ]);
      expect(gags(events)).toEqual([]);
    });
  }

  if (def.response === 'parry' || def.response === 'wait') {
    it('is a wrongResponse gag when held holdMinMs, the ring having closed first', async () => {
      const { sim, center, threatId } = await telegraphed(def, tier);
      sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId });
      const events = runUntil(sim, center + holdMinMs + 2 * STEP_MS);
      const tail = events.filter(
        (event) => event.type === 'ResponseHeld' || event.type === 'ResponseResolved',
      );
      // The ring closes at the first step at or after the hold: a tier's window can put its centre
      // between two steps (story 2.8: 450 / 2 = 225 from an opening on the grid, plus 10).
      const closedAt = Math.ceil((center + holdMinMs) / STEP_MS) * STEP_MS;
      expect(tail).toEqual([
        { type: 'ResponseHeld', t: closedAt, threatId },
        expect.objectContaining({
          type: 'ResponseResolved',
          quality: 'fail',
          reason: 'wrongResponse',
          t: closedAt,
        }),
      ]);
      expect(gags(events)).toEqual([
        expect.objectContaining({ reason: 'wrongResponse', threatId }),
      ]);
    });
  }
});

describe.each(
  DIFFICULTY_TIER_IDS.flatMap((tier) =>
    defs.filter((def) => def.response === 'nothing').map((def) => [def.id, tier, def] as const),
  ),
)('nothing threat %s at the %s tier (story 4.9)', (_id, tier, def) => {
  const nothingMs = def.nothingMs ?? Number.NaN;

  it('proves the generic set does not run on it: it is a nothing, with a length of its own', () => {
    expect(def.response).toBe('nothing');
    expect(def.windowMs).toBeNull();
    expect(nothingMs).toBeGreaterThan(0);
  });

  it.each([0, 200])(
    'is a success at windowOpenAt + nothingMs exactly (the length does not scale), with lagMs %i',
    async (lagMs) => {
      const { sim, openAt, window, threatId } = await telegraphed(def, tier, 'fail', lagMs);
      expect(window).toEqual({ windowMs: nothingMs, perfectMs: 0, toleranceMs: 0, bufferMs: 0 });
      const endAt = openAt + nothingMs;
      const before = runUntil(sim, endAt + lagMs - STEP_MS);
      expect(results(before)).toEqual([]);
      const events = runUntil(sim, endAt + lagMs + STEP_MS);
      expect(results(events)).toEqual([
        expect.objectContaining({
          response: 'nothing',
          quality: 'success',
          offsetMs: 0,
          t: endAt + lagMs,
          threatId,
        }),
      ]);
      expect(gags(events)).toEqual([]);
    },
  );

  it('is never perfect, and asks for no hitstop', async () => {
    const { sim, openAt } = await telegraphed(def, tier);
    const events = runUntil(sim, openAt + nothingMs + STEP_MS);
    expect(results(events).map((event) => (event as { quality: string }).quality)).toEqual([
      'success',
    ]);
    expect(sim.freezeRealMs).toBe(0);
  });

  it.each(['fail', 'guard'] as const)(
    'is an acted gag for a press at the telegraph, at the opening and one step before the end, with earlyPress %s',
    async (earlyPress) => {
      const instants = {
        telegraph: (enteredAt: number) => enteredAt + STEP_MS,
        opening: (_enteredAt: number, openAt: number) => openAt,
        lastStep: (_enteredAt: number, openAt: number) => openAt + nothingMs - STEP_MS,
      };
      for (const [name, instant] of Object.entries(instants)) {
        const { sim, enteredAt, openAt, threatId } = await telegraphed(def, tier, earlyPress);
        const t = instant(enteredAt, openAt);
        sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId });
        const events = runUntil(sim, openAt + nothingMs + STEP_MS);
        expect(results(events), name).toEqual([
          expect.objectContaining({ quality: 'fail', reason: 'acted', offsetMs: null }),
        ]);
        expect(gags(events), name).toEqual([
          expect.objectContaining({ reason: 'acted', threatId }),
        ]);
        expect(ThreatGagIds(def)).toContain((gags(events)[0] as { gag: string }).gag);
      }
    },
  );

  it('is an acted gag for a TapBaby too, at the telegraph, at the opening and one step before the end', async () => {
    for (const earlyPress of ['fail', 'guard'] as const) {
      for (const name of ['telegraph', 'opening', 'lastStep'] as const) {
        const { sim, enteredAt, openAt, threatId } = await telegraphed(def, tier, earlyPress);
        const t =
          name === 'telegraph'
            ? enteredAt + STEP_MS
            : name === 'opening'
              ? openAt
              : openAt + nothingMs - STEP_MS;
        sim.enqueue({ type: 'TapBaby', t: asSimMs(t) });
        const events = runUntil(sim, openAt + nothingMs + STEP_MS);
        expect(gags(events), `${earlyPress} ${name}`).toEqual([
          expect.objectContaining({ reason: 'acted', threatId }),
        ]);
      }
    }
  });

  it('ignores a press stamped at the end or after it: nothing, and the verdict is the success', async () => {
    const { sim, openAt, threatId } = await telegraphed(def, tier, 'fail', 200);
    sim.enqueue({ type: 'PressThreat', t: asSimMs(openAt + nothingMs), threatId });
    sim.enqueue({ type: 'PressThreat', t: asSimMs(openAt + nothingMs + STEP_MS), threatId });
    const events = runUntil(sim, openAt + nothingMs + 200 + 3 * STEP_MS);
    expect(gags(events)).toEqual([]);
    expect(results(events)).toEqual([expect.objectContaining({ quality: 'success' })]);
  });
});
