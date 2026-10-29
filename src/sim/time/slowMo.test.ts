import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import type { SimEvent } from '../events.ts';
import { createWorld, type SlowMo, type World } from '../world.ts';
import { slowMoFactorAt, startSlowMo, updateTimeScale } from './slowMo.ts';

const { slowMoPerfect, slowMoLastThreat } = createTestContent().feel.timing;

function newWorld(): World {
  return createWorld({
    seed: 1,
    feel: createTestContent().feel,
    papaSpawn: { xM: 0, zM: 0 },
    babySpawn: { xM: 0, zM: 0 },
    firstWanderAt: asSimMs(0),
  });
}

/** A fake context over `world`: only what `startSlowMo` and `updateTimeScale` read. */
function newContext(world: World): StepContext & { events: SimEvent[] } {
  const events: SimEvent[] = [];
  return {
    strictInvariants: true,
    get t() {
      return world.time.sim;
    },
    events,
  } as unknown as StepContext & { events: SimEvent[] };
}

interface Rig {
  world: World;
  ctx: StepContext & { events: SimEvent[] };
  /** The effective scale at each step, from now until `untilMs`. */
  run(untilMs: number): number[];
}

function newRig(): Rig {
  const world = newWorld();
  const ctx = newContext(world);
  return {
    world,
    ctx,
    run(untilMs) {
      const scales: number[] = [];
      while (world.time.sim < untilMs) {
        world.time.sim = asSimMs(world.time.sim + STEP_MS);
        updateTimeScale(world, ctx);
        scales.push(world.time.scale);
      }
      return scales;
    },
  };
}

const ramp = (slowMo: SlowMo, t: number) => slowMoFactorAt(slowMo, t);

describe('slowMoFactorAt', () => {
  const slowMo: SlowMo = {
    source: 'perfect',
    scale: 0.3,
    startedAt: asSimMs(0),
    holdUntil: asSimMs(1000),
    endsAt: asSimMs(1300),
  };

  it('holds the scale until holdUntil, included', () => {
    expect(ramp(slowMo, 0)).toBe(0.3);
    expect(ramp(slowMo, 999)).toBe(0.3);
    expect(ramp(slowMo, 1000)).toBe(0.3);
  });

  it('is half way at the middle of the return (smoothstep(0.5) = 0.5)', () => {
    expect(ramp(slowMo, 1150)).toBeCloseTo(0.3 + (1 - 0.3) / 2, 12);
  });

  it('rises strictly over the return, within the bounds', () => {
    let previous = ramp(slowMo, 1000);
    for (let t = 1010; t < 1300; t += 10) {
      const factor = ramp(slowMo, t);
      expect(factor).toBeGreaterThan(previous);
      expect(factor).toBeLessThan(1);
      previous = factor;
    }
  });

  it('is 1 at and after endsAt', () => {
    expect(ramp(slowMo, 1300)).toBe(1);
    expect(ramp(slowMo, 5000)).toBe(1);
  });

  it('cuts back to 1 at once when the return is 0 (no NaN)', () => {
    const instant: SlowMo = { ...slowMo, endsAt: slowMo.holdUntil };
    expect(ramp(instant, 999)).toBe(0.3);
    expect(ramp(instant, 1000)).toBe(1);
    expect(Number.isNaN(ramp(instant, 1000))).toBe(false);
  });
});

