import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  stepN,
  testWave,
} from '../../tests/support/testContent.ts';
import type { System } from './context.ts';
import { createSim, createSimWithSystems } from './createSim.ts';
import { ENDED_SYSTEMS, SYSTEMS } from './step.ts';
import type { World } from './world.ts';

describe('system order', () => {
  it('is pinned: changing it is a deliberate edit (and a golden regeneration)', () => {
    expect(SYSTEMS.map((system) => system.name)).toEqual([
      'applyCommands',
      'advanceTime',
      'runSequence',
      'runDirector',
      'runDisruptions',
      'runBaby',
      'runThreats',
      'runPapa',
      'runPhysics',
      'runGauges',
      'runScoring',
      'runFlow',
    ]);
  });

  it('runs only the commands and the clock once the level has ended (D8)', () => {
    expect(ENDED_SYSTEMS.map((system) => system.name)).toEqual(['applyCommands', 'advanceTime']);
  });

  it('runs the given systems in order, once per step', async () => {
    const calls: string[] = [];
    const first: System = () => calls.push('first');
    const second: System = () => calls.push('second');
    const sim = await createSimWithSystems(
      {
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel(),
        seed: 1,
      },
      [first, second],
    );
    sim.step();
    sim.step();
    expect(calls).toEqual(['first', 'second', 'first', 'second']);
    // No time system in the list: the clock does not move by itself.
    expect(sim.world.time.sim).toBe(0);
  });
});

describe('a step after the level has ended', () => {
  const DURATION_MS = 3000;
  async function endedSim(waves = true) {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({
        durationMs: DURATION_MS,
        waves: waves ? [testWave([OUTLET])] : [],
      }),
      seed: 5,
    });
    stepN(sim, DURATION_MS / STEP_MS);
    return sim;
  }

  it('moves no one: a tap on the floor does not send Papa, the baby stays, no event but the clock’s', async () => {
    const sim = await endedSim();
    expect(sim.world.flow.state).toBe('ended');
    sim.drainEvents();
    const papa = { xM: sim.world.papa.xM, zM: sim.world.papa.zM };
    const baby = { xM: sim.world.baby.xM, zM: sim.world.baby.zM, state: sim.world.baby.state };
    const threats = JSON.stringify(sim.world.threats);
    const props = JSON.stringify(sim.world.props);
    sim.enqueue({ type: 'TapFloor', t: asSimMs(sim.world.time.sim + STEP_MS), xM: -2, zM: 0 });
    sim.enqueue({ type: 'Move', t: asSimMs(sim.world.time.sim + STEP_MS), dirX: 1, dirZ: 0 });
    stepN(sim, 300);
    expect(sim.world.papa).toMatchObject({ ...papa, state: 'idle' });
    expect(sim.world.baby).toMatchObject(baby);
    expect(JSON.stringify(sim.world.threats)).toBe(threats);
    expect(JSON.stringify(sim.world.props)).toBe(props);
    expect(sim.drainEvents()).toEqual([]);
  });

  it('keeps the clock going, drains the command queue, and never emits LevelEnded twice', async () => {
    const sim = await endedSim();
    sim.drainEvents();
    sim.enqueue({ type: 'TapFloor', t: asSimMs(sim.world.time.sim + STEP_MS), xM: 0, zM: 0 });
    stepN(sim, 100);
    expect(sim.world.time.sim).toBe(DURATION_MS + 100 * STEP_MS);
    expect(sim.drainEvents().filter((event) => event.type === 'LevelEnded')).toEqual([]);
  });

  it('lets a running slow-mo wind down (a TimeScaleChanged is the only event that may come)', async () => {
    const sim = await endedSim(false);
    const world = sim.world as World;
    const startedAt = world.time.sim;
    world.time.slowMos.push({
      source: 'lastThreat',
      scale: 0.2,
      startedAt,
      holdUntil: asSimMs(startedAt + 100),
      endsAt: asSimMs(startedAt + 400),
    });
    world.time.scale = 0.2;
    sim.drainEvents();
    stepN(sim, 60);
    const events = sim.drainEvents();
    expect(events.length).toBeGreaterThan(0);
    expect(events.every((event) => event.type === 'TimeScaleChanged')).toBe(true);
    expect(sim.world.time.slowMos).toEqual([]);
    expect(sim.timeScale).toBe(1);
  });

  it('runs the injected systems no more either', async () => {
    const calls: string[] = [];
    const sim = await createSimWithSystems(
      {
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel({ durationMs: 20 }),
        seed: 1,
      },
      [
        ...SYSTEMS,
        () => {
          calls.push('extra');
        },
      ],
    );
    stepN(sim, 5);
    expect(calls).toEqual(['extra', 'extra']);
  });
});
