import type { ContentBundle } from '@content/contentBundle';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  outletEntry,
  TEST_OBJECTS,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { createNavGrid } from '../nav/navGrid.ts';

const content = createTestContent();
const geometry = createTestGeometry();
const WALK_SPEED_MPS = content.feel.movement.walkSpeedMps;
const BUDGET_M = (WALK_SPEED_MPS * STEP_MS) / 1000;
const grid = createNavGrid(geometry, content.feel.movement.papaRadiusM);

const tap = (xM: number, zM: number, t = 0): SimCommand => ({
  type: 'TapFloor',
  t: asSimMs(t),
  xM,
  zM,
});
const move = (dirX: number, dirZ: number, t = 0): SimCommand => ({
  type: 'Move',
  t: asSimMs(t),
  dirX,
  dirZ,
});
const tapObject = (objectId: string, t = 0): SimCommand => ({
  type: 'TapObject',
  t: asSimMs(t),
  objectId,
});
const stop = (t = 0): SimCommand => ({ type: 'MoveStop', t: asSimMs(t) });

async function newSim(
  options: { content?: ContentBundle; geometry?: LevelGeometry; seed?: number } = {},
): Promise<Sim> {
  return createSim({
    content: options.content ?? content,
    geometry: options.geometry ?? geometry,
    level: createTestLevel([], TEST_OBJECTS),
    seed: options.seed ?? 1,
  });
}

/**
 * Runs `steps` steps and returns the events they emitted, less the baby's: this file proves Papa
 * on the real system list, where the baby lives its own life (the baby's events are proved by
 * `babySystem.test.ts` and the golden).
 */
function run(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    for (const event of sim.drainEvents()) {
      if (event.type !== 'BabyStateChanged') events.push(event);
    }
  }
  return events;
}

const types = (events: readonly SimEvent[]) => events.map((event) => event.type);
const papaOf = (sim: Sim) => sim.world.papa;
const anchor = (id: string) =>
  (geometry.anchors.find((a) => a.id === id) as { positionM: [number, number, number] }).positionM;

describe('spawn', () => {
  it('starts idle at the papa_spawn anchor, facing +z', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    expect(papaOf(sim)).toMatchObject({
      state: 'idle',
      xM: x,
      zM: z,
      prevXM: x,
      prevZM: z,
      headingX: 0,
      headingZ: 1,
      path: [],
      isBlocked: false,
    });
  });

  it('moves a spawn that his clearance closes to the nearest open cell', async () => {
    const closed: LevelGeometry = {
      ...geometry,
      anchors: geometry.anchors.map((a) =>
        a.id === 'papa_spawn' ? { ...a, positionM: [-3.9, 0, -2.9] } : a,
      ),
    };
    const sim = await newSim({ geometry: closed });
    const spawnGrid = createNavGrid(closed, content.feel.movement.papaRadiusM);
    expect(spawnGrid.isOpenAt(-3.9, -2.9)).toBe(false);
    expect(spawnGrid.isOpenAt(papaOf(sim).xM, papaOf(sim).zM)).toBe(true);
    const cell = spawnGrid.nearestOpenCell(-3.9, -2.9, -1);
    expect([papaOf(sim).xM, papaOf(sim).zM]).toEqual([
      spawnGrid.centerXM(cell),
      spawnGrid.centerZM(cell),
    ]);
  });

  it('is an invariant when Papa has nowhere to stand', async () => {
    const walled: LevelGeometry = {
      ...geometry,
      nav: { ...geometry.nav, rows: geometry.nav.rows.map((row) => '0'.repeat(row.length)) },
    };
    await expect(newSim({ geometry: walled })).rejects.toThrow(/nowhere|no cell/);
  });
});