describe('startSlowMo and updateTimeScale', () => {
  it('a slow-mo alone takes effect at once and is gone at the first step at or after endsAt', () => {
    const { world, ctx, run } = newRig();
    startSlowMo(world, ctx, 'perfect', slowMoPerfect);
    expect(world.time.scale).toBe(slowMoPerfect.timeScale);
    expect(ctx.events[0]).toEqual({
      type: 'TimeScaleChanged',
      t: 0,
      from: 1,
      to: slowMoPerfect.timeScale,
    });
    const endsAt = slowMoPerfect.durationMs + slowMoPerfect.returnMs;
    const scales = run(endsAt);
    expect(scales.at(-1)).toBe(1);
    expect(scales.at(-2)).toBeLessThan(1);
    expect(world.time.slowMos).toEqual([]);
    expect(world.time.scale).toBe(1);
    // Held, then rising, never below the slow-mo's scale.
    const heldSteps = slowMoPerfect.durationMs / STEP_MS;
    expect(scales.slice(0, heldSteps)).toEqual(Array(heldSteps).fill(slowMoPerfect.timeScale));
    expect(Math.min(...scales)).toBe(slowMoPerfect.timeScale);
  });

  it('removes an entry that ends off the step grid at the first step after it', () => {
    const { world, ctx, run } = newRig();
    startSlowMo(world, ctx, 'perfect', { timeScale: 0.5, durationMs: 15, returnMs: 0 });
    expect(run(10)).toEqual([0.5]);
    expect(run(20)).toEqual([1]);
    expect(world.time.slowMos).toEqual([]);
  });

  it('emits one TimeScaleChanged per change of the effective scale', () => {
    const { world, ctx, run } = newRig();
    startSlowMo(world, ctx, 'perfect', slowMoPerfect);
    run(slowMoPerfect.durationMs + slowMoPerfect.returnMs);
    const changes = ctx.events.filter((event) => event.type === 'TimeScaleChanged');
    // One entry, then one per step of the return.
    expect(changes).toHaveLength(1 + slowMoPerfect.returnMs / STEP_MS);
    let previous = 1;
    for (const change of changes) {
      expect(change).toMatchObject({ from: previous });
      previous = (change as { to: number }).to;
    }
    expect(previous).toBe(1);
  });

  describe('overlap rule (AC 3)', () => {
    it('re-triggering a source mid-hold keeps one entry: later end, same start', () => {
      const { world, ctx, run } = newRig();
      startSlowMo(world, ctx, 'perfect', slowMoPerfect);
      run(500);
      startSlowMo(world, ctx, 'perfect', slowMoPerfect);
      expect(world.time.slowMos).toEqual([
        {
          source: 'perfect',
          scale: slowMoPerfect.timeScale,
          startedAt: 0,
          holdUntil: 500 + slowMoPerfect.durationMs,
          endsAt: 500 + slowMoPerfect.durationMs + slowMoPerfect.returnMs,
        },
      ]);
    });

    it('re-triggering a source mid-return goes back to the slow scale at once', () => {
      const { world, ctx, run } = newRig();
      startSlowMo(world, ctx, 'perfect', slowMoPerfect);
      run(slowMoPerfect.durationMs + slowMoPerfect.returnMs / 2);
      expect(world.time.scale).toBeGreaterThan(slowMoPerfect.timeScale);
      startSlowMo(world, ctx, 'perfect', slowMoPerfect);
      expect(world.time.scale).toBe(slowMoPerfect.timeScale);
      expect(world.time.slowMos).toHaveLength(1);
    });

    it('a re-trigger keeps the slower scale and the later end', () => {
      const { world, ctx } = newRig();
      startSlowMo(world, ctx, 'perfect', { timeScale: 0.2, durationMs: 1000, returnMs: 100 });
      startSlowMo(world, ctx, 'perfect', { timeScale: 0.6, durationMs: 100, returnMs: 100 });
      expect(world.time.slowMos).toEqual([
        { source: 'perfect', scale: 0.2, startedAt: 0, holdUntil: 1000, endsAt: 1100 },
      ]);
    });

    it('two sources: the slowest factor wins at every step, and the longest one ends it', () => {
      const { world, ctx, run } = newRig();
      startSlowMo(world, ctx, 'perfect', slowMoPerfect);
      run(500);
      startSlowMo(world, ctx, 'lastThreat', slowMoLastThreat);
      const perfect = world.time.slowMos[0] as SlowMo;
      const lastThreat = world.time.slowMos[1] as SlowMo;
      expect(world.time.slowMos.map((slowMo) => slowMo.source)).toEqual(['perfect', 'lastThreat']);
      expect(world.time.scale).toBe(Math.min(slowMoPerfect.timeScale, slowMoLastThreat.timeScale));

      const lastEnd = Math.max(perfect.endsAt, lastThreat.endsAt);
      let t: number = world.time.sim;
      while (t < lastEnd) {
        t += STEP_MS;
        world.time.sim = asSimMs(t);
        updateTimeScale(world, ctx);
        const expected = Math.min(
          ...[perfect, lastThreat].map((slowMo) => slowMoFactorAt(slowMo, t)),
        );
        expect(world.time.scale).toBe(expected);
      }
      expect(world.time.scale).toBe(1);
      expect(world.time.slowMos).toEqual([]);
    });

    it('the slow-down lasts until the longest source has returned', () => {
      const { world, ctx, run } = newRig();
      startSlowMo(world, ctx, 'lastThreat', { timeScale: 0.2, durationMs: 100, returnMs: 100 });
      startSlowMo(world, ctx, 'perfect', { timeScale: 0.5, durationMs: 1000, returnMs: 100 });
      const scales = run(200);
      // The short, slower one has ended: the longer one takes over alone.
      expect(scales.at(-1)).toBe(0.5);
      expect(world.time.slowMos.map((slowMo) => slowMo.source)).toEqual(['perfect']);
      expect(run(1100).at(-1)).toBe(1);
    });

    it('is the same whichever source starts first within a step', () => {
      const ordered: ('perfect' | 'lastThreat')[][] = [
        ['perfect', 'lastThreat'],
        ['lastThreat', 'perfect'],
      ];
      const [forward, backward] = ordered.map((sources) => {
        const { world, ctx, run } = newRig();
        run(100);
        for (const source of sources) {
          startSlowMo(world, ctx, source, source === 'perfect' ? slowMoPerfect : slowMoLastThreat);
        }
        return run(3000);
      });
      expect(forward).toEqual(backward);
    });
  });

  describe('base scale', () => {
    it('without a slow-mo, the base scale is the effective scale', () => {
      const { world, ctx } = newRig();
      world.time.baseScale = 0.5;
      updateTimeScale(world, ctx);
      expect(world.time.scale).toBe(0.5);
    });

    it('a slow-mo goes under the base scale, then back to it (not to 1)', () => {
      const { world, ctx, run } = newRig();
      world.time.baseScale = 0.5;
      updateTimeScale(world, ctx);
      startSlowMo(world, ctx, 'perfect', slowMoPerfect);
      expect(world.time.scale).toBe(slowMoPerfect.timeScale);
      const scales = run(slowMoPerfect.durationMs + slowMoPerfect.returnMs);
      expect(Math.max(...scales)).toBe(0.5);
      expect(scales.at(-1)).toBe(0.5);
    });

    it('a base scale slower than the slow-mo wins throughout', () => {
      const { world, ctx, run } = newRig();
      world.time.baseScale = 0.2;
      updateTimeScale(world, ctx);
      startSlowMo(world, ctx, 'perfect', slowMoPerfect);
      const scales = run(slowMoPerfect.durationMs + slowMoPerfect.returnMs);
      expect(new Set(scales)).toEqual(new Set([0.2]));
    });
  });
});
