import { MS_PER_S, STEP_MS } from '@shared/constants';
import { nextFloat, type RngState } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBedtimeEyes,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestOutlet,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { World } from '../world.ts';
import { isJudgeableBeforeEnd } from './judgeable.ts';
import { telegraphThreat } from './threatFsm.ts';

// The `wait` response (story 4.6) at the threat level: the one draw of the telegraph, the strict
// early rule, the window, `isJudgeableBeforeEnd`. The frozen eyes (`testBedtimeEyes.threat.json`)
// telegraph for 800 ms, then wait 2000 to 4000 ms for the signal; the frozen feel has a 300 ms
// window, a 60 ms tolerance and a 100 ms buffer.
const content = createTestContent();
const EYES = createTestBedtimeEyes();
const OUTLET_DEF = createTestOutlet();
const { telegraphDelayMs, minDelayMs, maxDelayMs } = EYES;
if (telegraphDelayMs === null || minDelayMs === undefined || maxDelayMs === undefined) {
  throw new Error('the frozen eyes lost a delay');
}

/** A world with the eyes on Papa and the outlet on its anchor, and a context that collects events. */
async function setup() {
  const sim = await createSim({
    content,
    geometry: createTestGeometry(),
    level: createTestLevel({
      waves: [testWave([OUTLET])],
      carry: CARRY,
      sequences: ['bedtime_duel'],
    }),
    seed: 1,
  });
  const world = sim.world as World;
  world.time.sim = asSimMs(500);
  const events: SimEvent[] = [];
  const ctx = {
    feel: content.feel,
    events,
    strictInvariants: true,
    t: world.time.sim,
    level: { microSleepIndex: -1 },
    requestFreezeRealMs: () => {},
  } as unknown as StepContext;
  const eyes = world.threats.find((threat) => threat.defId === EYES.id);
  const outlet = world.threats.find((threat) => threat.defId === OUTLET_DEF.id);
  if (eyes === undefined || outlet === undefined) throw new Error('a threat is missing');
  return { sim, world, ctx, events, eyes, outlet };
}

/** An rng state whose next `nextFloat` is exactly 0 (all zero) or the largest float below 1. */
const FLOAT_ZERO: RngState = { a: 0, b: 0, c: 0, d: 0 };
const FLOAT_MAX: RngState = { a: -1, b: 0, c: 0, d: 0 };

describe('the telegraph of a wait threat (story 4.6, D1)', () => {
  it('draws exactly one float, and a parry draws none', async () => {
    const { world, ctx, eyes, outlet } = await setup();
    const expected = { ...world.rng };
    nextFloat(expected);
    telegraphThreat(world, ctx, eyes, EYES, -1);
    expect(world.rng).toEqual(expected);

    const before = { ...world.rng };
    telegraphThreat(world, ctx, outlet, OUTLET_DEF, 0);
    expect(world.rng).toEqual(before);
  });

  it('puts the signal minDelayMs after the telegraph delay at the lowest draw', async () => {
    const { world, ctx, eyes } = await setup();
    world.rng = { ...FLOAT_ZERO };
    telegraphThreat(world, ctx, eyes, EYES, -1);
    expect(eyes.windowOpenAt).toBe(500 + telegraphDelayMs + minDelayMs);
  });

  it('puts the signal maxDelayMs after the telegraph delay at the highest draw', async () => {
    const { world, ctx, eyes } = await setup();
    world.rng = { ...FLOAT_MAX };
    telegraphThreat(world, ctx, eyes, EYES, -1);
    expect(eyes.windowOpenAt).toBe(500 + telegraphDelayMs + maxDelayMs);
  });

  it('rounds the instant to a whole ms, whatever the delays', async () => {
    const { world, ctx, eyes } = await setup();
    const odd = { ...EYES, minDelayMs: 1001, maxDelayMs: 2002 };
    // sfc32 from zero is not a draw of 0.5, so scan a few streams: every one must land whole and inside.
    for (let d = 0; d < 50; d++) {
      world.rng = { a: 0, b: 0, c: 0, d: d * 85_899_345 };
      telegraphThreat(world, ctx, eyes, odd, -1);
      const delayMs = eyes.windowOpenAt - 500 - telegraphDelayMs;
      expect(Number.isInteger(eyes.windowOpenAt)).toBe(true);
      expect(delayMs).toBeGreaterThanOrEqual(1001);
      expect(delayMs).toBeLessThanOrEqual(2002);
    }
  });

  it('freezes the window of the def through the tier', async () => {
    const { world, ctx, eyes, outlet } = await setup();
    world.difficultyTier = 'assistance';
    telegraphThreat(world, ctx, eyes, EYES, -1);
    telegraphThreat(world, ctx, outlet, OUTLET_DEF, 0);
    expect(eyes.responseWindow?.windowMs).toBe(content.feel.timing.windowMs * 1.5);
    expect(eyes.responseWindow).toEqual(outlet.responseWindow);
  });

  it('shrinks the window with fatigue, as for any other threat', async () => {
    const { world, ctx, eyes, outlet } = await setup();
    const tired = { ...ctx, level: { microSleepIndex: 0 } } as unknown as StepContext;
    world.gauges.fatigue = content.feel.fatigue.thresholdPoints + 1;
    telegraphThreat(world, tired, eyes, EYES, -1);
    telegraphThreat(world, tired, outlet, OUTLET_DEF, 0);
    const { windowPenaltyPct } = content.feel.fatigue;
    expect(eyes.responseWindow?.windowMs).toBe(
      content.feel.timing.windowMs * (1 - windowPenaltyPct / 100),
    );
    expect(eyes.responseWindow).toEqual(outlet.responseWindow);
  });
});

