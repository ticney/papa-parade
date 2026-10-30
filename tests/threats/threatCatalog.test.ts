import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LevelContent } from '@content/contentBundle';
import { parseContentFile } from '@content/parseContentFile';
import { LevelSchema } from '@content/schemas/level';
import {
  type ThreatDef,
  ThreatDefSchema,
  ThreatGagIds,
  type ThreatResponse,
} from '@content/schemas/threat';
import { DIFFICULTY_TIER_IDS, type DifficultyTierId, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { createSim, GAG_IDS, type Sim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
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
const FIXTURES_DIR = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** An anchor of the frozen room that no live def uses: where the fixture defs are planned. */
const FIXTURE_ANCHOR = 'door';

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
 * a fixture. They are planned at `FIXTURE_ANCHOR`, never by a live level.
 */
const fixtureDefs = readDefs(FIXTURES_DIR, 'tests/threats/fixtures/');
const fixtureIds = new Set(fixtureDefs.map((def) => def.id));
const defs: ThreatDef[] = [...liveDefs, ...fixtureDefs];

/** The anchor of the first entry of a live level that plans each def (`*.geometry.json` are not levels). */
const anchors = new Map<string, string>();
/**
 * The defs a live level spawns on Papa (`gauges.fatigue.microSleepDef`, `carry.armsCryDef`): they
 * have no anchor.
 */
const spawnedOnPapa = new Set<string>();
/** The ones that are a cry in the arms (story 4.1): the baby must be carried for them to come. */
const armsCryDefs = new Set<string>();
for (const name of readdirSync(LEVELS_DIR).sort()) {
  if (!name.endsWith('.json') || name.endsWith('.geometry.json')) continue;
  const text = readFileSync(`${LEVELS_DIR}${name}`, 'utf8');
  const parsed = parseContentFile(`content/levels/${name}`, text, LevelSchema);
  if (!parsed.ok) throw new Error(`${name} is invalid: ${JSON.stringify(parsed.error)}`);
  for (const entry of parsed.value.waves.flatMap((wave) => wave.threats)) {
    if (!anchors.has(entry.def)) anchors.set(entry.def, entry.anchor);
  }
  const microSleepDef = parsed.value.gauges.fatigue?.microSleepDef;
  if (microSleepDef !== undefined) spawnedOnPapa.add(microSleepDef);
  const armsCryDef = parsed.value.carry?.armsCryDef;
  if (armsCryDef !== undefined) {
    spawnedOnPapa.add(armsCryDef);
    armsCryDefs.add(armsCryDef);
  }
}

const content = createTestContent();
const geometry = createTestGeometry();
const { holdMinMs } = content.feel.input;

/** How a right answer is given: when the finger comes up (null: it stays down), and when it is over. */
interface Answer {
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
    case 'parry':
      return { releaseAt: pressT + holdMinMs / 2, settledAt: pressT + holdMinMs };
    case 'firm': {
      if (def.holdUntilMs === undefined) throw new Error(`"${def.id}" is firm with no holdUntilMs`);
      return {
        releaseAt: null,
        settledAt: Math.max(pressT + holdMinMs, openAt + def.holdUntilMs) + STEP_MS,
      };
    }
  }
}

/** Presses `def` at `t` and answers it as it asks. */
function answer(sim: Sim, def: ThreatDef, threatId: number, t: number, openAt: number): Answer {
  const given = answerOf(def, t, openAt);
  sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId });
  if (given.releaseAt !== null) sim.enqueue({ type: 'Release', t: asSimMs(given.releaseAt) });
  return given;
}

/** The anchor `def` is planned at: a fixture's own, else a live level's; a def no level plans fails here, with its name. */
function anchorOf(def: ThreatDef): string {
  if (fixtureIds.has(def.id)) return FIXTURE_ANCHOR;
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
  const anchored = defs.filter((def) => def.target !== 'papa');
  const planned = (def: ThreatDef) => ({ def: def.id, anchor: anchorOf(def) });
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
        feelOverrides: {},
        waves: [],
      },
      threats: Object.fromEntries(defs.map((def) => [def.id, def])),
      disruptions: {},
      sequences: {},
    };
  }
  const wave = { maxSimultaneous: 1, gapMinMs: 0, gapMaxMs: 0, lullMs: 0, disruptions: [] };
  return {
    level: {
      id: 'salon_crawler',
      variant: 'nap' as const,
      durationMs: CATALOG_OTHERS_FROM_MS + CATALOG_OTHERS_FROM_MS,
      objects: [],
      gauges: {},
      sequences: [],
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

/** A sim stopped on the step that telegraphed the threat, with the times its window gives. */
async function telegraphed(def: ThreatDef, tier: DifficultyTierId) {
  const sim = await createSim({
    content: contentFor(def),
    geometry,
    level: levelPlanning(def),
    seed: 1,
  });
  if (tier !== 'normal') sim.enqueue({ type: 'SetDifficultyTier', t: asSimMs(0), tier });
  if (def.target === 'hiddenZone') {
    findTheBaby(sim);
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
  const { windowOpenAt, responseWindow } = threat;
  return {
    sim,
    threatId: threat.id,
    openAt: windowOpenAt,
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
      const planned = target === 'papa' ? spawnedOnPapa.has(id) : anchors.has(id);
      expect(planned, `"${id}" is planned by no level`).toBe(true);
    },
  );

  it('keeps the fixture anchor free of live defs, and fixtures out of the live folder', () => {
    expect([...anchors.values()]).not.toContain(FIXTURE_ANCHOR);
    for (const def of fixtureDefs) {
      expect(liveDefs.map((live) => live.id)).not.toContain(def.id);
      expect(def.target).toBe('anchor');
    }
  });

  it('proves both responses: the live defs and the fixtures between them cover parry and firm', () => {
    expect(new Set(defs.map((def) => def.response))).toEqual(new Set(['parry', 'firm']));
  });
});

describe.each(
  DIFFICULTY_TIER_IDS.flatMap((tier) => defs.map((def) => [def.id, tier, def] as const)),
)('threat %s at the %s tier', (_id, tier, def) => {
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
    const t = openAt - window.toleranceMs;
    const { settledAt } = answer(sim, def, threatId, t, openAt);
    const events = runUntil(sim, Math.max(settledAt, center + holdMinMs));
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'success', offsetMs: t - center }),
    ]);
    expect(gags(events)).toEqual([]);
  });

  it('is a gag when answered too early', async () => {
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
    const { sim, openAt, window, threatId } = await telegraphed(def, tier);
    const events = runUntil(sim, openAt + window.windowMs + window.toleranceMs + 100);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
    expect(gags(events)).toEqual([expect.objectContaining({ reason: 'late', threatId })]);
    expect(ThreatGagIds(def)).toContain((gags(events)[0] as { gag: string }).gag);
  });

  if (def.response === 'firm') {
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

  if (def.response === 'parry') {
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
