import type { DifficultyTierId } from '@shared/constants';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  NOISE_GAUGES,
  OUTLET,
  STAIRS,
  TEST_OBJECTS,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';

// Story 3.16 (FR73): the catastrophe gauge in a real sim, and Mama coming home early. The gauge's own
// rules (categories, tiers, decay, drop) are `catastrophe.test.ts`; this file is the end of the level.

const DURATION_MS = 30_000;
const content = createTestContent();
const { finalRushMs } = content.feel.endOfLevel;
const RUSH_AT = DURATION_MS - finalRushMs;
const FINAL_RUSH = { spillAnchor: 'coffee_table' };

interface Options {
  durationMs?: number;
  finalRush?: boolean;
  noise?: boolean;
  sequences?: readonly string[];
  carry?: boolean;
  /** Threats the director draws from, failing on purpose when nobody presses (default: none). */
  threats?: Parameters<typeof testWave>[0];
  /** When the wave starts, in sim ms (0 by default): a late one keeps the gags out of the first part of the level. */
  waveFromMs?: number;
  tier?: DifficultyTierId;
}

async function newSim(options: Options = {}): Promise<Sim> {
  const fresh = createTestContent();
  fresh.feel.endOfLevel.doorSpillCount = 0;
  const sim = await createSim({
    content: fresh,
    geometry: createTestGeometry(),
    level: createTestLevel({
      durationMs: options.durationMs ?? DURATION_MS,
      objects: TEST_OBJECTS,
      gauges: {
        ...(options.noise === true ? NOISE_GAUGES : {}),
        ...(options.sequences?.includes('stay_awake') === true ? FATIGUE_GAUGES : {}),
      },
      waves:
        options.threats === undefined
          ? []
          : [testWave(options.threats, { fromMs: options.waveFromMs ?? 0 })],
      sequences: options.sequences ?? [],
      ...(options.carry === true ? { carry: CARRY } : {}),
      ...(options.finalRush === true ? { finalRush: FINAL_RUSH } : {}),
    }),
    seed: 3,
  });
  if (options.tier !== undefined) {
    sim.enqueue({ type: 'SetDifficultyTier', t: asSimMs(0), tier: options.tier });
  }
  return sim;
}

const worldOf = (sim: Sim) => sim.world as World;

function runTo(sim: Sim, untilMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilMs) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

const setCatastrophe = (sim: Sim, pct: number) =>
  sim.enqueue({ type: 'SetCatastrophe', t: asSimMs(sim.world.time.sim), pct });

const of = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T) =>
  events.filter((event): event is Extract<SimEvent, { type: T }> => event.type === type);

describe('the end reason in the world (AC 11)', () => {
  it('is null while the level is live, and the reason of LevelEnded once it is over', async () => {
    const sim = await newSim({ durationMs: 1000 });
    expect(sim.world.flow.endReason).toBeNull();
    runTo(sim, 990);
    expect(sim.world.flow.endReason).toBeNull();
    const events = runTo(sim, 1000);
    expect(of(events, 'LevelEnded')).toEqual([{ type: 'LevelEnded', t: 1000, reason: 'timer' }]);
    expect(sim.world.flow.endReason).toBe('timer');
  });

  it('is timer on the photo of a level with a final rush', async () => {
    const sim = await newSim({ finalRush: true });
    runTo(sim, DURATION_MS);
    expect(sim.world.flow.state).toBe('photo');
    expect(sim.world.flow.endReason).toBe('timer');
  });
});

