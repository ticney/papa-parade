import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  NOISE_GAUGES,
  stepN,
  TEST_OBJECTS,
} from '../../../tests/support/testContent.ts';
import type { StepContext, System } from '../context.ts';
import { createSim, createSimWithSystems, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import { SYSTEMS } from '../step.ts';
import type { World } from '../world.ts';
import { calmShareOf, tickCalm } from './calmTracker.ts';

const feel = createTestContent().feel;
const { calmNoiseThresholdPct, calmMaxPoints } = feel.mama;

/** A world with only what `tickCalm` reads, and a context with only the feel and the level's flag. */
function setup({ noisePct = 0, cryEndsAt = null as number | null, hasNoise = true } = {}) {
  const world = {
    gauges: { noisePct },
    baby: { cryEndsAt: cryEndsAt === null ? null : asSimMs(cryEndsAt) },
    score: { calmMs: 0 },
  } as unknown as World;
  const ctx = { feel, level: { hasNoise } } as unknown as StepContext;
  return { world, ctx };
}

describe('calmShareOf', () => {
  it('is the calm time over the played time', () => {
    expect(calmShareOf(0, 1000)).toBe(0);
    expect(calmShareOf(250, 1000)).toBe(0.25);
    expect(calmShareOf(1000, 1000)).toBe(1);
  });

  it('is 1 when no time was played, and never above 1', () => {
    expect(calmShareOf(0, 0)).toBe(1);
    expect(calmShareOf(500, 0)).toBe(1);
    expect(calmShareOf(2000, 1000)).toBe(1);
  });
});

describe('tickCalm: a level with a noise gauge (AC 6)', () => {
  it('counts one step while the noise is strictly below the threshold, and only then', () => {
    const rows: [number, number][] = [
      [0, STEP_MS],
      [calmNoiseThresholdPct - 0.01, STEP_MS],
      [calmNoiseThresholdPct, 0],
      [calmNoiseThresholdPct + 0.01, 0],
      [100, 0],
    ];
    for (const [noisePct, expected] of rows) {
      const { world, ctx } = setup({ noisePct });
      tickCalm(world, ctx);
      expect(world.score.calmMs, `noise at ${noisePct} %`).toBe(expected);
    }
  });

  it('adds whole steps, one per call', () => {
    const { world, ctx } = setup({ noisePct: 10 });
    for (let i = 0; i < 7; i++) tickCalm(world, ctx);
    expect(world.score.calmMs).toBe(7 * STEP_MS);
  });

  it('ignores the baby crying: the gauge is what counts', () => {
    const { world, ctx } = setup({ noisePct: 10, cryEndsAt: 5000 });
    tickCalm(world, ctx);
    expect(world.score.calmMs).toBe(STEP_MS);
  });
});

describe('tickCalm: a level with no noise gauge (AC 7)', () => {
  it('counts the steps where the baby is not crying, whatever the noise value', () => {
    const quiet = setup({ hasNoise: false, noisePct: 99 });
    tickCalm(quiet.world, quiet.ctx);
    expect(quiet.world.score.calmMs).toBe(STEP_MS);
    const crying = setup({ hasNoise: false, noisePct: 0, cryEndsAt: 5000 });
    tickCalm(crying.world, crying.ctx);
    expect(crying.world.score.calmMs).toBe(0);
  });
});

describe('the calm tracker through a real sim', () => {
  const DURATION_MS = 1000;

  async function newSim(options: { hasNoise?: boolean; durationMs?: number } = {}) {
    const { hasNoise = true, durationMs = DURATION_MS } = options;
    return createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel({ durationMs, gauges: hasNoise ? NOISE_GAUGES : {} }),
      seed: 3,
    });
  }

  it('counts the whole level, the ending step included, in a quiet game: the full calm row', async () => {
    const sim = await newSim();
    stepN(sim, DURATION_MS / STEP_MS);
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.score.calmMs).toBe(DURATION_MS);
    expect(sim.world.score.final?.calmPoints).toBe(calmMaxPoints);
  });

  it('counts nothing once the level has ended: the world is frozen from LevelEnded on', async () => {
    const sim = await newSim();
    stepN(sim, DURATION_MS / STEP_MS);
    const before = sim.world.score.calmMs;
    stepN(sim, 50);
    expect(sim.world.score.calmMs).toBe(before);
    expect(sim.world.time.sim).toBe(DURATION_MS + 50 * STEP_MS);
    expect(sim.world.score.final?.calmPoints).toBe(calmMaxPoints);
  });

  it('reads the noise of the same step (SetNoise lands before the tick) and shares the played time', async () => {
    const sim = await newSim();
    // Steps 1 to 40 end on a noisy room, steps 41 to 100 on a quiet one.
    sim.enqueue({
      type: 'SetNoise',
      t: asSimMs(sim.world.time.sim),
      pct: calmNoiseThresholdPct + 10,
    });
    stepN(sim, 40);
    expect(sim.world.score.calmMs).toBe(0);
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: 0 });
    stepN(sim, DURATION_MS / STEP_MS - 40);
    expect(sim.world.flow.state).toBe('ended');
    expect(sim.world.score.calmMs).toBe(DURATION_MS - 40 * STEP_MS);
    expect(sim.world.score.final?.calmPoints).toBe(
      Math.round(((DURATION_MS - 40 * STEP_MS) / DURATION_MS) * calmMaxPoints),
    );
  });

  it('uses the time actually played when Mama wakes: the share is over the steps run', async () => {
    const sim = await newSim({ durationMs: 60_000 });
    stepN(sim, 30);
    expect(sim.world.score.calmMs).toBe(30 * STEP_MS);
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: 100 });
    stepN(sim, 1);
    expect(sim.world.flow.state).toBe('ended');
    const playedMs = 31 * STEP_MS;
    expect(sim.world.time.sim).toBe(playedMs);
    // The step that woke her is a noisy one: 30 calm steps over 31.
    expect(sim.world.score.calmMs).toBe(30 * STEP_MS);
    expect(sim.world.score.final?.calmPoints).toBe(Math.round((300 / playedMs) * calmMaxPoints));
    // 19 + 30 = 49 points is 2 stars, and the woken Mama takes one off.
    expect(sim.world.score.final?.scorePoints).toBe(49);
    expect(sim.world.score.final?.lostStars).toBe(1);
  });

  it('in a level without a noise gauge counts the steps the baby does not cry', async () => {
    const sim = await newSim({ hasNoise: false });
    const world = sim.world as World;
    // The baby cries for 300 ms from the first step on.
    world.baby.cryStartedAt = asSimMs(0);
    world.baby.cryEndsAt = asSimMs(300);
    stepN(sim, DURATION_MS / STEP_MS);
    expect(sim.world.flow.state).toBe('ended');
    // He cries on the steps at 10, 20 ... 290 ms (29 steps); the step at 300 ms ends the cry.
    expect(sim.world.score.calmMs).toBe(DURATION_MS - 29 * STEP_MS);
    expect(sim.world.score.final?.calmPoints).toBe(
      Math.round(((DURATION_MS - 29 * STEP_MS) / DURATION_MS) * calmMaxPoints),
    );
  });

  it('a level without a noise gauge and without a cry gives the full calm row', async () => {
    const sim = await newSim({ hasNoise: false });
    stepN(sim, DURATION_MS / STEP_MS);
    expect(sim.world.score.final?.calmPoints).toBe(calmMaxPoints);
  });
});

