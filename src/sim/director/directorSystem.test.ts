import type { LevelContent } from '@content/contentBundle';
import { STEP_MS } from '@shared/constants';
import { hashJson } from '@shared/hash';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  COFFEE_TABLE,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  FATIGUE_GAUGES,
  OUTLET,
  SILENCE,
  STAIRS,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
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

describe('the micro-sleep and the director (story 1.19)', () => {
  const tiredContent = {
    ...content,
    feel: {
      ...content.feel,
      fatigue: { ...content.feel.fatigue, startPoints: 90, microSleepMinMs: 0, microSleepMaxMs: 0 },
    },
  };

  it('does not count against maxSimultaneous: a wave of one still telegraphs its own threat', async () => {
    const sim = await createSim({
      content: tiredContent,
      geometry,
      level: createTestLevel({
        waves: [testWave([OUTLET], { gapMinMs: 1000, gapMaxMs: 1000 })],
        gauges: FATIGUE_GAUGES,
      }),
      seed: 1,
    });
    const events = runTo(sim, 1100);
    const all = telegraphs(events);
    const microSleep = all.find((event) => event.kind === 'papa_microsleep');
    const outlet = all.find((event) => event.kind === 'outlet');
    expect(microSleep).toMatchObject({ waveIndex: -1 });
    // The micro-sleep is announced (and still up) when the outlet's gap ends: the outlet comes on time.
    expect(microSleep?.t).toBeLessThan(1000);
    expect(outlet).toMatchObject({ t: 1000, waveIndex: 0 });
  });

  it('never draws the micro-sleep: a wave with nothing to draw plans nothing, whatever the fatigue', async () => {
    const sim = await createSim({
      content, // not tired: the system never spawns it
      geometry,
      level: createTestLevel({ waves: [testWave([])], gauges: FATIGUE_GAUGES }),
      seed: 1,
    });
    const events = runTo(sim, 20_000);
    expect(telegraphs(events)).toEqual([]);
  });

  it('keeps the draws of a level with no fatigue exactly as before (same pick, same instants)', async () => {
    const plain = createTestLevel({ waves: [testWave([OUTLET, STAIRS])] });
    const withGauge = createTestLevel({
      waves: [testWave([OUTLET, STAIRS])],
      gauges: FATIGUE_GAUGES,
    });
    const a = telegraphs(runTo(await newSim(plain, 3), 30_000)).map((event) => [
      event.t,
      event.kind,
    ]);
    const b = telegraphs(runTo(await newSim(withGauge, 3), 30_000)).map((event) => [
      event.t,
      event.kind,
    ]);
    // Fatigue stays under the threshold for 140 s: the gauge changes nothing the director draws.
    expect(b).toEqual(a);
  });
});

