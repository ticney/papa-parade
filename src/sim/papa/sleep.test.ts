import type { ContentBundle } from '@content/contentBundle';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  TEST_OBJECTS,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { isPapaBusy, PAPA_STATES, PAPA_STATES_ARE_COMPLETE } from './papaFsm.ts';

const base = createTestContent();
const geometry = createTestGeometry();
const { asleepMs } = base.feel.fatigue;

/** Papa is exhausted and the micro-sleep is due at once. */
const content: ContentBundle = {
  ...base,
  feel: {
    ...base.feel,
    fatigue: { ...base.feel.fatigue, startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 },
  },
};

async function newSim(waves: ReturnType<typeof testWave>[] = []): Promise<Sim> {
  return createSim({
    content,
    geometry,
    level: createTestLevel({ waves, objects: TEST_OBJECTS, gauges: FATIGUE_GAUGES }),
    seed: 1,
  });
}

function runUntil(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const types = (events: readonly SimEvent[]) => events.map((event) => event.type);

/** Runs until Papa falls asleep and returns the instant. */
function runToSleep(sim: Sim): { events: SimEvent[]; fellAt: number } {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < 10_000) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
    if (sim.world.papa.state === 'asleep') return { events, fellAt: sim.world.time.sim };
  }
  throw new Error('Papa never fell asleep');
}

describe('Papa states (story 1.19)', () => {
  it('lists every state, and is proved complete at compile time', () => {
    expect([...PAPA_STATES]).toEqual(['idle', 'walkPath', 'walkDir', 'glide', 'drink', 'asleep']);
    expect(PAPA_STATES_ARE_COMPLETE).toBe(true);
  });

  it('is busy exactly when drinking or asleep', () => {
    for (const state of PAPA_STATES) {
      expect(isPapaBusy({ state }), state).toBe(state === 'drink' || state === 'asleep');
    }
  });
});

describe('a missed micro-sleep', () => {
  it('puts Papa to sleep for asleepMs: no movement, no response, then idle again', async () => {
    const sim = await newSim();
    const { fellAt } = runToSleep(sim);
    expect(sim.world.papa.busyUntil).toBe(fellAt + asleepMs);
    const { xM, zM } = sim.world.papa;
    sim.enqueue({ type: 'TapFloor', t: asSimMs(fellAt), xM: 0, zM: 0 });
    sim.enqueue({ type: 'Move', t: asSimMs(fellAt), dirX: 1, dirZ: 0 });
    sim.enqueue({ type: 'TapObject', t: asSimMs(fellAt), objectId: 'coffee_machine' });
    const during = runUntil(sim, fellAt + asleepMs - 10);
    expect(types(during)).not.toContain('PapaPathPlanned');
    expect(types(during)).not.toContain('ObjectTapped');
    expect(sim.world.papa).toMatchObject({ state: 'asleep', xM, zM });
    const after = runUntil(sim, fellAt + asleepMs + 20);
    expect(after).toContainEqual(
      expect.objectContaining({ type: 'PapaStateChanged', from: 'asleep', to: 'idle' }),
    );
    expect(sim.world.papa).toMatchObject({ state: 'idle', busyUntil: 0, xM, zM });
  });

  it('drops the walk he was on, and a path to an object', async () => {
    const sim = await newSim();
    sim.enqueue({ type: 'TapObject', t: asSimMs(0), objectId: 'coffee_machine' });
    runToSleep(sim);
    expect(sim.world.papa).toMatchObject({ path: [], pathIndex: 0, objectId: null, glide: null });
  });

  it('is no near miss, and ignores a press on another threat meanwhile', async () => {
    const sim = await newSim([testWave([OUTLET], { gapMinMs: 2000, gapMaxMs: 2000 })]);
    const { events } = runToSleep(sim);
    expect(types(events)).not.toContain('NearMiss');
    expect(events).toContainEqual(
      expect.objectContaining({ type: 'GagTriggered', gag: 'papa_asleep' }),
    );
    const open = sim.world.threats.find((threat) => threat.defId === 'outlet');
    if (open === undefined) throw new Error('no outlet');
    // Still asleep while the outlet is up (telegraphed at 2 s, open at 3.2 s).
    while (open.state !== 'windowOpen') runUntil(sim, sim.world.time.sim + 10);
    const center = open.windowOpenAt + (open.responseWindow?.windowMs ?? 0) / 2;
    expect(sim.world.papa.state).toBe('asleep');
    sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: open.id });
    sim.enqueue({ type: 'Release', t: asSimMs(center + 50) });
    const late = runUntil(sim, center + 800);
    expect(late).toContainEqual(
      expect.objectContaining({ type: 'ResponseResolved', quality: 'fail', reason: 'late' }),
    );
  });
});