describe('isJudgeableBeforeEnd with a wait threat (story 4.6)', () => {
  it('counts the longest wait: the signal could be maxDelayMs late', async () => {
    const { world, ctx } = await setup();
    const { windowMs, toleranceMs } = content.feel.timing;
    const worstMs = 1000 + telegraphDelayMs + maxDelayMs + windowMs + toleranceMs;
    expect(isJudgeableBeforeEnd(world, ctx, EYES, 1000, worstMs)).toBe(true);
    expect(isJudgeableBeforeEnd(world, ctx, EYES, 1000, worstMs - 1)).toBe(false);
    // The same moment is plenty for a threat with no wait.
    expect(isJudgeableBeforeEnd(world, ctx, OUTLET_DEF, 1000, worstMs - 1)).toBe(true);
  });
});

/** A running duel, stopped on the step that telegraphed its first round. */
async function telegraphedRound() {
  const sim = await createSim({
    content,
    geometry: createTestGeometry(),
    level: createTestLevel({ carry: CARRY, sequences: ['bedtime_duel'] }),
    seed: 3,
  });
  sim.enqueue({ type: 'StartSequence', t: asSimMs(0), sequenceId: 'bedtime_duel' });
  const events: SimEvent[] = [];
  for (let i = 0; i < 1000; i++) {
    sim.step();
    events.push(...sim.drainEvents());
    if (events.some((event) => event.type === 'ThreatTelegraphed')) break;
  }
  const world = sim.world as World;
  const eyes = world.threats.find((threat) => threat.defId === EYES.id);
  if (eyes === undefined || eyes.state !== 'telegraph') throw new Error('no round telegraphed');
  return { sim, world, eyes, events };
}

function runTo(sim: Sim, untilMs: number): SimEvent[] {
  const events: SimEvent[] = [];
  while ((sim.world as World).time.sim < untilMs) {
    sim.step();
    events.push(...sim.drainEvents());
  }
  return events;
}

describe('the early rule of a wait threat (story 4.6, D2)', () => {
  it('a press stamped before the signal that reaches the sim after it is still early', async () => {
    const { sim, eyes } = await telegraphedRound();
    const { windowOpenAt } = eyes;
    // The window opens and nobody has pressed: the press then arrives, stamped 30 ms before it.
    runTo(sim, windowOpenAt + 2 * STEP_MS);
    expect(eyes.state).toBe('windowOpen');
    sim.enqueue({ type: 'PressThreat', t: asSimMs(windowOpenAt - 30), threatId: eyes.id });
    const events = runTo(sim, windowOpenAt + 4 * STEP_MS);
    expect(events.filter((event) => event.type === 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'wait', quality: 'fail', reason: 'early' }),
    ]);
  });

  it('a press at the signal itself is judged, not early', async () => {
    const { sim, eyes } = await telegraphedRound();
    const { windowOpenAt } = eyes;
    sim.enqueue({ type: 'PressThreat', t: asSimMs(windowOpenAt), threatId: eyes.id });
    sim.enqueue({ type: 'Release', t: asSimMs(windowOpenAt + 50) });
    const events = runTo(sim, windowOpenAt + MS_PER_S / 2);
    expect(events.filter((event) => event.type === 'ResponseResolved')).toEqual([
      expect.objectContaining({ response: 'wait', quality: 'success' }),
    ]);
  });

  it('keeps the expiry of an unanswered window: late, with no offset', async () => {
    const { sim, eyes } = await telegraphedRound();
    const { windowOpenAt } = eyes;
    const events = runTo(sim, windowOpenAt + MS_PER_S);
    expect(events.filter((event) => event.type === 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
  });
});