describe('the suspicious silence and the director (story 1.21)', () => {
  const silenceLevel = (
    overrides: Parameters<typeof testWave>[1] = {},
    extra = [] as (typeof OUTLET)[],
  ) => createTestLevel({ waves: [testWave([SILENCE, ...extra], overrides)] });
  const hidden = (events: readonly SimEvent[]) =>
    events.filter((event) => event.type === 'ThreatHidden');

  it('hides the silence instead of telegraphing it, in the same pool and with the same draws', async () => {
    const sim = await newSim(silenceLevel());
    const events = runTo(sim, 2 * STEP_MS);
    expect(hidden(events)).toEqual([
      expect.objectContaining({ kind: 'silence_mischief', waveIndex: 0 }),
    ]);
    expect(telegraphs(events)).toEqual([]);
    expect(sim.world.threats[0]).toMatchObject({ state: 'hidden', responseWindow: null });
  });

  it.each(['targetLocked', 'approach', 'act', 'mischiefSilent'] as const)(
    'does not draw a silence while the baby is %s',
    async (state) => {
      const sim = await newSim(silenceLevel());
      sim.world.baby.state = state;
      sim.world.baby.targetThreatId = 999;
      sim.step();
      expect(hidden(sim.drainEvents())).toEqual([]);
      expect(sim.world.threats[0]?.state).toBe('idle');
    },
  );

  it('does not draw a silence while one is under way, even with room in the wave', async () => {
    const sim = await newSim(silenceLevel({ maxSimultaneous: 3 }));
    sim.world.silence.threatId = 999;
    sim.step();
    expect(hidden(sim.drainEvents())).toEqual([]);
  });

  it('counts a hidden silence against maxSimultaneous: nothing else is telegraphed meanwhile', async () => {
    const sim = await newSim(silenceLevel({ maxSimultaneous: 1 }, [OUTLET]));
    const events = runTo(sim, 12 * STEP_MS);
    // Either was drawn first; the other waits for the first to be over.
    const first = hidden(events).length + telegraphs(events).length;
    expect(first).toBe(1);
    if (hidden(events).length === 1)
      expect(sim.world.threats.filter((t) => t.state === 'telegraph')).toEqual([]);
  });

  it('keeps the draws of a level with no silence exactly as before (the baseline trace)', async () => {
    // Captured on the commit before story 1.21: same rng state and same events, to the byte.
    const sim = await createSim({
      content,
      geometry,
      level: createTestLevel({
        waves: [
          testWave([OUTLET, STAIRS, COFFEE_TABLE], {
            maxSimultaneous: 2,
            gapMinMs: 1000,
            gapMaxMs: 3000,
            lullMs: 1000,
          }),
        ],
        gauges: FATIGUE_GAUGES,
      }),
      seed: 7,
    });
    const events = runTo(sim, 60_000);
    expect(sim.world.rng).toEqual({ a: 1581132668, b: 1663718832, c: 1567227279, d: 81 });
    expect(events).toHaveLength(183);
    expect(hashJson(events)).toBe('01c85cbbfc3da3');
  });

  describe('ForceThreat', () => {
    const force = (sim: Sim, threatId: number) =>
      sim.enqueue({ type: 'ForceThreat', t: asSimMs(sim.world.time.sim), threatId } as SimCommand);

    it('starts an idle threat now through the same helper: a telegraph, a hidden silence', async () => {
      const sim = await newSim(
        createTestLevel({ waves: [testWave([OUTLET, SILENCE], { fromMs: 60_000 })] }),
      );
      const [outlet, silence] = sim.world.threats;
      force(sim, (silence as { id: number }).id);
      const forcedSilence = runTo(sim, 2 * STEP_MS);
      expect(hidden(forcedSilence)).toHaveLength(1);
      force(sim, (outlet as { id: number }).id);
      const forcedOutlet = runTo(sim, 4 * STEP_MS);
      expect(telegraphs(forcedOutlet)).toEqual([expect.objectContaining({ kind: 'outlet' })]);
      // The wave index is the director's: no wave has started yet.
      expect(sim.world.threats[0]?.waveIndex).toBe(-1);
    });

    it('draws nothing from the rng and leaves the director gap alone', async () => {
      const sim = await newSim(
        createTestLevel({ waves: [testWave([OUTLET], { fromMs: 60_000 })] }),
      );
      const rng = structuredClone(sim.world.rng);
      const nextAt = sim.world.director.nextAt;
      force(sim, (sim.world.threats[0] as { id: number }).id);
      runTo(sim, 2 * STEP_MS);
      expect(sim.world.rng).toEqual(rng);
      expect(sim.world.director.nextAt).toBe(nextAt);
    });

    it.each([
      ['an unknown id', () => 9999],
      ['a threat that is not idle', (sim: Sim) => (sim.world.threats[0] as { id: number }).id],
    ])('is ignored, with no event, for %s', async (_name, pick) => {
      const sim = await newSim(
        createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 0, gapMaxMs: 0 })] }),
      );
      runTo(sim, 2 * STEP_MS); // the outlet is telegraphed by the wave
      const before = JSON.stringify(sim.world.threats);
      force(sim, pick(sim));
      const events = runTo(sim, 4 * STEP_MS);
      expect(
        events.filter((e) => e.type === 'ThreatTelegraphed' || e.type === 'ThreatHidden'),
      ).toEqual([]);
      expect(JSON.stringify(sim.world.threats)).toBe(before);
    });

    it('is ignored for the threat on Papa', async () => {
      const sim = await createSim({
        content,
        geometry,
        level: createTestLevel({
          waves: [testWave([OUTLET], { fromMs: 60_000 })],
          gauges: FATIGUE_GAUGES,
        }),
        seed: 1,
      });
      const microSleep = sim.world.threats.at(-1) as { id: number };
      force(sim, microSleep.id);
      const events = runTo(sim, 3 * STEP_MS);
      expect(telegraphs(events)).toEqual([]);
    });

    it('is ignored for a silence while the baby is not free', async () => {
      const sim = await newSim(
        createTestLevel({ waves: [testWave([SILENCE], { fromMs: 60_000 })] }),
      );
      sim.world.baby.state = 'approach';
      sim.world.baby.targetThreatId = 999;
      force(sim, (sim.world.threats[0] as { id: number }).id);
      sim.step();
      expect(hidden(sim.drainEvents())).toEqual([]);
      expect(sim.world.threats[0]?.state).toBe('idle');
    });
  });
});
