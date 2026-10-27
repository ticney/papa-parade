import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
} from '../../../tests/support/testContent.ts';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { createNavGrid } from '../nav/navGrid.ts';
import type { PapaSlice } from '../world.ts';
import { planWalkTo } from './planWalk.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const { glideMaxMs, walkSpeedMps } = content.feel.movement;
const OUTLET_ID = 1;

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

const press = (t: number): SimCommand => ({
  type: 'PressThreat',
  t: asSimMs(t),
  threatId: OUTLET_ID,
});

async function newSim(options: { geometry?: LevelGeometry } = {}): Promise<Sim> {
  return createSim({
    content,
    geometry: options.geometry ?? geometry,
    level: createTestLevel([outletEntry(0)]),
    seed: 1,
  });
}

function run(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const papaOf = (sim: Sim) => sim.world.papa;
const papaEvents = (events: readonly SimEvent[]) =>
  events.filter(
    (event) =>
      event.type === 'PapaGlideStarted' ||
      event.type === 'PapaArrived' ||
      event.type === 'PapaStateChanged' ||
      event.type === 'PapaPathPlanned',
  );

/** A room where Papa starts `distanceM` from the outlet's wall, on the same row. */
function papaNearOutlet(): LevelGeometry {
  return {
    ...geometry,
    anchors: geometry.anchors.map((anchor) =>
      anchor.id === 'papa_spawn' ? { ...anchor, positionM: [-3.3, 0, 0.5] } : anchor,
    ),
  };
}

/** A sim stopped at the step before a press at `t`, with the outlet telegraphed. */
async function pressedAt(t: number, options: { geometry?: LevelGeometry } = {}) {
  const sim = await newSim(options);
  run(sim, t / STEP_MS - 1);
  sim.enqueue(press(t));
  return sim;
}

describe('the glide to a pressed threat', () => {
  it('starts at the press step: PapaGlideStarted, state glide, a glide in the world', async () => {
    const sim = await pressedAt(500);
    const events = run(sim, 1);
    const started = only(events, 'PapaGlideStarted');
    expect(started).toEqual([
      expect.objectContaining({ t: 500, threatId: OUTLET_ID, arriveAt: expect.any(Number) }),
    ]);
    const glide = papaOf(sim).glide;
    expect(glide).toMatchObject({ threatId: OUTLET_ID, startedAt: 500 });
    expect(glide?.arriveAt).toBe(started[0]?.arriveAt);
    expect([glide?.toXM, glide?.toZM]).toEqual([started[0]?.toXM, started[0]?.toZM]);
    expect(papaOf(sim).state).toBe('glide');
    expect(events.filter((event) => event.type === 'PapaStateChanged')).toEqual([
      { type: 'PapaStateChanged', t: 500, from: 'idle', to: 'glide' },
    ]);
  });

  it('lasts at most glideMaxMs, faster than walking when Papa is far (the spawn, 6.5 m away)', async () => {
    const sim = await pressedAt(500);
    run(sim, 1);
    const glide = papaOf(sim).glide;
    if (glide === null) throw new Error('no glide');
    expect(glide.arriveAt - glide.startedAt).toBe(glideMaxMs);
    expect(glide.speedMps).toBeGreaterThan(walkSpeedMps);
  });

  it('arrives at the first step at or after arriveAt, exactly at the threat’s cell, and goes idle', async () => {
    const sim = await pressedAt(500);
    const events = run(sim, 1);
    const arriveAt = (only(events, 'PapaGlideStarted')[0] as { arriveAt: number }).arriveAt;
    const goal = [papaOf(sim).glide?.toXM, papaOf(sim).glide?.toZM];
    const later = run(sim, 80);
    const arrived = only(later, 'PapaArrived');
    expect(arrived).toHaveLength(1);
    const at = (arrived[0] as { t: number }).t;
    expect(at).toBeGreaterThanOrEqual(arriveAt - STEP_MS);
    expect(at).toBeLessThanOrEqual(arriveAt + STEP_MS);
    expect([arrived[0]?.xM, arrived[0]?.zM]).toEqual(goal);
    expect(papaOf(sim)).toMatchObject({ state: 'idle', glide: null, path: [], pathIndex: 0 });
    expect(papaEvents(later).map((event) => event.type)).toEqual([
      'PapaArrived',
      'PapaStateChanged',
    ]);
  });

  it('glides at walking speed when Papa is next to the outlet', async () => {
    const sim = await pressedAt(500, { geometry: papaNearOutlet() });
    run(sim, 1);
    const glide = papaOf(sim).glide;
    if (glide === null) throw new Error('no glide');
    expect(glide.speedMps).toBeCloseTo(walkSpeedMps, 9);
    expect(glide.arriveAt - glide.startedAt).toBeLessThan(glideMaxMs);
  });

  it('is an instant arrival when Papa already stands at the target', async () => {
    const sim = await pressedAt(500, { geometry: papaNearOutlet() });
    run(sim, 120); // glides to the outlet, then idle
    expect(papaOf(sim).state).toBe('idle');
    sim.enqueue(press(1800));
    const events = run(sim, 60);
    const [started] = only(events, 'PapaGlideStarted');
    expect(started?.arriveAt).toBe(1800);
    expect(only(events, 'PapaArrived')).toHaveLength(1);
    expect(papaOf(sim).state).toBe('idle');
  });

  it('glides on a press whatever the judgement says: an early press that gags too', async () => {
    const sim = await newSim();
    run(sim, 10);
    sim.enqueue(press(300)); // far before the window opens at 1210
    const events = run(sim, 40);
    expect(only(events, 'PapaGlideStarted')).toHaveLength(1);
    expect(only(events, 'GagTriggered')).toHaveLength(1);
  });

  it('is replanned by a new press, from where Papa stands', async () => {
    const sim = await pressedAt(500);
    run(sim, 11); // 610: Papa has moved
    const before = { x: papaOf(sim).xM, z: papaOf(sim).zM };
    sim.enqueue(press(650));
    const events = run(sim, 5);
    const second = only(events, 'PapaGlideStarted');
    expect(second).toHaveLength(1);
    expect(papaOf(sim).glide?.startedAt).toBe(650);
    expect(Math.hypot(papaOf(sim).xM - before.x, papaOf(sim).zM - before.z)).toBeGreaterThan(0);
    expect(papaOf(sim).state).toBe('glide');
  });

  it('does not touch the judgement: the same press is rated the same far from or next to the outlet', async () => {
    const results: unknown[] = [];
    for (const room of [geometry, papaNearOutlet()]) {
      const sim = await newSim({ geometry: room });
      run(sim, 5);
      const { windowOpenAt, responseWindow } = sim.world.threats[0] ?? {};
      const center = (windowOpenAt as number) + (responseWindow?.windowMs as number) / 2;
      sim.enqueue(press(center));
      sim.enqueue({ type: 'Release', t: asSimMs(center + 20) });
      results.push(only(run(sim, 160), 'ResponseResolved'));
    }
    expect(results[0]).toEqual([expect.objectContaining({ quality: 'perfect', offsetMs: 0 })]);
    expect(results[1]).toEqual(results[0]);
  });
});

describe('what cancels a glide', () => {
  it('a TapFloor walks Papa where it says', async () => {
    const sim = await pressedAt(500);
    run(sim, 3);
    expect(papaOf(sim).state).toBe('glide');
    sim.enqueue({ type: 'TapFloor', t: asSimMs(540), xM: 2, zM: 1 });
    const events = run(sim, 2);
    expect(only(events, 'PapaPathPlanned')).toHaveLength(1);
    expect(papaOf(sim)).toMatchObject({ state: 'walkPath', glide: null });
    run(sim, 600);
    expect(only(run(sim, 1), 'PapaArrived')).toEqual([]);
    expect(papaOf(sim).state).toBe('idle');
  });

  it('a Move walks Papa in its direction and drops the glide and its path', async () => {
    const sim = await pressedAt(500);
    run(sim, 3);
    sim.enqueue({ type: 'Move', t: asSimMs(540), dirX: 0, dirZ: 1 });
    run(sim, 2);
    expect(papaOf(sim)).toMatchObject({ state: 'walkDir', glide: null, path: [], pathIndex: 0 });
  });

  it('a MoveStop does not cancel it', async () => {
    const sim = await pressedAt(500);
    run(sim, 3);
    sim.enqueue({ type: 'MoveStop', t: asSimMs(540) });
    run(sim, 2);
    expect(papaOf(sim).state).toBe('glide');
    expect(papaOf(sim).glide).not.toBeNull();
  });

  it('a gag on the threat does not stop him either: the glide plays in parallel', async () => {
    const sim = await newSim();
    run(sim, 10);
    sim.enqueue(press(300));
    const events = run(sim, 22);
    expect(only(events, 'GagTriggered')).toHaveLength(1);
    expect(papaOf(sim).state).toBe('glide');
  });
});

describe('planWalkTo', () => {
  const closedRoom = createNavGrid(
    {
      ...geometry,
      nav: { ...geometry.nav, rows: geometry.nav.rows.map((row) => '0'.repeat(row.length)) },
    },
    0,
  );

  function papaAt(xM: number, zM: number): PapaSlice {
    return { ...createPapaShell(), xM, zM };
  }
  function createPapaShell(): PapaSlice {
    return {
      state: 'idle',
      enteredAt: asSimMs(0),
      xM: 0,
      zM: 0,
      prevXM: 0,
      prevZM: 0,
      headingX: 0,
      headingZ: 1,
      path: [],
      pathIndex: 0,
      dirX: 0,
      dirZ: 0,
      isBlocked: false,
      glide: null,
    };
  }

  it('returns null and leaves Papa’s path alone when the room has no open cell', () => {
    const papa = papaAt(0.5, 0.5);
    papa.path = [1, 1];
    const ctx = { nav: { papa: closedRoom, baby: closedRoom } } as never;
    expect(planWalkTo(papa, ctx, 1, 1)).toBeNull();
    expect(papa.path).toEqual([1, 1]);
  });

  it('puts Papa on the nearest open cell when he stands in a closed one, and plans from there', () => {
    const grid = createTestNavGrid(['1111', '1111']);
    const papa = papaAt(-3, -3);
    const ctx = { nav: { papa: grid, baby: grid } } as never;
    const goal = planWalkTo(papa, ctx, 0.9, 0.4);
    expect(goal).toEqual({ goalXM: 0.9, goalZM: 0.4 });
    expect([papa.xM, papa.zM]).toEqual([0.125, 0.125]);
    expect(papa.path.slice(-2)).toEqual([0.9, 0.4]);
    expect(papa.pathIndex).toBe(0);
  });
});