describe('TapFloor on open floor', () => {
  it('walks straight to the tapped point and stops exactly on it', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    const targetZ = z - 1;
    sim.enqueue(tap(x, targetZ));
    const events = run(sim, 60);
    expect(types(events)).toEqual([
      'PapaPathPlanned',
      'PapaStateChanged',
      'PapaArrived',
      'PapaStateChanged',
    ]);
    expect(events[0]).toMatchObject({ targetXM: x, targetZM: targetZ, waypointCount: 1 });
    expect(events[1]).toMatchObject({ from: 'idle', to: 'walkPath' });
    expect(events[3]).toMatchObject({ from: 'walkPath', to: 'idle' });
    expect(events[2]).toMatchObject({ xM: x, zM: targetZ });
    expect(papaOf(sim)).toMatchObject({ state: 'idle', xM: x, zM: targetZ, path: [] });
    // The command is applied by the first step, which already moves: 1 m takes ceil(1 / budget) steps.
    expect((events[2] as { t: number }).t).toBe(STEP_MS * Math.ceil(1 / BUDGET_M));
    expect(papaOf(sim).headingZ).toBe(-1);
  });

  it('arrives after about path length / speed', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    sim.enqueue(tap(x - 2, z));
    const arrived = run(sim, 100).find((e) => e.type === 'PapaArrived') as { t: number };
    expect(Math.abs(arrived.t - (2 / WALK_SPEED_MPS) * 1000)).toBeLessThanOrEqual(STEP_MS);
  });

  it('plans from where Papa stands, in the middle of a walk', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    sim.enqueue(tap(x - 2, z));
    run(sim, 20);
    const midX = papaOf(sim).xM;
    expect(midX).toBeLessThan(x);
    sim.enqueue(tap(x, z + 1, 200));
    const events = run(sim, 60);
    expect(types(events)).toEqual(['PapaPathPlanned', 'PapaArrived', 'PapaStateChanged']);
    expect(papaOf(sim)).toMatchObject({ xM: x, zM: z + 1, state: 'idle' });
  });

  it('a tap on his own position ends within one step', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    sim.enqueue(tap(x, z));
    const events = run(sim, 2);
    expect(types(events)).toEqual([
      'PapaPathPlanned',
      'PapaStateChanged',
      'PapaArrived',
      'PapaStateChanged',
    ]);
  });
});

describe('TapObject (story 1.17)', () => {
  it('walks to the anchor of the object like a tap there, then says it was tapped', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('coffee_machine');
    sim.enqueue(tapObject('coffee_machine'));
    const events = run(sim, 600);
    // `ObjectTapped` follows the plan and Papa setting off, in the step the command is applied.
    expect(types(events).slice(0, 3)).toEqual([
      'PapaPathPlanned',
      'PapaStateChanged',
      'ObjectTapped',
    ]);
    expect(events[2]).toEqual({
      type: 'ObjectTapped',
      t: (events[0] as { t: number }).t,
      objectId: 'coffee_machine',
    });
    expect(types(events)).toContain('PapaArrived');

    const floor = await newSim();
    floor.enqueue(tap(x, z));
    const floorEvents = run(floor, 600);
    // Same plan, same walk, same arrival as a tap on the anchor.
    expect(events.filter((e) => e.type !== 'ObjectTapped')).toEqual(floorEvents);
    expect(papaOf(sim)).toEqual(papaOf(floor));
  });

  it('does nothing for an object the level does not have', async () => {
    const sim = await newSim();
    const before = hashJson(sim.world.papa);
    sim.enqueue(tapObject('toaster'));
    const events = run(sim, 5);
    expect(types(events)).toEqual([]);
    expect(papaOf(sim).state).toBe('idle');
    expect(hashJson(papaOf(sim))).toBe(before);
  });

  it('does nothing in a level with no objects', async () => {
    const sim = await createSim({ content, geometry, level: createTestLevel(), seed: 1 });
    sim.enqueue(tapObject('coffee_machine'));
    expect(types(run(sim, 5))).toEqual([]);
    expect(papaOf(sim).state).toBe('idle');
  });

  it('takes over a direction walk', async () => {
    const sim = await newSim();
    sim.enqueue(move(-1, 0));
    run(sim, 10);
    sim.enqueue(tapObject('phone', 100));
    const events = run(sim, 20);
    expect(types(events).slice(0, 3)).toEqual([
      'PapaPathPlanned',
      'PapaStateChanged',
      'ObjectTapped',
    ]);
    expect(events.find((e) => e.type === 'PapaStateChanged')).toMatchObject({
      from: 'walkDir',
      to: 'walkPath',
    });
  });

  it('cancels a glide, as a TapFloor does', async () => {
    const content2 = createTestContent();
    const planning = createTestLevel([outletEntry(0)], TEST_OBJECTS);
    const sim = await createSim({ content: content2, geometry, level: planning, seed: 1 });
    // Telegraph the outlet, press it: Papa glides.
    for (let i = 0; i < 400 && sim.world.threats[0]?.state === 'idle'; i++) sim.step();
    sim.enqueue({ type: 'PressThreat', t: sim.world.time.sim, threatId: 1 });
    sim.step();
    expect(papaOf(sim).state).toBe('glide');
    sim.enqueue(tapObject('phone', sim.world.time.sim));
    sim.step();
    expect(papaOf(sim).state).toBe('walkPath');
    expect(papaOf(sim).glide).toBeNull();
    expect(sim.drainEvents().some((e) => e.type === 'ObjectTapped')).toBe(true);
  });
});

