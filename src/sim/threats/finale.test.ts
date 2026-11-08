import type { ContentBundle } from '@content/contentBundle';
import type { LevelWave } from '@content/schemas/level';
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
  FATIGUE_GAUGES,
  OUTLET,
  STAIRS,
  TEST_OBJECTS,
  testWave,
} from '../../../tests/support/testContent.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

// Story 7.4 D1: the sim names the level's finale, the success that closes the level's last wave
// (`FinaleReached{lastWave}`, from `resolveThreat`). The cycle's own finale is in `bedtimeCycle.test.ts`.

const content = createTestContent();
/** A release this long after the window opens is a success, not a perfect (the centre is perfect). */
const SUCCESS_RELEASE_AFTER_MS = 30;

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

interface Options {
  waves: readonly LevelWave[];
  durationMs: number;
  /** Whether every threat whose window opens gets a success (the default), or none does. */
  isAnswered?: boolean;
  /** The defs to leave alone even when `isAnswered`. */
  skipDefs?: readonly string[];
  withContent?: ContentBundle;
  withFatigue?: boolean;
}

/**
 * Plays a test level to its end. Each threat whose window opens gets a press there and a release
 * `SUCCESS_RELEASE_AFTER_MS` later (a success), unless it is left alone.
 */
async function play({
  waves,
  durationMs,
  isAnswered = true,
  skipDefs = [],
  withContent = content,
  withFatigue = false,
}: Options): Promise<{ sim: Sim; events: SimEvent[] }> {
  const sim = await createSim({
    content: withContent,
    geometry: createTestGeometry(),
    level: createTestLevel({
      durationMs,
      waves,
      ...(withFatigue ? { objects: TEST_OBJECTS, gauges: FATIGUE_GAUGES } : {}),
    }),
    seed: 1,
  });
  const events: SimEvent[] = [];
  const pressed = new Set<number>();
  while (sim.world.flow.state !== 'ended') {
    for (const threat of sim.world.threats) {
      if (!isAnswered || threat.state !== 'windowOpen' || pressed.has(threat.id)) continue;
      if (skipDefs.includes(threat.defId)) continue;
      pressed.add(threat.id);
      const t = sim.world.time.sim;
      sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: threat.id });
      sim.enqueue({ type: 'Release', t: asSimMs(t + SUCCESS_RELEASE_AFTER_MS) });
    }
    sim.step();
    events.push(...sim.drainEvents());
  }
  return { sim, events };
}

/** The successes of `events`, in order. */
const successes = (events: readonly SimEvent[]) =>
  only(events, 'ResponseResolved').filter((event) => event.quality !== 'fail');

