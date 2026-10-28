import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  stepN,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { computeMamaScore } from '../scoring/mamaScore.ts';
import { enterFlowState, FLOW_STATES, FLOW_STATES_ARE_COMPLETE } from './flowFsm.ts';

const DURATION_MS = 1000;

async function newSim(waves = false, durationMs = DURATION_MS) {
  return createSim({
    content: createTestContent(),
    geometry: createTestGeometry(),
    level: createTestLevel({ durationMs, waves: waves ? [testWave([OUTLET])] : [] }),
    seed: 3,
  });
}

describe('the flow FSM', () => {
  it('lists every state, and is proved complete at compile time', () => {
    expect([...FLOW_STATES]).toEqual(['playing', 'ended']);
    expect(FLOW_STATES_ARE_COMPLETE).toBe(true);
  });

  it('enterFlowState is the one writer of the state and its time, and emits nothing', async () => {
    const sim = await newSim();
    stepN(sim, 5);
    const world = sim.world as Parameters<typeof enterFlowState>[0];
    enterFlowState(world, 'ended');
    expect(world.flow).toEqual({ state: 'ended', enteredAt: 5 * STEP_MS });
    expect(sim.drainEvents()).toEqual([]);
  });
});

describe('runFlow', () => {
  it('starts playing', async () => {
    const sim = await newSim();
    expect(sim.world.flow).toEqual({ state: 'playing', enteredAt: 0 });
  });

  it('ends the level at the first step where the clock reaches durationMs, with LevelEnded{timer} once', async () => {
    const sim = await newSim();
    stepN(sim, DURATION_MS / STEP_MS - 1);
    expect(sim.world.flow.state).toBe('playing');
    expect(sim.drainEvents().some((event) => event.type === 'LevelEnded')).toBe(false);
    sim.step();
    expect(sim.world.time.sim).toBe(DURATION_MS);
    expect(sim.world.flow).toEqual({ state: 'ended', enteredAt: DURATION_MS });
    expect(sim.drainEvents().filter((event) => event.type === 'LevelEnded')).toEqual([
      { type: 'LevelEnded', t: DURATION_MS, reason: 'timer' },
    ]);
  });

  it('emits it exactly once, however long the clock keeps going', async () => {
    const sim = await newSim();
    stepN(sim, DURATION_MS / STEP_MS);
    sim.drainEvents();
    stepN(sim, 500);
    expect(sim.drainEvents().filter((event) => event.type === 'LevelEnded')).toEqual([]);
    expect(sim.world.flow.enteredAt).toBe(DURATION_MS);
  });

  it('ends a level with waves too, and the clock goes on past the end', async () => {
    const sim = await newSim(true);
    stepN(sim, DURATION_MS / STEP_MS + 50);
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.time.sim).toBe(DURATION_MS + 50 * STEP_MS);
  });

  it('gives Mama’s note in the ending step: LevelScored right after LevelEnded, same t, and once (story 1.22)', async () => {
    const sim = await newSim(true);
    const seen: SimEvent[] = [];
    for (let i = 0; i < DURATION_MS / STEP_MS - 1; i++) {
      sim.step();
      seen.push(...sim.drainEvents());
    }
    // None while playing.
    expect(seen.some((event) => event.type === 'LevelScored')).toBe(false);
    expect(sim.world.score.final).toBeNull();
    sim.step();
    const last = sim.drainEvents();
    const ended = last.findIndex((event) => event.type === 'LevelEnded');
    expect(ended).toBeGreaterThanOrEqual(0);
    expect(last[ended + 1]).toEqual({
      type: 'LevelScored',
      t: DURATION_MS,
      ...computeMamaScore(
        {
          perfects: sim.world.score.perfects,
          nearMisses: sim.world.score.nearMisses,
          propsOnFloor: sim.world.mess.propsOnFloor,
          propsBroken: sim.world.mess.propsBroken,
          mischiefs: sim.world.mess.mischiefs,
        },
        createTestContent().feel.mama,
      ),
    });
    expect(last.filter((event) => event.type === 'LevelScored')).toHaveLength(1);
    const {
      type: _type,
      t: _t,
      ...note
    } = last[ended + 1] as Extract<SimEvent, { type: 'LevelScored' }>;
    expect(sim.world.score.final).toEqual(note);
    // None after: the ended steps run only the clock and the commands.
    stepN(sim, 300);
    expect(sim.drainEvents().some((event) => event.type === 'LevelScored')).toBe(false);
  });

  it('is the same step for a duration that is off the step grid', async () => {
    const sim = await newSim(false, 1005);
    stepN(sim, 100);
    expect(sim.world.flow.state).toBe('playing');
    sim.step();
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.flow.enteredAt).toBe(1010);
  });
});