describe('TapFloor around furniture', () => {
  it('goes round the sofa to the zone behind it, never through a closed cell', async () => {
    const sim = await newSim();
    const zone = geometry.zones.find((z) => z.id === 'behind_sofa') as {
      centerM: [number, number, number];
    };
    const [targetX, , targetZ] = zone.centerM;
    sim.enqueue(tap(targetX, targetZ));
    let seen = 0;
    let arrived = false;
    for (let i = 0; i < 1200 && !arrived; i++) {
      sim.step();
      const { xM, zM } = papaOf(sim);
      expect(grid.isOpenAt(xM, zM)).toBe(true);
      seen++;
      arrived = sim.drainEvents().some((e) => e.type === 'PapaArrived');
    }
    expect(arrived).toBe(true);
    const [spawnX, , spawnZ] = anchor('papa_spawn');
    const straightM = Math.hypot(targetX - spawnX, targetZ - spawnZ);
    expect(seen * BUDGET_M).toBeGreaterThan(straightM * 1.1); // longer than the line the sofa blocks
    expect(papaOf(sim)).toMatchObject({ xM: targetX, zM: targetZ, state: 'idle' });
  });

  it('keeps every point of the walk in an open cell, between the waypoints too', async () => {
    const sim = await newSim();
    sim.enqueue(tap(-2.8, -2.2));
    for (let i = 0; i < 1500; i++) {
      sim.step();
      sim.drainEvents();
      expect(grid.isOpenAt(papaOf(sim).xM, papaOf(sim).zM)).toBe(true);
    }
    expect(papaOf(sim).state).toBe('idle');
  });

  it.each([
    ['on the sofa', 0.5, -1.7],
    ['on the stairs', 3.8, -1.2],
    ['far outside the floor', 10, 10],
    ['at the other end, outside', -10, -10],
  ])('a tap %s ends at the nearest open cell of his region', async (_name, x, z) => {
    const sim = await newSim();
    sim.enqueue(tap(x, z));
    const events = run(sim, 2000);
    const planned = events.find((e) => e.type === 'PapaPathPlanned') as {
      targetXM: number;
      targetZM: number;
    };
    const spawnCell = grid.cellAt(
      ...(anchor('papa_spawn').filter((_, i) => i !== 1) as [number, number]),
    );
    const cell = grid.nearestOpenCell(x, z, grid.region[spawnCell] as number);
    expect([planned.targetXM, planned.targetZM]).toEqual([
      grid.centerXM(cell),
      grid.centerZM(cell),
    ]);
    expect(papaOf(sim)).toMatchObject({
      state: 'idle',
      xM: grid.centerXM(cell),
      zM: grid.centerZM(cell),
    });
    expect(grid.isOpenAt(x, z)).toBe(false);
  });

  it('stands on the nearest open cell when his own cell is not open (a restored odd snapshot)', async () => {
    const sim = await newSim();
    const snapshot = sim.snapshot();
    snapshot.world.papa.xM = -3.9;
    snapshot.world.papa.zM = -2.9;
    sim.restore(snapshot);
    sim.enqueue(tap(0, 1));
    run(sim, 1);
    expect(grid.isOpenAt(papaOf(sim).xM, papaOf(sim).zM)).toBe(true);
    run(sim, 1000);
    expect(papaOf(sim)).toMatchObject({ state: 'idle', xM: 0, zM: 1 });
  });

  it('a tap into a pocket he cannot reach goes to the nearest point of his own region', async () => {
    const rows = geometry.nav.rows.map((row) => row.split(''));
    // An island of 5 x 5 walkable cells walled in by blocked ones, inside the open floor.
    for (let r = 13; r <= 19; r++) for (let c = 2; c <= 8; c++) (rows[r] as string[])[c] = '0';
    for (let r = 15; r <= 17; r++) for (let c = 4; c <= 6; c++) (rows[r] as string[])[c] = '1';
    const islanded: LevelGeometry = {
      ...geometry,
      nav: { ...geometry.nav, rows: rows.map((row) => row.join('')) },
    };
    const sim = await newSim({ geometry: islanded });
    const islandGrid = createNavGrid(islanded, content.feel.movement.papaRadiusM);
    const islandX = -4 + 5.5 * 0.25;
    const islandZ = -3 + 16.5 * 0.25;
    expect(islandGrid.isOpenAt(islandX, islandZ)).toBe(true);
    sim.enqueue(tap(islandX, islandZ));
    run(sim, 3000);
    const { xM, zM } = papaOf(sim);
    const papaRegion =
      islandGrid.region[islandGrid.cellAt(anchor('papa_spawn')[0], anchor('papa_spawn')[2])];
    expect(islandGrid.region[islandGrid.cellAt(xM, zM)]).toBe(papaRegion);
    expect(papaOf(sim).state).toBe('idle');
  });
});