describe('FinaleReached{lastWave} (story 7.4)', () => {
  /** One wave, closed to new telegraphs at 1 s (a 6 s level, a 5 s lull): both threats come at once. */
  const PAIR = [testWave([OUTLET, STAIRS], { lullMs: 5000, maxSimultaneous: 2 })];

  it('comes with the success that closes the only wave, and the earlier success has none', async () => {
    const { events } = await play({ waves: PAIR, durationMs: 6000 });
    const won = successes(events);
    expect(won).toHaveLength(2);
    const last = won[1];
    expect(only(events, 'FinaleReached')).toEqual([
      { type: 'FinaleReached', t: last?.t, cause: 'lastWave', threatId: last?.threatId },
    ]);
  });

  it('comes right after the lastThreat slow-mo starts, in the same step', async () => {
    const { events } = await play({ waves: PAIR, durationMs: 6000 });
    const [finale] = only(events, 'FinaleReached');
    expect(finale).toBeDefined();
    const sameStep = events.filter((event) => event.t === finale?.t).map((event) => event.type);
    const slowMoAt = sameStep.lastIndexOf('TimeScaleChanged');
    expect(slowMoAt).toBeGreaterThanOrEqual(0);
    expect(sameStep.indexOf('FinaleReached')).toBe(slowMoAt + 1);
  });

  it('a two-wave level: the last of wave 0 has none, the last of wave 1 has it', async () => {
    const waves = [
      testWave([OUTLET], { fromMs: 0, lullMs: 2000 }),
      testWave([STAIRS], { fromMs: 3000, lullMs: 2500 }),
    ];
    const { events } = await play({ waves, durationMs: 6000 });
    const waveOf = new Map(
      only(events, 'ThreatTelegraphed').map((event) => [event.threatId, event.waveIndex]),
    );
    const won = successes(events);
    expect(won.map((event) => waveOf.get(event.threatId))).toEqual([0, 1]);
    // Both were the last of their wave (two lastThreat slow-mos), but only the level's last is the finale.
    const slowDowns = only(events, 'TimeScaleChanged').filter((event) => event.to < event.from);
    expect(slowDowns.length).toBeGreaterThanOrEqual(2);
    expect(only(events, 'FinaleReached')).toEqual([
      { type: 'FinaleReached', t: won[1]?.t, cause: 'lastWave', threatId: won[1]?.threatId },
    ]);
  });

  it('a fail on the last threat has none', async () => {
    const { events } = await play({
      waves: [testWave([OUTLET], { lullMs: 5000 })],
      durationMs: 6000,
      isAnswered: false,
    });
    expect(only(events, 'GagTriggered').length).toBeGreaterThan(0);
    expect(only(events, 'FinaleReached')).toEqual([]);
  });

  it('a micro-sleep answered after the last wave closed has none (no wave planned it)', async () => {
    const tired: ContentBundle = {
      ...content,
      feel: {
        ...content.feel,
        fatigue: {
          ...content.feel.fatigue,
          startPoints: 90,
          microSleepMinMs: 6000,
          microSleepMaxMs: 6000,
        },
      },
    };
    // The outlet is left alone (its gags close the wave with no success), the micro-sleep is answered.
    const { events } = await play({
      waves: [testWave([OUTLET], { lullMs: 10_000 })],
      durationMs: 12_000,
      skipDefs: ['outlet'],
      withContent: tired,
      withFatigue: true,
    });
    const microSleeps = only(events, 'ThreatTelegraphed').filter(
      (event) => event.kind === 'papa_microsleep',
    );
    expect(microSleeps.length).toBeGreaterThan(0);
    expect(microSleeps[0]?.t).toBeGreaterThan(2000);
    expect(successes(events).length).toBeGreaterThan(0);
    expect(only(events, 'FinaleReached')).toEqual([]);
  });

  it('a level with a bedtime cycle has none from its waves: the cycle is the win (review of 7.4)', async () => {
    // The frozen bedroom has waves AND a cycle. The wave closes at 1 s (a 100 s level, a 99 s lull) and
    // the first interlude is 20 s: the last wave's last success comes well before any sequence.
    const sim = await createSim({
      content,
      geometry: createTestCycleGeometry(),
      level: createTestCycleLevel({
        durationMs: 100_000,
        waves: [
          testWave([OUTLET], { lullMs: 99_000, gapMinMs: 200, gapMaxMs: 300, maxSimultaneous: 1 }),
        ],
        sequences: ['bedtime_duel'],
        cycle: {
          entries: [{ sequence: 'bedtime_duel', interludeMs: 20_000 }],
          retryInterludeMs: 2000,
          gatherMaxMs: 6000,
        },
      }),
      seed: 1,
    });
    const events: SimEvent[] = [];
    const pressed = new Set<number>();
    while (sim.world.flow.state !== 'ended' && sim.world.time.sim < 12_000) {
      for (const threat of sim.world.threats) {
        if (threat.state !== 'windowOpen' || pressed.has(threat.id)) continue;
        pressed.add(threat.id);
        const t = sim.world.time.sim;
        sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: threat.id });
        sim.enqueue({ type: 'Release', t: asSimMs(t + SUCCESS_RELEASE_AFTER_MS) });
      }
      sim.step();
      events.push(...sim.drainEvents());
    }
    // A success was the last of its wave (a lastThreat slow-mo), and still no finale.
    expect(successes(events).length).toBeGreaterThan(0);
    expect(only(events, 'TimeScaleChanged').some((event) => event.to < event.from)).toBe(true);
    expect(only(events, 'FinaleReached')).toEqual([]);
  });

  it('a mamaWoke end in the step of the last success: the finale comes first (runThreats before runFlow)', async () => {
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({
        durationMs: 6000,
        waves: [testWave([OUTLET], { lullMs: 5000 })],
        gauges: { noise: {} },
      }),
      seed: 1,
    });
    const events: SimEvent[] = [];
    const pressed = new Set<number>();
    while (sim.world.flow.state !== 'ended') {
      for (const threat of sim.world.threats) {
        if (threat.state !== 'windowOpen' || pressed.has(threat.id)) continue;
        pressed.add(threat.id);
        const t = sim.world.time.sim;
        const releaseAt = asSimMs(t + SUCCESS_RELEASE_AFTER_MS);
        sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: threat.id });
        sim.enqueue({ type: 'Release', t: releaseAt });
        // Past 1 s the wave is closed: this success is the last, and the noise wakes Mama with it.
        if (t > 1000) sim.enqueue({ type: 'SetNoise', t: releaseAt, pct: 100 });
      }
      sim.step();
      events.push(...sim.drainEvents());
    }
    const [finale] = only(events, 'FinaleReached');
    expect(finale).toBeDefined();
    const sameStep = events.filter((event) => event.t === finale?.t).map((event) => event.type);
    expect(sameStep).toContain('LevelEnded');
    expect(sameStep.indexOf('FinaleReached')).toBeLessThan(sameStep.indexOf('MamaWoke'));
    expect(only(events, 'LevelEnded')).toMatchObject([{ reason: 'mamaWoke' }]);
  });
});
