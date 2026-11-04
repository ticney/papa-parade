import type { Feel } from '@content/schemas/feel';
import type { ThreatCatastrophe } from '@content/schemas/threat';
import { DIFFICULTY_TIER_IDS, MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestContent } from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import type { SimEvent } from '../events.ts';
import type { FlowState } from '../flow/flowFsm.ts';
import type { World } from '../world.ts';
import { addCatastrophe, decayCatastrophe, runCatastrophe } from './catastrophe.ts';

const base = createTestContent();
const { catastrophe } = base.feel;
const NOW = 1000;
const CATEGORIES = ['nearMiss', 'mess', 'microSleep'] as const;

/**
 * Three threats whose defs declare a category (index-aligned with `world.threats`, ids 1 to 4), a
 * context that only collects events, and a clock: `runCatastrophe` reads nothing else.
 */
function setup({
  pct = 0,
  tier = 'normal',
  flow = 'playing',
  feel = base.feel,
}: {
  pct?: number;
  tier?: 'assistance' | 'normal' | 'experienced';
  flow?: FlowState;
  feel?: Feel;
} = {}) {
  const categories: ThreatCatastrophe[] = ['nearMiss', 'mess', 'microSleep', 'none'];
  const world = {
    time: { sim: asSimMs(NOW) },
    gauges: { catastrophePct: pct },
    flow: { state: flow },
    difficultyTier: tier,
    threats: categories.map((_, index) => ({ id: index + 1 })),
  } as unknown as World;
  const events: SimEvent[] = [];
  const ctx = {
    feel,
    events,
    level: { threats: categories.map((category) => ({ def: { catastrophe: category } })) },
  } as unknown as StepContext;
  return { world, ctx, events };
}

const gag = (threatId: number, t = NOW): SimEvent => ({
  type: 'GagTriggered',
  t: asSimMs(t),
  threatId,
  gag: 'outlet_hair',
  reason: 'late',
});

const resolved = (quality: 'perfect' | 'success' | 'fail', t = NOW): SimEvent =>
  ({
    type: 'ResponseResolved',
    t: asSimMs(t),
    threatId: 1,
    quality,
    windowMs: 1000,
    perfectMs: 200,
    toleranceMs: 60,
    bufferMs: 100,
    pressedAt: asSimMs(t),
    reason: null,
    // The fields the gauge does not read are not part of this test's business.
  }) as unknown as SimEvent;

const changed = (events: SimEvent[]) =>
  events.filter((event) => event.type === 'CatastropheChanged');

const DECAY_PER_STEP = (catastrophe.decayPerSec * STEP_MS) / MS_PER_S;

describe('runCatastrophe: the rise of a gag', () => {
  it.each(CATEGORIES)(
    'raises the gauge by risePct.%s at the normal tier, with the event',
    (category) => {
      const { world, ctx, events } = setup();
      events.push(gag(CATEGORIES.indexOf(category) + 1));
      runCatastrophe(world, ctx);
      expect(world.gauges.catastrophePct).toBeCloseTo(catastrophe.risePct[category], 9);
      expect(changed(events)).toEqual([
        {
          type: 'CatastropheChanged',
          t: NOW,
          source: category,
          catastrophePct: world.gauges.catastrophePct,
          deltaPct: world.gauges.catastrophePct,
        },
      ]);
    },
  );

  it.each(DIFFICULTY_TIER_IDS)(
    'multiplies the rise by the %s tier, and by nothing else',
    (tier) => {
      const multiplier = base.feel.difficulty[tier].catastropheMultiplier;
      const { world, ctx, events } = setup({ tier });
      events.push(gag(1));
      runCatastrophe(world, ctx);
      expect(world.gauges.catastrophePct).toBeCloseTo(catastrophe.risePct.nearMiss * multiplier, 9);
      // The tiers differ (the comparison can fail): half, one, one and a quarter.
      expect(base.feel.difficulty.assistance.catastropheMultiplier).toBeLessThan(
        base.feel.difficulty.normal.catastropheMultiplier,
      );
      expect(base.feel.difficulty.normal.catastropheMultiplier).toBeLessThan(
        base.feel.difficulty.experienced.catastropheMultiplier,
      );
    },
  );

  it('does not multiply the perfect drop or the decay by the tier', () => {
    for (const tier of DIFFICULTY_TIER_IDS) {
      const { world, ctx, events } = setup({ pct: 50, tier });
      events.push(resolved('perfect'));
      runCatastrophe(world, ctx);
      expect(world.gauges.catastrophePct).toBeCloseTo(
        50 - DECAY_PER_STEP - catastrophe.perfectDropPct,
        9,
      );
    }
  });

  it('adds up two gags of one step in emission order', () => {
    const { world, ctx, events } = setup();
    events.push(gag(1), gag(2));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBeCloseTo(
      catastrophe.risePct.nearMiss + catastrophe.risePct.mess,
      9,
    );
    expect(changed(events).map((event) => event.source)).toEqual(['nearMiss', 'mess']);
  });

  it('applies the step’s perfect drops before its rises, whatever the emission order', () => {
    const results = [
      [gag(1), resolved('perfect')],
      [resolved('perfect'), gag(1)],
    ].map((stepEvents) => {
      const { world, ctx, events } = setup({ pct: 100 - catastrophe.risePct.nearMiss / 2 });
      events.push(...(stepEvents as SimEvent[]));
      runCatastrophe(world, ctx);
      return {
        pct: world.gauges.catastrophePct,
        sources: changed(events).map((event) => event.source),
      };
    });
    // The drop lands first and the rise then reaches 100: the level ends in both orders.
    expect(results[0]).toEqual({ pct: 100, sources: ['perfect', 'nearMiss'] });
    expect(results[1]).toEqual(results[0]);
  });

  it('emits nothing for a threat whose category is none, and nothing for an unknown threat', () => {
    const { world, ctx, events } = setup();
    events.push(gag(4), gag(99));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBe(0);
    expect(changed(events)).toEqual([]);
  });

  it('holds the gauge at 100 and reports the change after the clamp', () => {
    const { world, ctx, events } = setup({ pct: 90 });
    events.push(gag(1));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBe(100);
    const [event] = changed(events);
    expect(event).toMatchObject({ catastrophePct: 100 });
    expect((event as { deltaPct: number }).deltaPct).toBeCloseTo(10 + DECAY_PER_STEP, 9);
  });

  it('emits no event when the gauge is already full and does not decay: a change of 0', () => {
    const feel: Feel = { ...base.feel, catastrophe: { ...catastrophe, decayPerSec: 0 } };
    const { world, ctx, events } = setup({ pct: 100, feel });
    events.push(gag(1));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBe(100);
    expect(changed(events)).toEqual([]);
  });

  it('only reads this step’s events: a gag of an earlier step is not counted again', () => {
    const { world, ctx, events } = setup();
    events.push(gag(1, NOW - STEP_MS));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBe(0);
    events.push(gag(2));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBeCloseTo(catastrophe.risePct.mess, 9);
  });

  it('counts a gag in a sequence like any other (the micro-sleep of stay_awake)', () => {
    const { world, ctx, events } = setup({ flow: 'sequence' });
    events.push(gag(3));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBeCloseTo(catastrophe.risePct.microSleep, 9);
    expect(changed(events)[0]).toMatchObject({ source: 'microSleep' });
  });
});