describe('Move and MoveStop', () => {
  it('walks in the direction at the speed of the feel until it is stopped', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    sim.enqueue(move(-1, 0));
    const events = run(sim, 50);
    expect(types(events)).toEqual(['PapaStateChanged']);
    expect(events[0]).toMatchObject({ from: 'idle', to: 'walkDir' });
    expect(papaOf(sim).xM).toBeCloseTo(x - 50 * BUDGET_M, 9);
    expect(papaOf(sim).zM).toBe(z);
    expect(papaOf(sim)).toMatchObject({ headingX: -1, headingZ: 0, dirX: -1, dirZ: 0 });
    sim.enqueue(stop(sim.world.time.sim));
    const stopped = run(sim, 10);
    expect(types(stopped)).toEqual(['PapaStateChanged']);
    expect(stopped[0]).toMatchObject({ from: 'walkDir', to: 'idle' });
    const rest = papaOf(sim).xM;
    run(sim, 10);
    expect(papaOf(sim)).toMatchObject({ state: 'idle', xM: rest, dirX: 0, dirZ: 0 });
  });

  it('normalises the direction and keeps the speed the same on a diagonal', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    sim.enqueue(move(-3, -3));
    run(sim, 50);
    const travelled = Math.hypot(papaOf(sim).xM - x, papaOf(sim).zM - z);
    expect(travelled).toBeCloseTo(50 * BUDGET_M, 9);
    expect(papaOf(sim).dirX).toBeCloseTo(-Math.SQRT1_2, 12);
  });

  it('a new direction while walking one only updates it, without a state event', async () => {
    const sim = await newSim();
    sim.enqueue(move(-1, 0));
    run(sim, 5);
    sim.enqueue(move(0, -1, 50));
    const events = run(sim, 5);
    expect(events).toEqual([]);
    expect(papaOf(sim)).toMatchObject({ state: 'walkDir', dirX: 0, dirZ: -1, headingZ: -1 });
  });

  it('MoveStop during a tapped path is ignored', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    sim.enqueue(tap(x - 2, z));
    run(sim, 10);
    sim.enqueue(stop(100));
    const events = run(sim, 100);
    expect(types(events)).toEqual(['PapaArrived', 'PapaStateChanged']);
    expect(papaOf(sim).xM).toBe(x - 2);
  });

  it('MoveStop while idle is ignored', async () => {
    const sim = await newSim();
    sim.enqueue(stop());
    expect(run(sim, 5)).toEqual([]);
  });

  it('Move cancels a tapped path', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    sim.enqueue(tap(x - 3, z));
    run(sim, 10);
    sim.enqueue(move(0, 1, 100));
    const events = run(sim, 5);
    expect(types(events)).toEqual(['PapaStateChanged']);
    expect(events[0]).toMatchObject({ from: 'walkPath', to: 'walkDir' });
    expect(papaOf(sim)).toMatchObject({ state: 'walkDir', path: [], pathIndex: 0 });
    const leftAt = papaOf(sim).xM;
    run(sim, 20);
    expect(papaOf(sim).xM).toBe(leftAt); // no longer heading to the tapped point
  });

  it('a TapFloor during a direction walk replans and takes over', async () => {
    const sim = await newSim();
    const [x, , z] = anchor('papa_spawn');
    sim.enqueue(move(-1, 0));
    run(sim, 10);
    sim.enqueue(tap(x, z, 100));
    const events = run(sim, 100);
    expect(types(events)).toEqual([
      'PapaPathPlanned',
      'PapaStateChanged',
      'PapaArrived',
      'PapaStateChanged',
    ]);
    expect(events[1]).toMatchObject({ from: 'walkDir', to: 'walkPath' });
    expect(papaOf(sim)).toMatchObject({ xM: x, zM: z, state: 'idle', dirX: 0, dirZ: 0 });
  });

  it('applies several commands of one step in order', async () => {
    const sim = await newSim();
    sim.enqueue(move(1, 0));
    sim.enqueue(stop());
    expect(types(run(sim, 1))).toEqual(['PapaStateChanged', 'PapaStateChanged']);
    expect(papaOf(sim).state).toBe('idle');

    const other = await newSim();
    other.enqueue(stop());
    other.enqueue(move(1, 0));
    expect(types(run(other, 1))).toEqual(['PapaStateChanged']);
    expect(papaOf(other).state).toBe('walkDir');
  });

  it('turns -0 into 0, so that nothing depends on a sign of zero', async () => {
    const sim = await newSim();
    sim.enqueue(move(-0, -1));
    run(sim, 1);
    expect(Object.is(papaOf(sim).dirX, 0)).toBe(true);
    expect(Object.is(papaOf(sim).headingX, 0)).toBe(true);
  });

  it('normalises a vector too small or too large to square', async () => {
    const tiny = await newSim();
    tiny.enqueue(move(1e-200, 1e-200));
    run(tiny, 1);
    expect(papaOf(tiny).state).toBe('walkDir');
    expect(papaOf(tiny).dirX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(papaOf(tiny).dirZ).toBeCloseTo(Math.SQRT1_2, 12);

    const huge = await newSim();
    huge.enqueue(move(1e200, 1e200));
    run(huge, 1);
    expect(papaOf(huge).dirX).toBeCloseTo(Math.SQRT1_2, 12);
    expect(papaOf(huge).dirZ).toBeCloseTo(Math.SQRT1_2, 12);
  });
});

