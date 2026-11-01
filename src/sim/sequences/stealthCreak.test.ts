import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createCreakGeometry,
  createStealthSim,
  only,
  type StealthSim,
} from '../../../tests/support/stealthSupport.ts';
import {
  createTestContent,
  createTestLevel,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';

// The boards of the stealth exit (story 4.9, AC 10): one `FloorCreaked` for each entry into a
// `ZONE_creak_*`, none for standing or walking on it, none for the board Papa starts on, and none
// outside a stealth step. The frozen room has no board: each test adds its own, on the real path
// that Papa walks, found by a dry run.
const content = createTestContent();
const DOOR = { xM: 2.9, zM: -2.8 } as const;

/** Where Papa is after each step of a walk from the playpen to the door. */
async function pathToTheDoor(): Promise<{ xM: number; zM: number }[]> {
  const run = await createStealthSim();
  run.start();
  run.holdAlerts();
  run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM: DOOR.xM, zM: DOOR.zM });
  const points: { xM: number; zM: number }[] = [];
  for (let i = 0; i < 2000 && run.world.flow.state === 'sequence'; i++) {
    run.stepOnce();
    points.push({ xM: run.world.papa.xM, zM: run.world.papa.zM });
  }
  expect(run.world.flow.state).toBe('playing');
  return points;
}

/** A box of half-size `halfM` around the point a fraction `at` of the way along the path. */
function boxOn(
  points: readonly { xM: number; zM: number }[],
  at: number,
  halfM = 0.25,
): readonly [number, number, number, number] {
  const point = points[Math.floor(points.length * at)] as { xM: number; zM: number };
  return [point.xM, point.zM, halfM, halfM];
}

async function walkToTheDoor(run: StealthSim, untilMs = 20_000): Promise<void> {
  run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM: DOOR.xM, zM: DOOR.zM });
  const endAt = run.world.time.sim + untilMs;
  while (run.world.flow.state === 'sequence' && run.world.time.sim < endAt) run.stepOnce();
}

