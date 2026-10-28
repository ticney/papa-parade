import type { LevelContent } from '@content/contentBundle';
import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  STAIRS,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

const content = createTestContent();
const geometry = createTestGeometry();

async function newSim(level: LevelContent, seed = 1): Promise<Sim> {
  return createSim({ content, geometry, level, seed });
}

function runTo(sim: Sim, untilSimMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

const telegraphs = (events: readonly SimEvent[]) =>
  events.filter(
    (event): event is Extract<SimEvent, { type: 'ThreatTelegraphed' }> =>
      event.type === 'ThreatTelegraphed',
  );

/**
 * Plays `sim` to `untilSimMs` step by step and returns every event and the most threats that were
 * announced or open at once (each telegraph ends in exactly one `ResponseResolved`).
 */
function playTo(sim: Sim, untilSimMs: number) {
  const events: SimEvent[] = [];
  let active = 0;
  let peak = 0;
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    for (const event of sim.drainEvents()) {
      events.push(event);
      if (event.type === 'ThreatTelegraphed') active++;
      if (event.type === 'ResponseResolved') active--;
    }
    peak = Math.max(peak, active);
    expect(active).toBe(
      sim.world.threats.filter((t) => t.state === 'telegraph' || t.state === 'windowOpen').length,
    );
  }
  return { events, peak };
}

const THREE = [OUTLET, STAIRS, COFFEE_TABLE];