describe('runCatastrophe: the perfect drop', () => {
  it('takes perfectDropPct off a perfect, with a perfect event', () => {
    const { world, ctx, events } = setup({ pct: 40 });
    events.push(resolved('perfect'));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBeCloseTo(
      40 - DECAY_PER_STEP - catastrophe.perfectDropPct,
      9,
    );
    expect(changed(events)).toEqual([
      expect.objectContaining({ source: 'perfect', deltaPct: -catastrophe.perfectDropPct }),
    ]);
  });

  it('does nothing for a success, a fail or a beat', () => {
    const { world, ctx, events } = setup({ pct: 40 });
    events.push(resolved('success'), resolved('fail'), {
      type: 'BeatHit',
      t: asSimMs(NOW),
    } as unknown as SimEvent);
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBeCloseTo(40 - DECAY_PER_STEP, 9);
    expect(changed(events)).toEqual([]);
  });

  it('stops at 0 with no event when there is nothing to take off', () => {
    const { world, ctx, events } = setup({ pct: 0 });
    events.push(resolved('perfect'));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBe(0);
    expect(changed(events)).toEqual([]);
  });
});

describe('runCatastrophe: the decay', () => {
  it('is exactly decayPerSec over one second (100 steps), with no event', () => {
    const { world, ctx, events } = setup({ pct: 50 });
    for (let i = 0; i < MS_PER_S / STEP_MS; i++) runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBeCloseTo(50 - catastrophe.decayPerSec, 9);
    expect(events).toEqual([]);
  });

  it('runs before the step’s rises: a rise that overshoots ends the step on 100, not a decay step under', () => {
    const { world, ctx, events } = setup({ pct: 90 });
    events.push(gag(1));
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBe(100);
  });

  it('stops at 0', () => {
    const { world, ctx } = setup({ pct: DECAY_PER_STEP / 2 });
    runCatastrophe(world, ctx);
    runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBe(0);
  });
});

describe('the gauge in the final rush: frozen', () => {
  it('moves for nothing: no gag, no perfect, no decay, no event', () => {
    const { world, ctx, events } = setup({ pct: 60, flow: 'finalRush' });
    events.push(gag(1), gag(2), resolved('perfect'));
    runCatastrophe(world, ctx);
    for (let i = 0; i < 50; i++) runCatastrophe(world, ctx);
    expect(world.gauges.catastrophePct).toBe(60);
    expect(changed(events)).toEqual([]);
  });

  it('refuses the writers too, so that SetCatastrophe cannot move it either', () => {
    const { world, ctx, events } = setup({ pct: 60, flow: 'finalRush' });
    addCatastrophe(world, ctx, 40, 'debug');
    decayCatastrophe(world, -10);
    expect(world.gauges.catastrophePct).toBe(60);
    expect(events).toEqual([]);
  });

  it('is live in every other flow state the sim steps in', () => {
    for (const flow of ['playing', 'sequence'] as const) {
      const { world, ctx, events } = setup({ flow });
      events.push(gag(1));
      runCatastrophe(world, ctx);
      expect(world.gauges.catastrophePct, flow).toBeGreaterThan(0);
    }
  });
});

describe('addCatastrophe', () => {
  it('is the debug writer: sets through a delta, held to [0, 100], with source debug', () => {
    const { world, ctx, events } = setup({ pct: 30 });
    addCatastrophe(world, ctx, 250, 'debug');
    expect(world.gauges.catastrophePct).toBe(100);
    expect(changed(events)).toEqual([
      { type: 'CatastropheChanged', t: NOW, source: 'debug', catastrophePct: 100, deltaPct: 70 },
    ]);
    addCatastrophe(world, ctx, -500, 'debug');
    expect(world.gauges.catastrophePct).toBe(0);
    expect(changed(events).at(-1)).toMatchObject({ catastrophePct: 0, deltaPct: -100 });
  });

  it('emits nothing for a change of 0', () => {
    const { world, ctx, events } = setup({ pct: 30 });
    addCatastrophe(world, ctx, 0, 'debug');
    expect(events).toEqual([]);
  });
});