describe('the calm tracker on the other ends of a level (AC 8)', () => {
  const NOISY_PCT = calmNoiseThresholdPct + 10;

  const setNoise = (sim: Sim, pct: number) =>
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct });

  const levelEndedOf = (events: readonly SimEvent[]) =>
    events.find(
      (event): event is Extract<SimEvent, { type: 'LevelEnded' }> => event.type === 'LevelEnded',
    );

  it('on a completed cycle, shares the calm over the time played, not the level length', async () => {
    const DURATION_MS = 60_000;
    // A hidden hand, right before `runFlow`, completes the bedtime cycle of a level that has none
    // (playing a whole cycle is not what this test is about).
    let isCycleDone = false;
    const hand: System = (world) => {
      if (isCycleDone && world.cycle.completedAt === null) world.cycle.completedAt = world.time.sim;
    };
    const sim = await createSimWithSystems(
      {
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel({ durationMs: DURATION_MS, gauges: NOISE_GAUGES }),
        seed: 3,
      },
      [...SYSTEMS.slice(0, -1), hand, ...SYSTEMS.slice(-1)],
    );
    setNoise(sim, NOISY_PCT);
    stepN(sim, 100);
    setNoise(sim, 0);
    stepN(sim, 199);
    isCycleDone = true;
    stepN(sim, 1);
    const ended = levelEndedOf(sim.drainEvents());
    expect(ended?.reason).toBe('cycleDone');
    const playedMs = 300 * STEP_MS;
    expect(ended?.t).toBe(playedMs);
    // 100 noisy steps, then 200 calm ones, the ending step included.
    expect(sim.world.score.calmMs).toBe(200 * STEP_MS);
    const calmPoints = Math.round(((200 * STEP_MS) / playedMs) * calmMaxPoints);
    expect(calmPoints).not.toBe(Math.round(((200 * STEP_MS) / DURATION_MS) * calmMaxPoints));
    expect(sim.world.score.final?.calmPoints).toBe(calmPoints);
  });

  it('on a timer end with a final rush, counts the rush and stops at LevelEnded (photo)', async () => {
    const DURATION_MS = 12_000;
    const content = createTestContent();
    content.feel.endOfLevel.doorSpillCount = 0;
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({
        durationMs: DURATION_MS,
        objects: TEST_OBJECTS,
        gauges: NOISE_GAUGES,
        finalRush: { spillAnchor: 'coffee_table' },
      }),
      seed: 3,
    });
    const rushAt = DURATION_MS - content.feel.endOfLevel.finalRushMs;
    // Calm until halfway through the rush, noisy from then on.
    const noisyFromMs = rushAt + (DURATION_MS - rushAt) / 2;
    stepN(sim, noisyFromMs / STEP_MS);
    expect(sim.world.flow.state).toBe('finalRush');
    setNoise(sim, NOISY_PCT);
    stepN(sim, (DURATION_MS - noisyFromMs) / STEP_MS);
    const ended = levelEndedOf(sim.drainEvents());
    expect(ended).toEqual({ type: 'LevelEnded', t: DURATION_MS, reason: 'timer' });
    expect(sim.world.flow.state).toBe('photo');
    const { calmMs } = sim.world.score;
    // The quiet steps of the rush count; the noisy ones do not (the gauge may only fall back late).
    expect(calmMs).toBeGreaterThanOrEqual(noisyFromMs);
    expect(calmMs).toBeLessThan(DURATION_MS);
    expect(sim.world.score.final?.calmPoints).toBe(
      Math.round((calmMs / DURATION_MS) * calmMaxPoints),
    );
    // The photo phase adds nothing.
    stepN(sim, 100);
    expect(sim.world.score.calmMs).toBe(calmMs);
  });
});