describe('Mama comes home early (AC 8)', () => {
  it('ends the level in the step the gauge reaches 100: CatastropheChanged, LevelEnded{mamaHome}, LevelScored, no MamaWoke', async () => {
    const sim = await newSim();
    runTo(sim, 500);
    setCatastrophe(sim, 100);
    sim.step();
    const events = sim.drainEvents();
    const t = sim.world.time.sim;
    expect(events.map((event) => event.type)).toEqual([
      'CatastropheChanged',
      'LevelEnded',
      'LevelScored',
    ]);
    expect(of(events, 'LevelEnded')).toEqual([{ type: 'LevelEnded', t, reason: 'mamaHome' }]);
    expect(of(events, 'LevelScored')[0]?.t).toBe(t);
    expect(sim.world.flow).toEqual({
      state: 'ended',
      enteredAt: t,
      finalRushAt: null,
      endReason: 'mamaHome',
    });
    expect(t).toBeLessThan(DURATION_MS);
  });

  it('does not end at 99.9 %, nor at 0', async () => {
    const sim = await newSim();
    setCatastrophe(sim, 99.9);
    sim.step();
    expect(sim.world.gauges.catastrophePct).toBe(99.9);
    expect(sim.world.flow.state).toBe('playing');
    expect(sim.world.flow.endReason).toBeNull();
  });

  it('goes straight to ended in a level with a final rush: no rush, no photo, no door', async () => {
    const sim = await newSim({ finalRush: true });
    runTo(sim, RUSH_AT - 1000);
    setCatastrophe(sim, 100);
    const events = runTo(sim, sim.world.time.sim + STEP_MS);
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.flow.endReason).toBe('mamaHome');
    expect(sim.world.flow.finalRushAt).toBeNull();
    expect(of(events, 'FinalRushStarted')).toEqual([]);
    expect(of(events, 'MamaWoke')).toEqual([]);
  });

  it('wins the very step the rush would start', async () => {
    const sim = await newSim({ finalRush: true });
    runTo(sim, RUSH_AT - STEP_MS);
    setCatastrophe(sim, 100);
    const events = runTo(sim, RUSH_AT);
    expect(of(events, 'FinalRushStarted')).toEqual([]);
    expect(sim.world.flow.endReason).toBe('mamaHome');
    expect(sim.world.flow.finalRushAt).toBeNull();
  });

  it('freezes the world afterwards: 100 more steps move nothing but the clock, the gauge stays at 100', async () => {
    const sim = await newSim({ threats: [OUTLET] });
    setCatastrophe(sim, 100);
    sim.step();
    sim.drainEvents();
    const frozen = JSON.stringify({ ...worldOf(sim), time: null });
    runTo(sim, sim.world.time.sim + 100 * STEP_MS);
    expect(JSON.stringify({ ...worldOf(sim), time: null })).toBe(frozen);
    expect(sim.world.gauges.catastrophePct).toBe(100);
  });

  it('closes a sequence under way first: SequenceEnded{levelEnded} before LevelEnded', async () => {
    const sim = await newSim({ sequences: ['stay_awake'], carry: true });
    runTo(sim, 1000);
    sim.enqueue({
      type: 'StartSequence',
      t: asSimMs(sim.world.time.sim),
      sequenceId: 'stay_awake',
    });
    sim.step();
    sim.drainEvents();
    expect(sim.world.flow.state).toBe('sequence');
    setCatastrophe(sim, 100);
    sim.step();
    const events = sim.drainEvents();
    const types = events.map((event) => event.type);
    expect(of(events, 'SequenceEnded')).toMatchObject([
      { id: 'stay_awake', outcome: 'levelEnded' },
    ]);
    expect(types.indexOf('SequenceEnded')).toBeLessThan(types.indexOf('LevelEnded'));
    expect(sim.world.sequence.id).toBeNull();
    expect(sim.world.flow.endReason).toBe('mamaHome');
  });
});

describe('the ties (AC 9)', () => {
  it('goes to Mama come home when the noise is full in the same step: no MamaWoke', async () => {
    const sim = await newSim({ noise: true });
    runTo(sim, 500);
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: 100 });
    setCatastrophe(sim, 100);
    sim.step();
    const events = sim.drainEvents();
    expect(of(events, 'MamaWoke')).toEqual([]);
    expect(of(events, 'LevelEnded')).toMatchObject([{ reason: 'mamaHome' }]);
    // Each alone still ends the way it did.
    const noisy = await newSim({ noise: true });
    noisy.enqueue({ type: 'SetNoise', t: asSimMs(0), pct: 100 });
    noisy.step();
    expect(noisy.world.flow.endReason).toBe('mamaWoke');
  });

  it('goes to Mama come home when the bedtime cycle is completed in the same step', async () => {
    const sim = await newSim();
    runTo(sim, 500);
    worldOf(sim).cycle.completedAt = asSimMs(sim.world.time.sim + STEP_MS);
    setCatastrophe(sim, 100);
    sim.step();
    expect(sim.world.flow.endReason).toBe('mamaHome');
  });

  it('goes to Mama come home when the timer runs out in the same step', async () => {
    const sim = await newSim({ durationMs: 1000 });
    runTo(sim, 990);
    setCatastrophe(sim, 100);
    sim.step();
    expect(sim.world.time.sim).toBe(1000);
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.flow.endReason).toBe('mamaHome');
  });

  it('does not turn the photo into a mamaHome: a gauge command in the rush is ignored at the last step too', async () => {
    const sim = await newSim({ finalRush: true });
    // The rush is going, which freezes the gauge.
    runTo(sim, RUSH_AT + STEP_MS);
    setCatastrophe(sim, 100);
    runTo(sim, DURATION_MS);
    expect(sim.world.flow.state).toBe('photo');
    expect(sim.world.flow.endReason).toBe('timer');
  });
});

