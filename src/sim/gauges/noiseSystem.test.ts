import type { Feel } from '@content/schemas/feel';
import { BABY_CRYING_EVERY_MS, MS_PER_S, PHONE_RINGING_EVERY_MS, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CRYING_OUTLET,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  NOISE_GAUGES,
  stepN,
  TEST_OBJECTS,
  testPhoneEntry,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';
import { propImpactNoisePct } from './noise.ts';
import { runNoise } from './noiseSystem.ts';

const base = createTestContent();
const geometry = createTestGeometry();
const { noise } = base.feel;
const impact = noise.sources.propImpact;

/** Two props, a context that only collects events, and a clock: `runNoise` reads nothing else. */
function setup({ noisePct = 0, nowMs = 1000, hasNoise = true, feel = base.feel } = {}) {
  const world = {
    time: { sim: asSimMs(nowMs) },
    gauges: { noisePct, propNoiseAt: [null, null] },
    props: [{ id: 'mug_01' }, { id: 'book_01' }],
  } as unknown as World;
  const events: SimEvent[] = [];
  const ctx = { feel, events, level: { hasNoise } } as unknown as StepContext;
  return { world, ctx, events };
}

const hit = (t: number, propId: string, impulseNs: number): SimEvent => ({
  type: 'PropImpact',
  t: asSimMs(t),
  propId,
  impulseNs,
  otherPropId: null,
});

const DECAY_PER_STEP = (noise.decayPerSec * STEP_MS) / MS_PER_S;

describe('runNoise: the decay', () => {
  it('is exactly decayPerSec over one second (100 steps), with no event', () => {
    const { world, ctx, events } = setup({ noisePct: 50 });
    for (let i = 0; i < MS_PER_S / STEP_MS; i++) runNoise(world, ctx);
    expect(world.gauges.noisePct).toBeCloseTo(50 - noise.decayPerSec, 9);
    expect(events).toEqual([]);
  });

  it('stops at 0', () => {
    const { world, ctx } = setup({ noisePct: DECAY_PER_STEP / 2 });
    runNoise(world, ctx);
    runNoise(world, ctx);
    expect(world.gauges.noisePct).toBe(0);
  });

  it('does nothing in a level with no noise gauge, whatever the events', () => {
    const { world, ctx, events } = setup({ hasNoise: false });
    events.push(hit(1000, 'mug_01', 5));
    runNoise(world, ctx);
    expect(world.gauges.noisePct).toBe(0);
    expect(world.gauges.propNoiseAt).toEqual([null, null]);
    expect(events).toHaveLength(1);
  });
});

describe('runNoise: PropImpact', () => {
  it('adds the lerp of the impulse, after this step’s decay: min, mid, max and above', () => {
    const mid = (impact.minImpulseNs + impact.maxImpulseNs) / 2;
    const rows: [number, number][] = [
      [impact.minImpulseNs, impact.minPct],
      [mid, (impact.minPct + impact.maxPct) / 2],
      [impact.maxImpulseNs, impact.maxPct],
      [impact.maxImpulseNs * 5, impact.maxPct],
    ];
    for (const [impulseNs, expected] of rows) {
      const { world, ctx, events } = setup({ noisePct: 30 });
      events.push(hit(1000, 'mug_01', impulseNs));
      runNoise(world, ctx);
      expect(world.gauges.noisePct).toBeCloseTo(30 - DECAY_PER_STEP + expected, 9);
      expect(events.at(-1)).toMatchObject({
        type: 'NoiseChanged',
        source: 'propImpact',
        deltaPct: expect.closeTo(expected, 9),
      });
    }
    expect(propImpactNoisePct(base.feel, mid)).toBeGreaterThan(impact.minPct);
  });

  it('counts two impacts of the same prop less than samePropCooldownMs apart once', () => {
    const { world, ctx, events } = setup({ nowMs: 1000 });
    events.push(hit(1000, 'mug_01', impact.maxImpulseNs));
    runNoise(world, ctx);
    const after = world.gauges.noisePct;
    // 500 ms later: a bounce.
    world.time.sim = asSimMs(1500);
    events.length = 0;
    events.push(hit(1500, 'mug_01', impact.maxImpulseNs));
    runNoise(world, ctx);
    expect(world.gauges.noisePct).toBeCloseTo(after - DECAY_PER_STEP, 9);
    expect(events.filter((event) => event.type === 'NoiseChanged')).toEqual([]);
  });

  it('counts the same prop again once the window is over (the window is closed on the left)', () => {
    const { world, ctx, events } = setup({ nowMs: 1000 });
    events.push(hit(1000, 'mug_01', impact.maxImpulseNs));
    runNoise(world, ctx);
    world.time.sim = asSimMs(1000 + impact.samePropCooldownMs);
    events.length = 0;
    events.push(hit(world.time.sim, 'mug_01', impact.maxImpulseNs));
    runNoise(world, ctx);
    expect(events.filter((event) => event.type === 'NoiseChanged')).toHaveLength(1);
  });

  it('counts two props hit in the same step, each on its own', () => {
    const { world, ctx, events } = setup({ noisePct: 0 });
    events.push(
      hit(1000, 'mug_01', impact.maxImpulseNs),
      hit(1000, 'book_01', impact.maxImpulseNs),
    );
    runNoise(world, ctx);
    expect(world.gauges.noisePct).toBeCloseTo(2 * impact.maxPct, 9);
    expect(world.gauges.propNoiseAt).toEqual([1000, 1000]);
  });

  it('counts every impact when samePropCooldownMs is 0', () => {
    const feel: Feel = {
      ...base.feel,
      noise: {
        ...noise,
        sources: { ...noise.sources, propImpact: { ...impact, samePropCooldownMs: 0 } },
      },
    };
    const { world, ctx, events } = setup({ feel });
    events.push(hit(1000, 'mug_01', impact.maxImpulseNs));
    runNoise(world, ctx);
    world.time.sim = asSimMs(1010);
    events.length = 0;
    events.push(hit(1010, 'mug_01', impact.maxImpulseNs));
    runNoise(world, ctx);
    expect(events.filter((event) => event.type === 'NoiseChanged')).toHaveLength(1);
  });

  it('ignores an impact of a prop the world does not have', () => {
    const { world, ctx, events } = setup();
    events.push(hit(1000, 'ghost_01', impact.maxImpulseNs));
    runNoise(world, ctx);
    expect(world.gauges.noisePct).toBe(0);
  });
});

describe('runNoise: PhoneRinging and BabyCrying', () => {
  it('adds perSec × the contract period for each: +2 with the starting values', () => {
    const { world, ctx, events } = setup({ noisePct: 10 });
    events.push({ type: 'PhoneRinging', t: asSimMs(1000), objectId: 'phone' });
    runNoise(world, ctx);
    expect(world.gauges.noisePct).toBeCloseTo(
      10 - DECAY_PER_STEP + (noise.sources.phoneRinging.perSec * PHONE_RINGING_EVERY_MS) / MS_PER_S,
      9,
    );
    const crying = setup({ noisePct: 10 });
    crying.events.push({ type: 'BabyCrying', t: asSimMs(1000) });
    runNoise(crying.world, crying.ctx);
    expect(crying.world.gauges.noisePct).toBeCloseTo(
      10 - DECAY_PER_STEP + (noise.sources.babyCrying.perSec * BABY_CRYING_EVERY_MS) / MS_PER_S,
      9,
    );
    expect(crying.events.at(-1)).toMatchObject({ type: 'NoiseChanged', source: 'babyCrying' });
  });

  it('applies the events of the step in emission order, so the clamp is felt in order', () => {
    const { world, ctx, events } = setup({ noisePct: 97 });
    events.push(
      { type: 'BabyCrying', t: asSimMs(1000) },
      { type: 'PhoneRinging', t: asSimMs(1000), objectId: 'phone' },
    );
    runNoise(world, ctx);
    const changes = events.filter((event) => event.type === 'NoiseChanged');
    expect(changes.map((event) => event.source)).toEqual(['babyCrying', 'phoneRinging']);
    expect(world.gauges.noisePct).toBe(100);
  });
});

describe('runNoise: only this step’s events (D7)', () => {
  it('does not count again events of earlier steps left undrained in ctx.events', () => {
    const { world, ctx, events } = setup({ noisePct: 0, nowMs: 1000 });
    events.push(hit(1000, 'mug_01', impact.maxImpulseNs));
    runNoise(world, ctx);
    const afterFirst = world.gauges.noisePct;
    // The caller has not drained: the next step runs over the same array.
    world.time.sim = asSimMs(1010);
    runNoise(world, ctx);
    world.time.sim = asSimMs(1020);
    runNoise(world, ctx);
    expect(world.gauges.noisePct).toBeCloseTo(afterFirst - 2 * DECAY_PER_STEP, 9);
    expect(events.filter((event) => event.type === 'NoiseChanged')).toHaveLength(1);
  });

  it('does not read the NoiseChanged it pushed itself in the same step', () => {
    const { world, ctx, events } = setup({ noisePct: 0 });
    events.push({ type: 'BabyCrying', t: asSimMs(1000) });
    runNoise(world, ctx);
    expect(events.filter((event) => event.type === 'NoiseChanged')).toHaveLength(1);
  });
});

describe('the noise through a real sim', () => {
  async function newSim(
    options: { hasNoise?: boolean; waves?: ReturnType<typeof testWave>[] } = {},
  ) {
    const { hasNoise = true, waves = [] } = options;
    return createSim({
      content: base,
      geometry,
      level: createTestLevel({
        waves,
        objects: TEST_OBJECTS,
        gauges: hasNoise ? NOISE_GAUGES : {},
      }),
      seed: 1,
    });
  }

  const noiseEvents = (sim: Sim, from: SimEvent[] = []) => {
    for (const event of sim.drainEvents()) from.push(event);
    return from.filter((event) => event.type === 'NoiseChanged');
  };

  // Story 3.2: SetNoise lands after the step's decay, so the commanded value is the one the step
  // ends on (before, `SetNoise{pct: 100}` ended the step at 99.99 and could never wake Mama).
  it('SetNoise puts the value there through addNoise with the source debug, and clamps', async () => {
    const sim = await newSim();
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: 90 });
    stepN(sim, 1);
    expect(sim.world.gauges.noisePct).toBe(90);
    expect(noiseEvents(sim)).toEqual([
      expect.objectContaining({ source: 'debug', deltaPct: 90, noisePct: 90 }),
    ]);
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: -40 });
    stepN(sim, 1);
    expect(sim.world.gauges.noisePct).toBe(0);
    // Above the top it clamps to exactly 100, which wakes Mama (story 3.2): the level ends there.
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: 250 });
    stepN(sim, 1);
    expect(sim.world.gauges.noisePct).toBe(100);
    expect(sim.world.flow.state).toBe('ended');
  });

  it('ignores SetNoise in a level with no noise gauge', async () => {
    const sim = await newSim({ hasNoise: false });
    sim.enqueue({ type: 'SetNoise', t: asSimMs(sim.world.time.sim), pct: 60 });
    stepN(sim, 5);
    expect(sim.world.gauges.noisePct).toBe(0);
    expect(noiseEvents(sim)).toEqual([]);
  });

  it('a pushed prop makes noise once for one fall (5 to 15 %), through its bounces', async () => {
    const sim = await newSim();
    const events: SimEvent[] = [];
    // The mug on the coffee table is pushed off it.
    sim.enqueue({
      type: 'PushProp',
      t: asSimMs(0),
      propId: sim.world.props[0]?.id as string,
      impulseXNs: 1.5,
      impulseYNs: 0,
      impulseZNs: 0,
    });
    for (let i = 0; i < 300; i++) {
      sim.step();
      for (const event of sim.drainEvents()) events.push(event);
    }
    const impacts = events.filter((event) => event.type === 'PropImpact');
    const fall = events.filter(
      (event) => event.type === 'NoiseChanged' && event.source === 'propImpact',
    );
    // The expected count, from the impacts alone: per prop, one noise for the first impact and one
    // for each later impact at least `samePropCooldownMs` after the last one that counted.
    const lastCountedAt = new Map<string, number>();
    let expectedCount = 0;
    for (const event of impacts) {
      if (event.type !== 'PropImpact') continue;
      const last = lastCountedAt.get(event.propId);
      if (last !== undefined && event.t - last < impact.samePropCooldownMs) continue;
      lastCountedAt.set(event.propId, event.t);
      expectedCount++;
    }
    expect(fall).toHaveLength(expectedCount);
    expect(expectedCount).toBeGreaterThanOrEqual(1);
    // The cooldown has something to do: the fall bounces, so there are more impacts than noises.
    expect(impacts.length).toBeGreaterThan(fall.length);
    for (const event of fall) {
      if (event.type !== 'NoiseChanged') continue;
      expect(event.deltaPct).toBeGreaterThanOrEqual(impact.minPct - 1e-9);
      expect(event.deltaPct).toBeLessThanOrEqual(impact.maxPct + 1e-9);
    }
  });

  it('an ignored phone makes +2 % per ring (one per second), nothing from PhoneRingEnded', async () => {
    const sim = await newSim({
      waves: [testWave([], { disruptions: [testPhoneEntry(0)] })],
    });
    const events: SimEvent[] = [];
    for (let i = 0; i < 1600; i++) {
      sim.step();
      for (const event of sim.drainEvents()) events.push(event);
    }
    const rings = events.filter((event) => event.type === 'PhoneRinging').length;
    const fromPhone = events.filter(
      (event) => event.type === 'NoiseChanged' && event.source === 'phoneRinging',
    );
    expect(rings).toBeGreaterThan(5);
    expect(fromPhone).toHaveLength(rings);
    for (const event of fromPhone) {
      if (event.type === 'NoiseChanged') expect(event.deltaPct).toBeCloseTo(2, 9);
    }
  });

  it('a missed crying threat makes the baby cry: +2 % for each second of the cry', async () => {
    const sim = await createSim({
      content: base,
      geometry,
      level: createTestLevel({
        waves: [testWave([CRYING_OUTLET], { gapMinMs: 0, gapMaxMs: 0 })],
        gauges: NOISE_GAUGES,
      }),
      seed: 1,
    });
    const events: SimEvent[] = [];
    for (let i = 0; i < 1000; i++) {
      sim.step();
      for (const event of sim.drainEvents()) events.push(event);
    }
    const cries = events.filter((event) => event.type === 'BabyCrying').length;
    const fromCry = events.filter(
      (event) => event.type === 'NoiseChanged' && event.source === 'babyCrying',
    );
    expect(cries).toBe(3);
    expect(fromCry).toHaveLength(3);
  });

  it('is deterministic: the same seed gives the same journal and the same world', async () => {
    const run = async () => {
      const sim = await newSim({ waves: [testWave([], { disruptions: [testPhoneEntry(0)] })] });
      sim.enqueue({ type: 'SetNoise', t: asSimMs(0), pct: 33 });
      stepN(sim, 800);
      return JSON.stringify(sim.world);
    };
    expect(await run()).toBe(await run());
  });
});