describe('runDirector', () => {
  it('does nothing in a level that plans nothing, and draws nothing from the rng', async () => {
    const sim = await newSim(createTestLevel());
    const rngBefore = JSON.stringify(sim.world.rng);
    const events = runTo(sim, 10_000);
    expect(telegraphs(events)).toEqual([]);
    expect(events.filter((event) => event.type === 'WaveStarted')).toEqual([]);
    expect(sim.world.threats).toEqual([]);
    // Only the baby draws; compare with a sim whose director cannot exist: no wave, same draws.
    const twin = await newSim(createTestLevel());
    runTo(twin, 10_000);
    expect(JSON.stringify(sim.world.rng)).toBe(JSON.stringify(twin.world.rng));
    expect(JSON.stringify(sim.world.rng)).not.toBe(rngBefore); // the baby did wander
  });

  it('draws nothing for a wave that has nothing to draw, only for the pool it has', async () => {
    const level = createTestLevel({ waves: [testWave([]), testWave([], { fromMs: 500 })] });
    const sim = await newSim(level);
    const twin = await newSim(createTestLevel());
    runTo(sim, 2000);
    runTo(twin, 2000);
    expect(JSON.stringify(sim.world.rng)).toBe(JSON.stringify(twin.world.rng));
  });

  describe('the waves', () => {
    it('emits WaveStarted once per wave, in order, at its fromMs', async () => {
      const level = createTestLevel({
        waves: [testWave([OUTLET]), testWave([], { fromMs: 1000 }), testWave([], { fromMs: 2000 })],
      });
      const sim = await newSim(level);
      const events = runTo(sim, 3000);
      expect(events.filter((event) => event.type === 'WaveStarted')).toEqual([
        { type: 'WaveStarted', t: STEP_MS, waveIndex: 0 },
        { type: 'WaveStarted', t: 1000, waveIndex: 1 },
        { type: 'WaveStarted', t: 2000, waveIndex: 2 },
      ]);
      expect(sim.world.director.waveIndex).toBe(2);
    });

    it('lands the first telegraph within [fromMs + gapMinMs, fromMs + gapMaxMs + a step]', async () => {
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const level = createTestLevel({
          waves: [testWave([OUTLET], { fromMs: 0, gapMinMs: 400, gapMaxMs: 900 })],
        });
        const first = telegraphs(runTo(await newSim(level, seed), 3000))[0];
        expect(first?.t).toBeGreaterThanOrEqual(400);
        expect(first?.t).toBeLessThanOrEqual(900 + STEP_MS);
        expect(first?.waveIndex).toBe(0);
      }
    });

    it('waits for the wave: nothing is telegraphed before its fromMs plus the gap', async () => {
      const level = createTestLevel({
        waves: [testWave([OUTLET], { fromMs: 3000, gapMinMs: 500, gapMaxMs: 500 })],
      });
      const sim = await newSim(level);
      expect(telegraphs(runTo(sim, 3490))).toEqual([]);
      expect(sim.world.threats[0]?.state).toBe('idle');
      expect(telegraphs(runTo(sim, 3500))).toEqual([
        expect.objectContaining({ t: 3500, threatId: 1 }),
      ]);
    });

    it('keeps every later gap inside the wave’s bounds (counted from the last telegraph)', async () => {
      const level = createTestLevel({
        waves: [testWave(THREE, { maxSimultaneous: 3, gapMinMs: 300, gapMaxMs: 700 })],
      });
      const events = runTo(await newSim(level, 7), 30_000);
      const times = telegraphs(events).map((event) => event.t);
      expect(times.length).toBeGreaterThan(4);
      // A gap can be longer when no threat is free or the baby plays a gag, never shorter.
      for (let i = 1; i < times.length; i++) {
        expect((times[i] as number) - (times[i - 1] as number)).toBeGreaterThanOrEqual(300);
      }
    });

    it('telegraphs nothing in the lull at the end of the wave', async () => {
      const level = createTestLevel({
        waves: [
          testWave(THREE, { maxSimultaneous: 3, gapMinMs: 0, gapMaxMs: 100, lullMs: 3000 }),
          testWave([], {
            fromMs: 10_000,
            maxSimultaneous: 3,
            gapMinMs: 100_000,
            gapMaxMs: 100_000,
          }),
        ],
      });
      const events = runTo(await newSim(level, 3), 10_000);
      const times = telegraphs(events).map((event) => event.t);
      expect(times.length).toBeGreaterThan(0);
      expect(Math.max(...times)).toBeLessThan(7000);
    });

    it('only draws the threats of the waves started: a wave-1 threat never comes before waves[1].fromMs', async () => {
      const level = createTestLevel({
        waves: [
          testWave([OUTLET, STAIRS], { gapMinMs: 100, gapMaxMs: 200 }),
          testWave([COFFEE_TABLE], { fromMs: 20_000, gapMinMs: 100, gapMaxMs: 200 }),
        ],
      });
      for (const seed of [1, 2, 3]) {
        const events = runTo(await newSim(level, seed), 40_000);
        const coffee = telegraphs(events).filter((event) => event.kind === 'coffee_table_object');
        expect(coffee.length).toBeGreaterThan(0);
        for (const event of coffee) {
          expect(event.t).toBeGreaterThanOrEqual(20_000);
          expect(event.waveIndex).toBe(1);
        }
        for (const event of telegraphs(events)) {
          expect(event.waveIndex).toBe(event.t < 20_000 ? 0 : 1);
        }
      }
    });
  });

  describe('simultaneity', () => {
    it.each([1, 2, 3])('reaches maxSimultaneous %i and never goes above it', async (limit) => {
      const level = createTestLevel({
        waves: [testWave(THREE, { maxSimultaneous: limit, gapMinMs: 0, gapMaxMs: 0 })],
      });
      for (const seed of [1, 2]) {
        const { peak } = playTo(await newSim(level, seed), 20_000);
        expect(peak).toBe(limit);
      }
    });

    it('never has two active in a wave with maxSimultaneous 1, even with many threats and no gap', async () => {
      const level = createTestLevel({
        waves: [testWave(THREE, { maxSimultaneous: 1, gapMinMs: 0, gapMaxMs: 0 })],
      });
      const { events, peak } = playTo(await newSim(level, 4), 30_000);
      expect(peak).toBe(1);
      expect(telegraphs(events).length).toBeGreaterThan(3);
    });

    it('marks every telegraph with the wave that drew it', async () => {
      const level = createTestLevel({
        waves: [testWave([OUTLET]), testWave([STAIRS], { fromMs: 10_000 })],
      });
      const events = telegraphs(runTo(await newSim(level), 25_000));
      expect(events.every((event) => event.waveIndex === (event.t < 10_000 ? 0 : 1))).toBe(true);
    });
  });

  describe('the baby and the cooldown', () => {
    it('targets again once the threat is rearmed and the baby is free', async () => {
      const sim = await newSim(createTestLevel({ waves: [testWave([OUTLET])] }));
      // No press: the outlet gags, the baby plays its mischief for actMs, the cooldown is 6000 ms.
      const events = runTo(sim, 20_000);
      const gag = events.find((event) => event.type === 'GagTriggered');
      expect(gag).toBeDefined();
      const gagAt = (gag as { t: number }).t;
      const all = telegraphs(events);
      expect(all.length).toBeGreaterThanOrEqual(2);
      const next = all[1];
      expect(next?.t).toBeGreaterThanOrEqual(gagAt + 6000);
      // Not targeted while the baby is still in `act`: only once it is free again.
      const acts = events.filter(
        (event) => event.type === 'BabyStateChanged' && event.to === 'act',
      ) as { t: number }[];
      const actEndsAt = (acts[0]?.t ?? 0) + content.feel.baby.actMs;
      expect(actEndsAt).toBeLessThanOrEqual(next?.t ?? 0);
      expect(next?.t).toBeLessThanOrEqual(Math.max(gagAt + 6000, actEndsAt) + STEP_MS * 2);
    });

    it('never targets while the baby is in act', async () => {
      const feel = createTestContent();
      feel.feel.baby.actMs = 10_000;
      const level = createTestLevel({ waves: [testWave([OUTLET])] });
      const def = level.threats.outlet;
      if (def === undefined) throw new Error('no outlet');
      const sim = await createSim({
        content: feel,
        geometry,
        level: { ...level, threats: { outlet: { ...def, cooldownMs: 0 } } },
        seed: 1,
      });
      const events = runTo(sim, 9000);
      // Rearmed at once after the gag, but the baby plays for 10 s: no second telegraph yet.
      expect(telegraphs(events)).toHaveLength(1);
      expect(sim.world.baby.state).toBe('act');
      expect(sim.world.threats[0]?.state).toBe('idle');
    });
  });

  describe('the PRNG', () => {
    const level = () =>
      createTestLevel({
        waves: [testWave(THREE, { maxSimultaneous: 2, gapMinMs: 200, gapMaxMs: 1200 })],
      });
    const trace = async (seed: number) =>
      telegraphs(runTo(await newSim(level(), seed), 20_000)).map((e) => [e.t, e.threatId]);

    it('gives the same game for the same seed', async () => {
      expect(await trace(9)).toEqual(await trace(9));
      expect((await trace(9)).length).toBeGreaterThan(3);
    });

    it('differs between seeds: at least one of a few has another first pick or time', async () => {
      const firsts = new Set<string>();
      for (const seed of [1, 2, 3, 4, 5, 6, 7, 8])
        firsts.add(JSON.stringify((await trace(seed))[0]));
      expect(firsts.size).toBeGreaterThan(1);
    });

    it('draws a gap and a pick even with one candidate, whatever the tuning', async () => {
      // The rng of a game with the director minus that of the same game with no wave: the draws
      // of the director alone (the baby draws the same in both).
      const draws = async (gapMs: number) => {
        const planned = await newSim(
          createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: gapMs, gapMaxMs: gapMs })] }),
          2,
        );
        const quiet = await newSim(createTestLevel(), 2);
        runTo(planned, gapMs + STEP_MS);
        runTo(quiet, gapMs + STEP_MS);
        return JSON.stringify(planned.world.rng) !== JSON.stringify(quiet.world.rng);
      };
      expect(await draws(0)).toBe(true);
      expect(await draws(500)).toBe(true);
    });
  });
});
