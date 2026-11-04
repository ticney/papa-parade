import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestCycleGeometry,
  createTestCycleLevel,
} from '../../../tests/support/cycleSupport.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

// Snapshot v27 (story 4.10): `world.cycle`. A round trip with the chain in flight (an interlude, a
// gather walk, the wait of a retry) is played to the end on both copies, hashes and events compared;
// and each field the guard checks has a test that names it.
const createCycleSim = (seed = 1): Promise<Sim> =>
  createSim({
    content: createTestContent(),
    geometry: createTestCycleGeometry(),
    level: createTestCycleLevel(),
    seed,
  });
const worldOf = (sim: Sim) => sim.world as World;
const roundTrip = (sim: Sim) =>
  JSON.parse(JSON.stringify(sim.snapshot())) as ReturnType<Sim['snapshot']>;

/** Plays `sim` to the level's end, and returns what it emitted. */
function playToEnd(sim: Sim): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < 30_000 && worldOf(sim).flow.state !== 'ended'; i++) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  expect(worldOf(sim).flow.state).toBe('ended');
  return events;
}

async function expectSameEnd(live: Sim): Promise<void> {
  live.drainEvents();
  const copy = await createCycleSim();
  copy.restore(roundTrip(live));
  expect(hashJson(copy.world)).toBe(hashJson(live.world));
  const liveEvents = playToEnd(live);
  expect(playToEnd(copy)).toEqual(liveEvents);
  expect(hashJson(copy.world)).toBe(hashJson(live.world));
  copy.dispose();
  live.dispose();
}

function stepUntil(sim: Sim, until: () => boolean): void {
  for (let i = 0; i < 30_000 && !until(); i++) sim.step();
  expect(until()).toBe(true);
}

describe('the cycle in a snapshot (story 4.10)', () => {
  it('is version 30 and carries the slice at rest in a level with no cycle', async () => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    const snapshot = sim.snapshot();
    expect(snapshot.version).toBe(30);
    expect(snapshot.world.cycle).toEqual({ index: 0, nextAt: null, completedAt: null });
    sim.dispose();
  });

  it('round-trips during an interlude', async () => {
    const live = await createCycleSim();
    stepUntil(live, () => worldOf(live).time.sim === 5000);
    expect(worldOf(live).cycle.nextAt).toBe(15_000);
    await expectSameEnd(live);
  }, 30_000);

  it('round-trips during a gather walk', async () => {
    const live = await createCycleSim();
    stepUntil(live, () => worldOf(live).time.sim === 15_000 + 2 * STEP_MS);
    expect(worldOf(live).papa.state).toBe('walkPath');
    expect(worldOf(live).papa.intent).toBe('takeBaby');
    await expectSameEnd(live);
  }, 30_000);

  it('round-trips during the wait of a retry', async () => {
    const live = await createCycleSim();
    // Nobody plays: the first sequence is lost, and the entry waits to come again.
    let failedAt = -1;
    stepUntil(live, () => {
      if (live.drainEvents().some((e) => e.type === 'SequenceEnded'))
        failedAt = worldOf(live).time.sim;
      return failedAt >= 0;
    });
    expect(worldOf(live).flow.state).toBe('playing');
    expect(worldOf(live).cycle).toMatchObject({ index: 0, nextAt: asSimMs(failedAt + 8000) });
    live.step();
    await expectSameEnd(live);
  }, 30_000);
});

describe('what the slice refuses (story 4.10)', () => {
  it.each([
    ['a missing slice', null, 'world.cycle is missing'],
    ['an index that is no integer', { index: 0.5 }, 'world.cycle.index'],
    ['a negative index', { index: -1 }, 'world.cycle.index'],
    ['an index past the entries', { index: 6 }, 'world.cycle.index'],
    ['a nextAt that is no number', { nextAt: 'soon' }, 'world.cycle.nextAt'],
    ['a negative nextAt', { nextAt: -10 }, 'world.cycle.nextAt'],
    ['a null nextAt before the end', { nextAt: null }, 'world.cycle.nextAt'],
    ['a completedAt that is no number', { completedAt: Number.NaN }, 'world.cycle.completedAt'],
    ['a negative completedAt', { completedAt: -10 }, 'world.cycle.completedAt'],
    ['a completedAt before the last entry', { completedAt: 10 }, 'world.cycle.completedAt'],
    ['the last entry passed with no completedAt', { index: 5 }, 'world.cycle.completedAt'],
    ['a nextAt with the cycle done', { index: 5, completedAt: 10 }, 'world.cycle.nextAt'],
  ])('%s', async (_title, change, message) => {
    const sim = await createCycleSim();
    sim.step();
    const snapshot = roundTrip(sim);
    (snapshot.world as unknown as Record<string, unknown>).cycle =
      change === null ? null : { ...snapshot.world.cycle, ...change };
    expect(() => sim.restore(snapshot)).toThrow(message);
    sim.dispose();
  });

  it.each([
    ['an entry index', { index: 1 }, 'world.cycle.index'],
    ['a nextAt', { nextAt: 10 }, 'world.cycle.nextAt'],
    ['a completedAt', { completedAt: 10 }, 'world.cycle.completedAt'],
  ])('%s in a level with no cycle', async (_title, change, message) => {
    const sim = await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    });
    sim.step();
    const snapshot = roundTrip(sim);
    snapshot.world.cycle = { ...snapshot.world.cycle, ...change } as World['cycle'];
    expect(() => sim.restore(snapshot)).toThrow(message);
    sim.dispose();
  });

  it('accepts a level ended early with the cycle done, and refuses it without', async () => {
    const sim = await createCycleSim();
    sim.step();
    const snapshot = roundTrip(sim);
    snapshot.world.flow = {
      state: 'ended',
      enteredAt: snapshot.world.time.sim,
      finalRushAt: null,
    };
    expect(() => sim.restore(snapshot)).toThrow('world.flow.state');
    snapshot.world.cycle = { index: 5, nextAt: null, completedAt: snapshot.world.time.sim };
    snapshot.world.score.final = {
      laughPoints: 0,
      calmPoints: 0,
      homePoints: 0,
      sighPoints: 0,
      screamPoints: 0,
      scorePoints: 0,
      stars: 0,
      lostStars: 0,
    } as unknown as World['score']['final'];
    sim.restore(snapshot);
    expect(worldOf(sim).flow.state).toBe('ended');
    expect(worldOf(sim).cycle.completedAt).toBe(snapshot.world.time.sim);
    sim.dispose();
  });
});
