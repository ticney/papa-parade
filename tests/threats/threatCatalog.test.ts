import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LevelContent } from '@content/contentBundle';
import { parseContentFile } from '@content/parseContentFile';
import { LevelSchema } from '@content/schemas/level';
import { type ThreatDef, ThreatDefSchema, type ThreatResponse } from '@content/schemas/threat';
import { asSimMs } from '@shared/time';
import { createSim, GAG_IDS, type Sim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';

// One "perfect / success / too early / too late" set per file of content/threats/, generated from
// the JSON: adding a threat adds its four tests, and nothing in this file knows a threat by name.
// Each case plays on the frozen room with EVERY def planned, at the anchor a live level plans it,
// so that the three threats share one level. The frozen feel and geometry are used, so that
// retuning feel.json cannot move a result; the threats and the levels are the live files, since
// this test is there to prove them.

const THREATS_DIR = fileURLToPath(new URL('../../content/threats/', import.meta.url));
const LEVELS_DIR = fileURLToPath(new URL('../../content/levels/', import.meta.url));

/** A release time beyond every case's horizon: the other defs stay idle while one is tested. */
const CATALOG_OTHERS_FROM_MS = 600_000;

const defs: ThreatDef[] = readdirSync(THREATS_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const text = readFileSync(`${THREATS_DIR}${name}`, 'utf8');
    const parsed = parseContentFile(`content/threats/${name}`, text, ThreatDefSchema);
    if (!parsed.ok) throw new Error(`${name} is invalid: ${JSON.stringify(parsed.error)}`);
    return parsed.value;
  });

/** The anchor of the first entry of a live level that plans each def (`*.geometry.json` are not levels). */
const anchors = new Map<string, string>();
/** The defs a live level spawns on Papa (`gauges.fatigue.microSleepDef`): they have no anchor. */
const spawnedOnPapa = new Set<string>();
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
}

const content = createTestContent();
const geometry = createTestGeometry();
const { holdMinMs } = content.feel.input;

/**
 * How long a Parry is held before it is released: half the minimum hold. An exhaustive `switch`: a
 * new response breaks the typecheck until the catalogue knows how to answer it.
 */
function releaseOffsetMs(response: ThreatResponse): number {
  switch (response) {
    case 'parry':
      return holdMinMs / 2;
  }
}

/** The anchor a live level plans `def` at; a def no level plans fails here, with its name. */
function anchorOf(def: ThreatDef): string {
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
  const anchored = defs.filter((def) => def.target === 'anchor');
  const planned = (def: ThreatDef) => ({ def: def.id, anchor: anchorOf(def) });
  if (tested.target === 'papa') {
    return {
      level: {
        id: 'salon_crawler',
        variant: 'nap' as const,
        durationMs: CATALOG_OTHERS_FROM_MS,
        objects: [],
        gauges: { fatigue: { microSleepDef: tested.id } },
        feelOverrides: {},
        waves: [],
      },
      threats: Object.fromEntries(defs.map((def) => [def.id, def])),
    };
  }
  const wave = { maxSimultaneous: 1, gapMinMs: 0, gapMaxMs: 0, lullMs: 0 };
  return {
    level: {
      id: 'salon_crawler',
      variant: 'nap' as const,
      durationMs: CATALOG_OTHERS_FROM_MS + CATALOG_OTHERS_FROM_MS,
      objects: [],
      gauges: {},
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
  };
}

/**
 * The content a def is tested with. A def spawned on Papa is due at the first step: he starts
 * exhausted and the delay between micro-sleeps is nil.
 */
function contentFor(def: ThreatDef) {
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

/** A sim stopped on the step that telegraphed the threat, with the times its window gives. */
async function telegraphed(def: ThreatDef) {
  const sim = await createSim({
    content: contentFor(def),
    geometry,
    level: levelPlanning(def),
    seed: 1,
  });
  sim.step();
  const events = [...sim.drainEvents()];
  expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
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
    for (const def of defs) expect(GAG_IDS as readonly string[]).toContain(def.gag);
  });

  it.each(defs.map((def) => [def.id, def.target] as const))(
    '"%s" is planned by a live level',
    (id, target) => {
      const planned = target === 'papa' ? spawnedOnPapa.has(id) : anchors.has(id);
      expect(planned, `"${id}" is planned by no level`).toBe(true);
    },
  );
});

describe.each(defs.map((def) => [def.id, def] as const))('threat %s', (_id, def) => {
  it('is perfect when answered at the centre of the window', async () => {
    const { sim, center, threatId } = await telegraphed(def);
    sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId });
    sim.enqueue({ type: 'Release', t: asSimMs(center + releaseOffsetMs(def.response)) });
    const events = runUntil(sim, center + holdMinMs);
    expect(results(events)).toEqual([
      expect.objectContaining({ response: def.response, quality: 'perfect', offsetMs: 0 }),
    ]);
    expect(gags(events)).toEqual([]);
  });

  it('is a success when answered as the window opens, tolerance included', async () => {
    const { sim, center, openAt, window, threatId } = await telegraphed(def);
    const t = openAt - window.toleranceMs;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId });
    sim.enqueue({ type: 'Release', t: asSimMs(t + releaseOffsetMs(def.response)) });
    const events = runUntil(sim, center + holdMinMs);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'success', offsetMs: t - center }),
    ]);
    expect(gags(events)).toEqual([]);
  });

  it('is a gag when answered too early', async () => {
    const { sim, center, openAt, window, threatId } = await telegraphed(def);
    const t = openAt - window.toleranceMs - window.bufferMs - 1;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId });
    const events = runUntil(sim, openAt);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'early', offsetMs: t - center }),
    ]);
    expect(gags(events)).toEqual([
      expect.objectContaining({ gag: def.gag, reason: 'early', threatId }),
    ]);
  });

  it('is a gag when not answered in time', async () => {
    const { sim, openAt, window, threatId } = await telegraphed(def);
    const events = runUntil(sim, openAt + window.windowMs + window.toleranceMs + 100);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
    expect(gags(events)).toEqual([
      expect.objectContaining({ gag: def.gag, reason: 'late', threatId }),
    ]);
  });
});
