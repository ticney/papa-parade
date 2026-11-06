import { MS_PER_S } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  TEST_COOKING,
  TEST_OBJECTS,
  TEST_STOVE,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

// The glide to a chore's station (story 9.4, D5): one route planner and one duration rule with the threats'
// glide, `threatId: null`, `objectId` set, and the usual ways of cancelling a walk.

const content = createTestContent();
const { glideMaxMs, walkSpeedMps } = content.feel.movement;

async function newSim(): Promise<Sim> {
  return createSim({
    content,
    geometry: createTestGeometry(),
    level: createTestLevel({
      waves: [testWave([OUTLET], { fromMs: 500_000 })],
      objects: [...TEST_OBJECTS, TEST_STOVE],
      chores: [TEST_COOKING],
    }),
    seed: 2,
  });
}

function stepEvents(sim: Sim, n: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < n; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

const tap = (sim: Sim, objectId: string) =>
  sim.enqueue({ type: 'TapObject', objectId, t: asSimMs(sim.world.time.sim) });

describe('the glide to a station', () => {
  it('goes by the threats’ duration rule: min(glideMaxMs, length / walkSpeedMps), at least walking pace', async () => {
    const sim = await newSim();
    tap(sim, 'stove');
    const events: SimEvent[] = [];
    while (sim.world.papa.state !== 'glide') events.push(...stepEvents(sim, 1));
    const started = events.find((event) => event.type === 'PapaGlideStarted');
    if (started?.type !== 'PapaGlideStarted') throw new Error('no glide started');
    expect(started.threatId).toBeNull();
    const { papa } = sim.world;
    const glide = papa.glide;
    expect(glide).toMatchObject({ threatId: null, toXM: started.toXM, toZM: started.toZM });
    const durationMs = (glide?.arriveAt ?? 0) - (glide?.startedAt ?? 0);
    // The route Papa is about to glide along, from where he stands to the station.
    let lengthM = 0;
    let [fromX, fromZ] = [papa.xM, papa.zM];
    for (let i = 0; i < papa.path.length; i += 2) {
      const [toX, toZ] = [papa.path[i] as number, papa.path[i + 1] as number];
      lengthM += Math.hypot(toX - fromX, toZ - fromZ);
      [fromX, fromZ] = [toX, toZ];
    }
    expect(lengthM).toBeGreaterThan(0);
    // The threats' rule: as long as walking the route takes, but never longer than `glideMaxMs`.
    expect(durationMs).toBeCloseTo(Math.min(glideMaxMs, (lengthM / walkSpeedMps) * MS_PER_S), -1);
    // Never slower than he walks.
    expect(glide?.speedMps).toBeGreaterThanOrEqual(walkSpeedMps - 1e-9);
    expect(papa.objectId).toBe('stove');
  });

  it('is cancelled by a tap on the floor: Papa walks there, the object is forgotten, nothing starts', async () => {
    const sim = await newSim();
    tap(sim, 'stove');
    stepEvents(sim, 3);
    sim.enqueue({ type: 'TapFloor', xM: 2.5, zM: 1.5, t: asSimMs(sim.world.time.sim) });
    const events = stepEvents(sim, 600);
    expect(sim.world.chores[0]?.state).toBe('untouched');
    expect(events.some((event) => event.type === 'ChoreBeatTelegraphed')).toBe(false);
    expect(sim.world.papa.objectId).toBeNull();
  });

  it('is replanned by a second tap on the station, and arrives once', async () => {
    const sim = await newSim();
    tap(sim, 'stove');
    stepEvents(sim, 10);
    tap(sim, 'stove');
    const events = stepEvents(sim, 100);
    expect(events.filter((event) => event.type === 'PapaGlideStarted')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'PapaArrived')).toHaveLength(1);
    expect(events.filter((event) => event.type === 'ChoreBeatTelegraphed')).toHaveLength(1);
    expect(sim.world.papa.state).toBe('chore');
  });

  it('is replaced by a press on a threat: that glide has the threat’s id and no station', async () => {
    const sim = await newSim();
    tap(sim, 'stove');
    stepEvents(sim, 10);
    const threatId = sim.world.threats[0]?.id ?? 0;
    sim.enqueue({ type: 'ForceThreat', threatId, t: asSimMs(sim.world.time.sim) });
    stepEvents(sim, 3);
    const { windowOpenAt, responseWindow } = sim.world.threats[0] ?? {};
    const pressAt = (windowOpenAt ?? 0) + (responseWindow?.windowMs ?? 0) / 2;
    sim.enqueue({ type: 'PressThreat', threatId, t: asSimMs(pressAt) });
    sim.enqueue({ type: 'Release', t: asSimMs(pressAt + 20) });
    // The press is applied; Papa glides to the threat (the glide lasts well over one step).
    while (sim.world.papa.glide?.threatId !== threatId && sim.world.time.sim < pressAt + 200) {
      stepEvents(sim, 1);
    }
    expect(sim.world.papa.glide?.threatId).toBe(threatId);
    expect(sim.world.papa.objectId).toBeNull();
    stepEvents(sim, 100);
    expect(sim.world.chores[0]?.state).toBe('paused');
  });
});