describe('a cascade of gags (AC 3)', () => {
  it('brings Mama home after a few failed near misses, with a CatastropheChanged for each', async () => {
    const sim = await newSim({ threats: [OUTLET, STAIRS], durationMs: 120_000 });
    const events: SimEvent[] = [];
    while (sim.world.flow.state === 'playing' && sim.world.time.sim < 120_000) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    expect(sim.world.flow.endReason).toBe('mamaHome');
    const rises = of(events, 'CatastropheChanged');
    expect(rises.length).toBeGreaterThanOrEqual(3);
    expect(rises.every((event) => event.source === 'nearMiss')).toBe(true);
    expect(of(events, 'LevelEnded')).toHaveLength(1);
    // The last rise is the one that filled the gauge, in the very step that ended the level.
    expect(rises.at(-1)?.catastrophePct).toBe(100);
    expect(rises.at(-1)?.t).toBe(of(events, 'LevelEnded')[0]?.t);
  });

  it('takes longer at the assistance tier than at the experienced tier, on the same seed', async () => {
    async function endsAt(tier: DifficultyTierId): Promise<number> {
      const sim = await newSim({ threats: [OUTLET, STAIRS], durationMs: 300_000, tier });
      while (sim.world.flow.state === 'playing' && sim.world.time.sim < 300_000) {
        sim.step();
        sim.drainEvents();
      }
      return sim.world.flow.endReason === 'mamaHome'
        ? sim.world.time.sim
        : Number.POSITIVE_INFINITY;
    }
    const assistance = await endsAt('assistance');
    const experienced = await endsAt('experienced');
    expect(experienced).toBeLessThan(assistance);
  });

  it('counts a table object as a mess, not a near miss', async () => {
    const sim = await newSim({ threats: [COFFEE_TABLE], durationMs: 120_000 });
    const events: SimEvent[] = [];
    while (sim.world.flow.state === 'playing' && sim.world.time.sim < 120_000) {
      sim.step();
      events.push(...sim.drainEvents());
    }
    const sources = new Set(of(events, 'CatastropheChanged').map((event) => event.source));
    expect(sources.has('mess')).toBe(true);
    expect(sources.has('nearMiss')).toBe(false);
  });
});

describe('the final rush freezes the gauge (AC 6, 7)', () => {
  it('does not move in the rush, whatever the gags, and a SetCatastrophe of 100 is ignored', async () => {
    const sim = await newSim({
      finalRush: true,
      threats: [OUTLET, STAIRS],
      waveFromMs: RUSH_AT - 500,
    });
    // The wave starts just before the rush, so that no gag has filled the gauge by then.
    runTo(sim, RUSH_AT - STEP_MS);
    setCatastrophe(sim, 60);
    runTo(sim, RUSH_AT);
    expect(sim.world.flow.state).toBe('finalRush');
    const atRushStart = sim.world.gauges.catastrophePct;
    const events = runTo(sim, RUSH_AT + 5000);
    expect(of(events, 'GagTriggered').length).toBeGreaterThan(0);
    expect(of(events, 'CatastropheChanged')).toEqual([]);
    expect(sim.world.gauges.catastrophePct).toBe(atRushStart);
    setCatastrophe(sim, 100);
    const after = runTo(sim, sim.world.time.sim + STEP_MS);
    expect(of(after, 'CatastropheChanged')).toEqual([]);
    expect(sim.world.gauges.catastrophePct).toBe(atRushStart);
    expect(sim.world.flow.state).toBe('finalRush');
    runTo(sim, DURATION_MS);
    expect(sim.world.flow.state).toBe('photo');
    expect(sim.world.flow.endReason).toBe('timer');
  });
});

describe('the debug command (AC 7)', () => {
  it('sets the gauge through the writer, source debug, held to [0, 100]', async () => {
    const sim = await newSim();
    setCatastrophe(sim, 42);
    sim.step();
    expect(sim.world.gauges.catastrophePct).toBe(42);
    expect(of(sim.drainEvents(), 'CatastropheChanged')).toEqual([
      {
        type: 'CatastropheChanged',
        t: sim.world.time.sim,
        source: 'debug',
        catastrophePct: 42,
        deltaPct: 42,
      },
    ]);
    setCatastrophe(sim, -30);
    sim.step();
    expect(sim.world.gauges.catastrophePct).toBe(0);
  });

  it('is applied last: the commanded value is the one the step ends on, with no decay under it', async () => {
    const sim = await newSim();
    setCatastrophe(sim, 80);
    sim.step();
    expect(sim.world.gauges.catastrophePct).toBe(80);
  });
});