describe('walls and obstacles', () => {
  it('stops against the back wall with one PapaBlocked, and stays there', async () => {
    const sim = await newSim();
    sim.enqueue(move(0, -1));
    const events = run(sim, 600);
    const blocked = events.filter((e) => e.type === 'PapaBlocked');
    expect(blocked).toHaveLength(1);
    expect(papaOf(sim)).toMatchObject({ state: 'walkDir', isBlocked: true });
    expect(grid.isOpenAt(papaOf(sim).xM, papaOf(sim).zM)).toBe(true);
    expect(blocked[0]).toMatchObject({ xM: papaOf(sim).xM, zM: papaOf(sim).zM });
    const stuckAt = papaOf(sim).zM;
    expect(run(sim, 200)).toEqual([]);
    expect(papaOf(sim).zM).toBe(stuckAt);
  });

  it('is not blocked any more once the direction lets him move, and blocks again later', async () => {
    const sim = await newSim();
    sim.enqueue(move(0, -1));
    run(sim, 600);
    sim.enqueue(move(0, 1, sim.world.time.sim));
    run(sim, 5);
    expect(papaOf(sim).isBlocked).toBe(false);
    sim.enqueue(move(0, -1, sim.world.time.sim));
    const events = run(sim, 600);
    expect(events.filter((e) => e.type === 'PapaBlocked')).toHaveLength(1);
  });

  it('reports a blockage again when a new direction runs into another wall', async () => {
    const sim = await newSim();
    sim.enqueue(move(1, -1)); // slides into the back-right corner
    run(sim, 900);
    expect(papaOf(sim).isBlocked).toBe(true);
    sim.enqueue(move(0, -1, sim.world.time.sim)); // another wall, no step succeeds in between
    const events = run(sim, 5);
    expect(events.filter((e) => e.type === 'PapaBlocked')).toHaveLength(1);
    sim.enqueue(move(0, -1, sim.world.time.sim)); // the same direction again is not a new blockage
    expect(run(sim, 5).filter((e) => e.type === 'PapaBlocked')).toEqual([]);
  });

  it('a stop clears the blocked flag', async () => {
    const sim = await newSim();
    sim.enqueue(move(0, -1));
    run(sim, 600);
    sim.enqueue(stop(sim.world.time.sim));
    run(sim, 2);
    expect(papaOf(sim)).toMatchObject({ state: 'idle', isBlocked: false });
  });

  it('slides along a wall when pushed diagonally into it', async () => {
    const sim = await newSim();
    sim.enqueue(move(2, 1));
    const trail: [number, number][] = [];
    const events: SimEvent[] = [];
    for (let i = 0; i < 400; i++) {
      sim.step();
      events.push(...sim.drainEvents());
      trail.push([papaOf(sim).xM, papaOf(sim).zM]);
    }
    const last = trail.at(-1) as [number, number];
    const wallStep = trail.findIndex(
      ([x], i) => i > 0 && x === (trail[i - 1] as [number, number])[0],
    );
    expect(wallStep).toBeGreaterThan(0);
    // After the side wall is met, x stays and z goes on until the bottom edge.
    const slide = trail.slice(wallStep);
    expect(new Set(slide.map(([x]) => x)).size).toBe(1);
    expect((slide.at(-1) as [number, number])[1]).toBeGreaterThan(
      (slide[0] as [number, number])[1],
    );
    // The last open column is 30 (x < 3.75) and the last open row is 22 (z < 2.75): one cell of
    // clearance from the edge of the 32 x 24 grid.
    expect(last[0]).toBeLessThan(3.75);
    expect(last[0]).toBeGreaterThan(3.7);
    expect(last[1]).toBeLessThan(2.75);
    expect(last[1]).toBeGreaterThan(2.7);
    expect(events.filter((e) => e.type === 'PapaBlocked')).toHaveLength(1);
  });
});

