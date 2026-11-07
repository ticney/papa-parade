import type { ThreatDef } from '@content/schemas/threat';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  SILENCE,
  TEST_OBJECTS,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { lookPartsShown } from './look.ts';

const FAR_MS = 500_000;
const NO_LOOK = { hasMashOnCheek: false, hasHairOnEnd: false, isShirtInsideOut: false };

type Look = Extract<SimEvent, { type: 'PapaLookChanged' }>;
const looksOf = (events: readonly SimEvent[]): Look[] =>
  events.filter((event): event is Look => event.type === 'PapaLookChanged');

interface Options {
  /** The `lookChange` of each frozen def, by id: the frozen fixtures themselves have none. */
  looks?: Readonly<Record<string, ThreatDef['lookChange']>>;
  finalRush?: boolean;
  durationMs?: number;
}

/** The frozen room: no wave ever draws on its own (it starts 8 minutes in), the tests force the threats. */
async function newSim(options: Options = {}): Promise<Sim> {
  const level = createTestLevel({
    waves: [testWave([OUTLET, COFFEE_TABLE, SILENCE], { fromMs: FAR_MS })],
    objects: TEST_OBJECTS,
    ...(options.finalRush === true ? { finalRush: { spillAnchor: 'coffee_table' } } : {}),
    ...(options.durationMs === undefined ? {} : { durationMs: options.durationMs }),
  });
  const threats: Record<string, ThreatDef> = level.threats;
  for (const [id, lookChange] of Object.entries(options.looks ?? {})) {
    const def = threats[id];
    if (def === undefined || lookChange === undefined) throw new Error(`no def ${id}`);
    threats[id] = { ...def, lookChange };
  }
  const content = createTestContent();
  content.feel.endOfLevel.doorSpillCount = 0;
  return createSim({ content, geometry: createTestGeometry(), level, seed: 5 });
}

function runUntil(sim: Sim, test: () => boolean, maxSteps = 3000): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < maxSteps && !test(); i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

/** Forces `defId` and lets nobody answer it: returns the events up to the step it gags. */
function gag(sim: Sim, defId: string): SimEvent[] {
  const threat = sim.world.threats.find((candidate) => candidate.defId === defId);
  if (threat === undefined) throw new Error(`no ${defId}`);
  sim.enqueue({ type: 'ForceThreat', t: asSimMs(sim.world.time.sim), threatId: threat.id });
  const events = runUntil(sim, () => threat.state === 'gag');
  if (threat.state !== 'gag') throw new Error(`${defId} never gagged`);
  return events;
}

/** Runs until the threat is idle again, so that it can be forced a second time. */
function rearm(sim: Sim, defId: string): void {
  const threat = sim.world.threats.find((candidate) => candidate.defId === defId);
  runUntil(sim, () => threat?.state === 'idle');
  if (threat?.state !== 'idle') throw new Error(`${defId} never rearmed`);
}

describe('Papa’s look (story 3.7)', () => {
  it('starts with no part shown', async () => {
    const sim = await newSim();
    expect(sim.world.papa.look).toEqual(NO_LOOK);
    expect(lookPartsShown(sim.world.papa.look)).toBe(0);
  });

  it('shows the part a def names when its gag plays, with one event', async () => {
    const sim = await newSim({ looks: { outlet: 'hairOnEnd' } });
    const threat = sim.world.threats.find((candidate) => candidate.defId === 'outlet');
    const events = gag(sim, 'outlet');
    expect(looksOf(events)).toEqual([
      { type: 'PapaLookChanged', t: sim.world.time.sim, part: 'hairOnEnd', threatId: threat?.id },
    ]);
    expect(sim.world.papa.look).toEqual({ ...NO_LOOK, hasHairOnEnd: true });
    expect(lookPartsShown(sim.world.papa.look)).toBe(1);
  });

  it('does nothing for a gag whose def has no lookChange', async () => {
    const sim = await newSim({ looks: { outlet: 'hairOnEnd' } });
    const events = gag(sim, 'coffee_table_object');
    expect(looksOf(events)).toEqual([]);
    expect(sim.world.papa.look).toEqual(NO_LOOK);
  });

  it('shows a part once: the same part again emits nothing', async () => {
    const sim = await newSim({ looks: { outlet: 'hairOnEnd' } });
    expect(looksOf(gag(sim, 'outlet'))).toHaveLength(1);
    rearm(sim, 'outlet');
    const second = gag(sim, 'outlet');
    expect(looksOf(second)).toEqual([]);
    expect(sim.world.papa.look).toEqual({ ...NO_LOOK, hasHairOnEnd: true });
  });

  it('keeps every part shown: two defs, two parts, and nothing ever clears one', async () => {
    const sim = await newSim({
      looks: { outlet: 'hairOnEnd', coffee_table_object: 'mashOnCheek' },
    });
    gag(sim, 'outlet');
    rearm(sim, 'outlet');
    gag(sim, 'coffee_table_object');
    // The séquelle of the first gag ended long ago: the look stays (it is not an after-effect).
    runUntil(sim, () => false, 600);
    expect(sim.world.papa.look).toEqual({ ...NO_LOOK, hasHairOnEnd: true, hasMashOnCheek: true });
    expect(lookPartsShown(sim.world.papa.look)).toBe(2);
  });

  it('applies on a hidden-zone def too: the def says it, not the gag id', async () => {
    const sim = await newSim({ looks: { silence_mischief: 'shirtInsideOut' } });
    const events = gag(sim, 'silence_mischief');
    expect(looksOf(events).map((event) => event.part)).toEqual(['shirtInsideOut']);
    expect(sim.world.papa.look.isShirtInsideOut).toBe(true);
  });

  it('applies in the final rush', async () => {
    const sim = await newSim({
      looks: { outlet: 'hairOnEnd' },
      finalRush: true,
      durationMs: 30_000,
    });
    runUntil(sim, () => sim.world.flow.state === 'finalRush');
    expect(sim.world.flow.state).toBe('finalRush');
    const events = gag(sim, 'outlet');
    expect(looksOf(events).map((event) => event.part)).toEqual(['hairOnEnd']);
    expect(sim.world.papa.look.hasHairOnEnd).toBe(true);
  });

  it('draws nothing from world.rng: the look does not move the PRNG', async () => {
    const plain = await newSim();
    const looked = await newSim({ looks: { outlet: 'hairOnEnd' } });
    gag(plain, 'outlet');
    gag(looked, 'outlet');
    expect(looked.world.rng).toEqual(plain.world.rng);
  });

  it('round-trips through a snapshot, and restore refuses a damaged look', async () => {
    const sim = await newSim({ looks: { outlet: 'hairOnEnd' } });
    gag(sim, 'outlet');
    const snapshot = JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;
    const target = await newSim({ looks: { outlet: 'hairOnEnd' } });
    target.restore(snapshot);
    expect(target.world.papa.look).toEqual({ ...NO_LOOK, hasHairOnEnd: true });
    expect(hashJson(target.world)).toBe(hashJson(sim.world));
    const damaged = (look: unknown) => {
      const copy = JSON.parse(JSON.stringify(snapshot)) as ReturnType<Sim['snapshot']>;
      (copy.world.papa as { look: unknown }).look = look;
      return copy;
    };
    for (const look of [
      undefined,
      null,
      'hairOnEnd',
      { hasMashOnCheek: false, hasHairOnEnd: true },
      { ...NO_LOOK, hasHairOnEnd: 1 },
      { ...NO_LOOK, extra: true },
    ]) {
      expect(() => target.restore(damaged(look)), JSON.stringify(look)).toThrow(
        /world\.papa\.look/,
      );
    }
  });
});
