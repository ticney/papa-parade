import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { LevelContent } from '@content/contentBundle';
import { parseContentFile } from '@content/parseContentFile';
import { type ThreatDef, ThreatDefSchema } from '@content/schemas/threat';
import { asSimMs } from '@shared/time';
import { createSim, GAG_IDS, type Sim, type SimEvent } from '@sim';
import { describe, expect, it } from 'vitest';
import { createTestContent, createTestGeometry } from '../support/testContent.ts';

// One "perfect / success / too early / too late" set per file of content/threats/, generated from
// the JSON: adding a threat adds its four tests, and nothing in this file knows a threat by name.
// The frozen feel and geometry are used, so that retuning feel.json cannot move a result; the
// threat is the live file, since this test is there to prove it.

const THREATS_DIR = fileURLToPath(new URL('../../content/threats/', import.meta.url));
const ANCHOR = 'outlet_01';
const THREAT_ID = 1;

const defs: ThreatDef[] = readdirSync(THREATS_DIR)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => {
    const text = readFileSync(`${THREATS_DIR}${name}`, 'utf8');
    const parsed = parseContentFile(`content/threats/${name}`, text, ThreatDefSchema);
    if (!parsed.ok) throw new Error(`${name} is invalid: ${JSON.stringify(parsed.error)}`);
    return parsed.value;
  });

const content = createTestContent();
const geometry = createTestGeometry();
const { holdMinMs } = content.feel.input;

function levelPlanning(def: ThreatDef): LevelContent {
  return {
    level: {
      id: 'salon_crawler',
      threats: [{ def: def.id, anchor: ANCHOR, fromMs: 0 }],
    },
    threats: { [def.id]: def },
  };
}

/** A sim stopped on the step that telegraphed the threat, with the times its window gives. */
async function telegraphed(def: ThreatDef) {
  const sim = await createSim({ content, geometry, level: levelPlanning(def), seed: 1 });
  sim.step();
  const events = [...sim.drainEvents()];
  expect(events.some((event) => event.type === 'ThreatTelegraphed')).toBe(true);
  const threat = sim.world.threats[0];
  if (threat === undefined || threat.responseWindow === null) throw new Error('not telegraphed');
  const { windowOpenAt, responseWindow } = threat;
  return {
    sim,
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
});

describe.each(defs.map((def) => [def.id, def] as const))('threat %s', (_id, def) => {
  it('is perfect when answered at the centre of the window', async () => {
    const { sim, center } = await telegraphed(def);
    sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: THREAT_ID });
    sim.enqueue({ type: 'Release', t: asSimMs(center + holdMinMs / 2) });
    const events = runUntil(sim, center + holdMinMs);
    expect(results(events)).toEqual([
      expect.objectContaining({ response: def.response, quality: 'perfect', offsetMs: 0 }),
    ]);
    expect(gags(events)).toEqual([]);
  });

  it('is a success when answered as the window opens, tolerance included', async () => {
    const { sim, center, openAt, window } = await telegraphed(def);
    const t = openAt - window.toleranceMs;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: THREAT_ID });
    sim.enqueue({ type: 'Release', t: asSimMs(t + holdMinMs / 2) });
    const events = runUntil(sim, center + holdMinMs);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'success', offsetMs: t - center }),
    ]);
    expect(gags(events)).toEqual([]);
  });

  it('is a gag when answered too early', async () => {
    const { sim, center, openAt, window } = await telegraphed(def);
    const t = openAt - window.toleranceMs - window.bufferMs - 1;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: THREAT_ID });
    const events = runUntil(sim, openAt);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'early', offsetMs: t - center }),
    ]);
    expect(gags(events)).toEqual([
      expect.objectContaining({ gag: def.gag, reason: 'early', threatId: THREAT_ID }),
    ]);
  });

  it('is a gag when not answered in time', async () => {
    const { sim, openAt, window } = await telegraphed(def);
    const events = runUntil(sim, openAt + window.windowMs + window.toleranceMs + 100);
    expect(results(events)).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
    expect(gags(events)).toEqual([
      expect.objectContaining({ gag: def.gag, reason: 'late', threatId: THREAT_ID }),
    ]);
  });
});