describe('interpolation and determinism', () => {
  it('keeps prev… at the position before the step', async () => {
    const sim = await newSim();
    sim.enqueue(move(-1, 0));
    for (let i = 0; i < 20; i++) {
      const before = { x: papaOf(sim).xM, z: papaOf(sim).zM };
      sim.step();
      expect(papaOf(sim).prevXM).toBe(before.x);
      expect(papaOf(sim).prevZM).toBe(before.z);
    }
    expect(papaOf(sim).xM).not.toBe(papaOf(sim).prevXM);
  });

  it('the speed follows the feel', async () => {
    const fast: ContentBundle = {
      ...content,
      feel: { ...content.feel, movement: { ...content.feel.movement, walkSpeedMps: 6 } },
    };
    const slow = await newSim();
    const quick = await newSim({ content: fast });
    const [x] = anchor('papa_spawn');
    for (const sim of [slow, quick]) sim.enqueue(move(-1, 0));
    run(slow, 40);
    run(quick, 40);
    expect(x - papaOf(quick).xM).toBeCloseTo(2 * (x - papaOf(slow).xM), 9);
  });

  it('two sims given the same commands give the same events and world', async () => {
    const script = (sim: Sim) => {
      sim.enqueue(tap(0.5, -2.6));
      sim.enqueue(move(1, 0, 3000));
      sim.enqueue(tap(-3, 2, 3400));
      sim.enqueue(stop(5000));
    };
    const a = await newSim();
    const b = await newSim();
    script(a);
    script(b);
    expect(run(a, 1000)).toEqual(run(b, 1000));
    expect(hashJson(a.world)).toBe(hashJson(b.world));
  });

  it('is plain data at every step of a walk (JSON round trip)', async () => {
    const sim = await newSim();
    sim.enqueue(tap(0.5, -2.6));
    for (let i = 0; i < 50; i++) {
      sim.step();
      expect(JSON.parse(JSON.stringify(sim.world))).toEqual(sim.world);
    }
  });
});