describe('the boards (story 4.9)', () => {
  it('creaks once on entering a board that is on the path, at the point he entered', async () => {
    const points = await pathToTheDoor();
    const box = boxOn(points, 0.5);
    const run = await createStealthSim({ creakBoxes: [box] });
    run.start();
    run.holdAlerts();
    await walkToTheDoor(run);
    const creaks = only(run.events, 'FloorCreaked');
    expect(creaks).toHaveLength(1);
    expect(creaks[0]?.zoneId).toBe('creak_test_0');
    expect(Math.abs((creaks[0]?.xM ?? 99) - box[0])).toBeLessThanOrEqual(box[2] + 0.1);
    expect(Math.abs((creaks[0]?.zM ?? 99) - box[1])).toBeLessThanOrEqual(box[3] + 0.1);
  });

  it('does not creak for standing or walking on the board', async () => {
    const points = await pathToTheDoor();
    const run = await createStealthSim({ creakBoxes: [boxOn(points, 0.5, 0.6)] });
    run.start();
    run.holdAlerts();
    await walkToTheDoor(run);
    expect(only(run.events, 'FloorCreaked')).toHaveLength(1);

    const standing = await createStealthSim({ creakBoxes: [boxOn(points, 0.5, 0.6)] });
    standing.start();
    standing.holdAlerts();
    const box = boxOn(points, 0.5, 0.6);
    standing.teleportPapa(box[0], box[1]);
    standing.runTo(standing.world.time.sim + 2000);
    // He was put on the board by hand, between two steps: that is one entry, then he stands.
    expect(only(standing.events, 'FloorCreaked').length).toBeLessThanOrEqual(1);
  });

  it('creaks again on coming back', async () => {
    const points = await pathToTheDoor();
    const box = boxOn(points, 0.5, 0.25);
    const run = await createStealthSim({ creakBoxes: [box] });
    run.start();
    run.holdAlerts();
    await walkToTheDoor(run, 5500);
    expect(run.world.flow.state).toBe('sequence');
    const first = only(run.events, 'FloorCreaked').length;
    expect(first).toBe(1);
    // Out of the room's way and back in by hand: the board is entered again.
    run.teleportPapa(box[0] + 1.5, box[1]);
    run.stepOnce();
    run.teleportPapa(box[0], box[1]);
    run.stepOnce();
    expect(only(run.events, 'FloorCreaked')).toHaveLength(2);
  });

  it('never creaks for the board he starts on, only for entering one', async () => {
    const run = await createStealthSim({ creakBoxes: [[-2, 1.6, 0.4, 0.4]] });
    const seen = run.start();
    run.holdAlerts();
    run.runTo(run.world.time.sim + 1000);
    expect(only(seen, 'FloorCreaked')).toEqual([]);
    expect(only(run.events, 'FloorCreaked')).toEqual([]);
    expect(run.world.sequence.stealth.creakZoneIndex).toBe(0);
    run.sim.enqueue({ type: 'Move', t: run.world.time.sim, dirX: 1, dirZ: 0 });
    run.runTo(run.world.time.sim + 3000);
    run.sim.enqueue({ type: 'Move', t: run.world.time.sim, dirX: -1, dirZ: 0 });
    run.runTo(run.world.time.sim + 3000);
    expect(only(run.events, 'FloorCreaked').length).toBeGreaterThanOrEqual(1);
  });

  it('creaks for a glide over a board like for a walk', async () => {
    const run = await createStealthSim({ creakBoxes: [[-0.5, 1.6, 0.3, 0.3]] });
    run.start();
    run.holdAlerts();
    run.alertNow('realWake');
    const wake = run.realWake();
    run.teleportPapa(1.5, 1.6);
    run.world.sequence.stealth.creakZoneIndex = -1;
    run.runTo(wake.windowOpenAt - STEP_MS);
    const centreMs = wake.windowOpenAt + (wake.responseWindow?.windowMs ?? 0) / 2;
    run.sim.enqueue({ type: 'PressThreat', t: asSimMs(centreMs), threatId: wake.id });
    run.sim.enqueue({ type: 'Release', t: asSimMs(centreMs + 20) });
    run.runTo(centreMs + 3000);
    expect(only(run.events, 'FloorCreaked').length).toBeGreaterThanOrEqual(1);
  });

  it('is nothing in a level with no creak zone', async () => {
    const run = await createStealthSim();
    run.start();
    run.holdAlerts();
    await walkToTheDoor(run);
    expect(only(run.events, 'FloorCreaked')).toEqual([]);
    expect(run.world.flow.state).toBe('playing');
  });

  it('is nothing on a board with no stealth step running', async () => {
    const sim = await createSim({
      content,
      geometry: createCreakGeometry([[0, 0, 6, 6]]),
      level: createTestLevel({ waves: [testWave([OUTLET], { fromMs: 500_000 })] }),
      seed: 1,
    });
    sim.enqueue({ type: 'TapFloor', t: asSimMs(0), xM: -3, zM: 0 });
    for (let i = 0; i < 300; i++) sim.step();
    sim.enqueue({ type: 'TapFloor', t: sim.world.time.sim, xM: 3, zM: 0 });
    for (let i = 0; i < 300; i++) sim.step();
    expect(only(sim.drainEvents(), 'FloorCreaked')).toEqual([]);
  });

  it('is nothing once the sequence is over, however long he walks the boards', async () => {
    const points = await pathToTheDoor();
    const box = boxOn(points, 0.5, 0.6);
    const run = await createStealthSim({ creakBoxes: [box] });
    run.start();
    run.holdAlerts();
    run.teleportPapa(DOOR.xM - 0.5, DOOR.zM);
    run.stepOnce();
    expect(run.world.flow.state).toBe('playing');
    const creaksAtEnd = only(run.events, 'FloorCreaked').length;
    run.sim.enqueue({ type: 'TapFloor', t: run.world.time.sim, xM: box[0], zM: box[1] });
    run.runTo(run.world.time.sim + 6000);
    expect(only(run.events, 'FloorCreaked')).toHaveLength(creaksAtEnd);
  });
});
