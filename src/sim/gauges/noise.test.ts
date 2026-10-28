import type { Feel } from '@content/schemas/feel';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';
import { addNoise, decayNoise, propImpactNoisePct } from './noise.ts';

const feel = createTestContent().feel;
const impact = feel.noise.sources.propImpact;

/** The slices `addNoise` touches, over nothing else: a real world is not needed to test a clamp. */
function setup({ hasNoise = true, noisePct = 0 } = {}) {
  const world = {
    time: { sim: asSimMs(500) },
    gauges: { noisePct, propNoiseAt: [] },
  } as unknown as World;
  const events: SimEvent[] = [];
  const ctx = { feel, events, level: { hasNoise } } as unknown as StepContext;
  return { world, ctx, events };
}

describe('addNoise (story 3.1: the only writer of noisePct)', () => {
  it('adds the points and emits NoiseChanged with the source, the new value and the change', () => {
    const { world, ctx, events } = setup({ noisePct: 10 });
    addNoise(world, ctx, 5, 'propImpact');
    expect(world.gauges.noisePct).toBe(15);
    expect(events).toEqual([
      { type: 'NoiseChanged', t: 500, source: 'propImpact', noisePct: 15, deltaPct: 5 },
    ]);
  });

  it('holds the value at 100, silently, and reports the change after the clamp', () => {
    const { world, ctx, events } = setup({ noisePct: 95 });
    addNoise(world, ctx, 15, 'babyCrying');
    expect(world.gauges.noisePct).toBe(100);
    expect(events).toEqual([
      { type: 'NoiseChanged', t: 500, source: 'babyCrying', noisePct: 100, deltaPct: 5 },
    ]);
    expect(events.map((event) => event.type)).not.toContain('InvariantViolated');
  });

  it('holds the value at 0, silently, and reports the change after the clamp', () => {
    const { world, ctx, events } = setup({ noisePct: 4 });
    addNoise(world, ctx, -30, 'debug');
    expect(world.gauges.noisePct).toBe(0);
    expect(events).toEqual([
      { type: 'NoiseChanged', t: 500, source: 'debug', noisePct: 0, deltaPct: -4 },
    ]);
  });

  it('emits nothing for a change of 0: already at 100, already at 0, or a zero amount', () => {
    const full = setup({ noisePct: 100 });
    addNoise(full.world, full.ctx, 15, 'propImpact');
    const empty = setup({ noisePct: 0 });
    addNoise(empty.world, empty.ctx, -5, 'debug');
    const zero = setup({ noisePct: 30 });
    addNoise(zero.world, zero.ctx, 0, 'sniff');
    expect([full.events, empty.events, zero.events]).toEqual([[], [], []]);
    expect([full.world, empty.world, zero.world].map((world) => world.gauges.noisePct)).toEqual([
      100, 0, 30,
    ]);
  });

  it('does nothing at all in a level with no noise gauge', () => {
    const { world, ctx, events } = setup({ hasNoise: false });
    addNoise(world, ctx, 50, 'propImpact');
    expect(world.gauges.noisePct).toBe(0);
    expect(events).toEqual([]);
  });
});

describe('decayNoise', () => {
  it('lowers the value with no event, down to 0', () => {
    const { world, ctx, events } = setup({ noisePct: 0.4 });
    decayNoise(world, ctx, -0.25);
    expect(world.gauges.noisePct).toBeCloseTo(0.15, 12);
    decayNoise(world, ctx, -0.25);
    expect(world.gauges.noisePct).toBe(0);
    expect(events).toEqual([]);
  });

  it('does nothing in a level with no noise gauge', () => {
    const { world, ctx } = setup({ hasNoise: false });
    decayNoise(world, ctx, 5);
    expect(world.gauges.noisePct).toBe(0);
  });
});

describe('propImpactNoisePct', () => {
  const at = (impulseNs: number) => propImpactNoisePct(feel, impulseNs);

  it('is minPct at minImpulseNs and maxPct at maxImpulseNs', () => {
    expect(at(impact.minImpulseNs)).toBe(impact.minPct);
    expect(at(impact.maxImpulseNs)).toBe(impact.maxPct);
  });

  it('is linear in between', () => {
    const mid = (impact.minImpulseNs + impact.maxImpulseNs) / 2;
    expect(at(mid)).toBeCloseTo((impact.minPct + impact.maxPct) / 2, 12);
  });

  it('is held at minPct below the range and at maxPct above it', () => {
    expect(at(0)).toBe(impact.minPct);
    expect(at(impact.minImpulseNs - 1)).toBe(impact.minPct);
    expect(at(impact.maxImpulseNs * 10)).toBe(impact.maxPct);
  });

  it('reads the feel it is given', () => {
    const tuned: Feel = {
      ...feel,
      noise: {
        ...feel.noise,
        sources: {
          ...feel.noise.sources,
          propImpact: { ...impact, minPct: 1, maxPct: 3, minImpulseNs: 1, maxImpulseNs: 3 },
        },
      },
    };
    expect(propImpactNoisePct(tuned, 2)).toBe(2);
  });
});
