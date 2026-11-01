import type { ThreatDef } from '@content/schemas/threat';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  CARRY,
  createTestBombDropLay,
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestOutlet,
} from '../../../tests/support/testContent.ts';
import type { StepContext } from '../context.ts';
import { createSim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { ThreatInstance, World } from '../world.ts';
import { openWindow, telegraphThreat } from './threatFsm.ts';

// A Firmness judged on its release (story 4.8) at the threat level, on the frozen `bomb_drop_lay`: a
// 2600 ms descent, a press within 700 ms of the telegraph, a 300 ms window. The frozen feel has a
// 60 ms tolerance, a 100 ms perfect zone and a 400 ms `holdMinMs`. Every bound comes from the def and
// the feel, never from a literal of the live content. The plain Firmness carried in the arms stays a
// `wrongResponse` (rule 12, `baby/carry.test.ts`).
const content = createTestContent();
const LAY = createTestBombDropLay();
const OUTLET_DEF = createTestOutlet();
const { release } = LAY;
if (release === undefined || LAY.telegraphDelayMs === null || LAY.windowMs === null) {
  throw new Error('the frozen bomb drop lost its release, its descent or its window');
}
// Function declarations below do not keep the narrowing above: plain numbers.
const telegraphDelayMs: number = LAY.telegraphDelayMs;
const windowMs: number = LAY.windowMs;
const { pressWithinMs } = release;
const { toleranceMs, perfectMs } = content.feel.timing;
const { holdMinMs } = content.feel.input;
const CENTRE_MS = windowMs / 2;

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

const gridCeil = (t: number) => Math.ceil(t / STEP_MS) * STEP_MS;

interface RoundOptions {
  readonly isCarried?: boolean;
  readonly earlyPress?: 'fail' | 'guard';
  readonly lagMs?: number;
}

/** A context that collects events, enough for the helpers of `threatFsm.ts` called by hand. */
const ctxOf = (world: World) =>
  ({
    feel: content.feel,
    events: [] as SimEvent[],
    strictInvariants: true,
    t: world.time.sim,
    level: { microSleepIndex: -1 },
    requestFreezeRealMs: () => {},
  }) as unknown as StepContext;

/**
 * A round of the drop inside its sequence (the baby is carried, as the sequence takes him), stopped on
 * the step that telegraphed it. `isCarried: false` sets the baby down by hand once it is telegraphed, so
 * that the same judgement runs without the arms: the rule must not read them.
 */
async function round({ isCarried = true, earlyPress = 'fail', lagMs = 0 }: RoundOptions = {}) {
  const feel = { ...content.feel, input: { ...content.feel.input, earlyPress } };
  const sim = await createSim({
    content: { ...content, feel },
    geometry: createTestGeometry(),
    level: createTestLevel({ carry: CARRY, sequences: ['bomb_drop'] }),
    seed: 1,
  });
  const world = sim.world as World;
  if (lagMs > 0) sim.enqueue({ type: 'SetInputLag', t: world.time.sim, lagMs });
  sim.enqueue({ type: 'StartSequence', t: world.time.sim, sequenceId: 'bomb_drop' });
  const threat = world.threats.find((candidate) => candidate.defId === LAY.id);
  if (threat === undefined) throw new Error('no bomb drop instance');
  const events: SimEvent[] = [];
  let rngBefore = { ...world.rng };
  for (let guard = 0; threat.state !== 'telegraph' && guard < 1000; guard++) {
    rngBefore = { ...world.rng };
    sim.step();
    events.push(...sim.drainEvents());
  }
  if (threat.state !== 'telegraph') throw new Error('the round did not telegraph');
  if (!isCarried) world.baby.state = 'wander';
  const enteredAt = threat.enteredAt;
  const openAt = threat.windowOpenAt;
  return {
    sim,
    world,
    threat,
    events,
    rngBefore,
    enteredAt,
    openAt,
    press: (t: number) => sim.enqueue({ type: 'PressThreat', t: asSimMs(t), threatId: threat.id }),
    release: (t: number) => sim.enqueue({ type: 'Release', t: asSimMs(t) }),
    runTo: (untilMs: number): SimEvent[] => {
      const seen: SimEvent[] = [];
      while (world.time.sim < untilMs) {
        sim.step();
        seen.push(...sim.drainEvents());
      }
      events.push(...seen);
      return seen;
    },
  };
}

/** The first result of one scripted round: its `ResponseResolved` events (a retreat starts the next round after it). */
async function resultOf(
  script: (r: Awaited<ReturnType<typeof round>>) => void,
  opts?: RoundOptions,
) {
  const r = await round(opts);
  script(r);
  const limit = r.openAt + windowMs + 2 * toleranceMs + 10 * STEP_MS;
  while (r.world.time.sim < limit && only(r.events, 'ResponseResolved').length === 0) {
    r.runTo(r.world.time.sim + STEP_MS);
  }
  return only(r.events, 'ResponseResolved');
}

describe('the telegraph of a release def (story 4.8)', () => {
  it('opens the window telegraphDelayMs later and draws nothing', async () => {
    const r = await round();
    expect(r.openAt).toBe(r.enteredAt + telegraphDelayMs);
    expect(r.world.rng).toEqual(r.rngBefore);
  });

  it('keeps no buffer for a release, and the feel buffer for any other def', async () => {
    const r = await round();
    expect(r.threat.responseWindow?.bufferMs).toBe(0);
    const ctx = ctxOf(r.world);
    const stub = { ...r.threat } as ThreatInstance;
    telegraphThreat(r.world, ctx, stub, OUTLET_DEF, 0);
    expect(stub.responseWindow?.bufferMs).toBe(content.feel.timing.bufferMs);
  });
});

describe('the signal of a release def (story 4.8)', () => {
  it('emits WaitSignalGiven right before WindowOpened', async () => {
    const r = await round();
    const ctx = ctxOf(r.world);
    openWindow(r.world, ctx, r.threat, LAY);
    expect(ctx.events.map((event) => event.type)).toEqual(['WaitSignalGiven', 'WindowOpened']);
  });

  it('emits only WindowOpened for a def with no signal cue', async () => {
    const r = await round();
    const ctx = ctxOf(r.world);
    openWindow(r.world, ctx, r.threat, OUTLET_DEF);
    expect(ctx.events.map((event) => event.type)).toEqual(['WindowOpened']);
  });
});

describe('the press of a release def (story 4.8, AC 3)', () => {
  it('keeps the press when it comes within pressWithinMs plus the tolerance of the telegraph', async () => {
    const results = await resultOf((r) => {
      r.press(r.enteredAt + pressWithinMs + toleranceMs);
      r.release(r.openAt + CENTRE_MS);
    });
    expect(results).toEqual([expect.objectContaining({ response: 'firm', quality: 'perfect' })]);
  });

  it('is late one ms after that', async () => {
    const results = await resultOf((r) => {
      r.press(r.enteredAt + pressWithinMs + toleranceMs + 1);
    });
    expect(results).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', response: 'firm' }),
    ]);
  });

  it('is late whatever its stamp when it reaches the sim in windowOpen', async () => {
    // Only an absurd input lag keeps the telegraph open that long without a press: the lag holds the verdict.
    const r = await round({ lagMs: telegraphDelayMs });
    r.runTo(r.openAt + STEP_MS);
    expect(r.threat.state).toBe('windowOpen');
    r.press(r.enteredAt + 100);
    r.runTo(r.openAt + 3 * STEP_MS);
    expect(only(r.events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late' }),
    ]);
  });

  it('gags late, with no offset, when nobody pressed in time', async () => {
    const r = await round();
    const lastGoodStep = gridCeil(r.enteredAt + pressWithinMs + toleranceMs);
    r.runTo(lastGoodStep);
    expect(r.threat.state).toBe('telegraph');
    r.runTo(lastGoodStep + STEP_MS);
    expect(r.threat.state).toBe('gag');
    expect(only(r.events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
  });

  it('waits for the input lag before it gags a missing press', async () => {
    const lagMs = 5 * STEP_MS;
    const r = await round({ lagMs });
    const lastGoodStep = gridCeil(r.enteredAt + pressWithinMs + toleranceMs + lagMs);
    r.runTo(lastGoodStep);
    expect(r.threat.state).toBe('telegraph');
    r.runTo(lastGoodStep + STEP_MS);
    expect(r.threat.state).toBe('gag');
  });
});

describe('the release of a release def (story 4.8, AC 3)', () => {
  const pressAndRelease = (releaseOffsetMs: number) => (r: Awaited<ReturnType<typeof round>>) => {
    r.press(r.enteredAt + 100);
    r.release(r.openAt + releaseOffsetMs);
  };

  it('is perfect at the centre of the window, with an offset of 0, and emits the hold ring once', async () => {
    const r = await round();
    r.press(r.enteredAt + 100);
    r.release(r.openAt + CENTRE_MS);
    r.runTo(r.openAt + CENTRE_MS + 4 * STEP_MS);
    const [result] = only(r.events, 'ResponseResolved');
    expect(result).toMatchObject({ response: 'firm', quality: 'perfect', offsetMs: 0 });
    expect(only(r.events, 'ResponseHeld')).toHaveLength(1);
    const order = r.events
      .map((event) => event.type)
      .filter((type) => ['WaitSignalGiven', 'WindowOpened', 'ResponseResolved'].includes(type));
    expect(order).toEqual(['WaitSignalGiven', 'WindowOpened', 'ResponseResolved']);
  });

  it.each([
    ['the perfect zone edge before the centre', -perfectMs / 2, 'perfect'],
    ['one ms outside it', -perfectMs / 2 - 1, 'success'],
    ['the perfect zone edge after the centre', perfectMs / 2, 'perfect'],
    ['the earliest success, the tolerance before the pose', -toleranceMs, 'success'],
    [
      'the latest success, the window and the tolerance after the pose',
      windowMs + toleranceMs,
      'success',
    ],
  ] as const)('is %s: %s', async (_name, offsetFromCentre, quality) => {
    const releaseOffsetMs =
      offsetFromCentre === -perfectMs / 2 ||
      offsetFromCentre === perfectMs / 2 ||
      offsetFromCentre === -perfectMs / 2 - 1
        ? CENTRE_MS + offsetFromCentre
        : offsetFromCentre;
    const results = await resultOf(pressAndRelease(releaseOffsetMs));
    expect(results).toEqual([expect.objectContaining({ quality })]);
  });

  it('is a released gag one ms before the tolerance, and a late gag one ms after the window', async () => {
    const early = await resultOf(pressAndRelease(-toleranceMs - 1));
    expect(early).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'released', response: 'firm' }),
    ]);
    const late = await resultOf(pressAndRelease(windowMs + toleranceMs + 1));
    expect(late).toEqual([expect.objectContaining({ quality: 'fail', reason: 'late' })]);
  });

  it('is a released gag at once, not a wrongResponse, for a quick tap', async () => {
    const r = await round();
    r.press(r.enteredAt + 100);
    r.release(r.enteredAt + 100 + 2 * STEP_MS);
    const seen = r.runTo(r.enteredAt + 100 + 6 * STEP_MS);
    expect(r.threat.state).toBe('gag');
    expect(only(seen, 'ResponseResolved')).toEqual([
      expect.objectContaining({ reason: 'released' }),
    ]);
    expect(only(seen, 'GagTriggered')).toEqual([
      expect.objectContaining({ gag: 'baby_woke_on_drop', reason: 'released' }),
    ]);
  });

  it('is judged on its own stamp when it reaches the sim after the window closed', async () => {
    const lagMs = 10 * STEP_MS;
    const r = await round({ lagMs });
    r.press(r.enteredAt + 100);
    // The window closed, the tolerance has passed, but the lag still holds the verdict.
    r.runTo(gridCeil(r.openAt + windowMs + toleranceMs) + 3 * STEP_MS);
    expect(r.threat.state).toBe('windowOpen');
    r.release(r.openAt + windowMs);
    r.runTo(r.world.time.sim + 3 * STEP_MS);
    expect(only(r.events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'success', offsetMs: windowMs - CENTRE_MS }),
    ]);
  });

  it('delays the late verdict of a hold by the input lag', async () => {
    const lagMs = 4 * STEP_MS;
    const r = await round({ lagMs });
    r.press(r.enteredAt + 100);
    const closesAt = r.openAt + windowMs + toleranceMs;
    r.runTo(gridCeil(closesAt + lagMs));
    expect(r.threat.state).toBe('windowOpen');
    r.runTo(gridCeil(closesAt + lagMs) + STEP_MS);
    expect(r.threat.state).toBe('gag');
  });

  it('never resolves a hold kept through the pose: it is late, with no offset', async () => {
    const r = await round();
    r.press(r.enteredAt + 100);
    r.runTo(r.openAt + windowMs + 2 * toleranceMs + 10 * STEP_MS);
    const results = only(r.events, 'ResponseResolved');
    expect(results).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
    expect(holdMinMs).toBeLessThan(telegraphDelayMs);
  });
});

describe('the options that must change nothing (story 4.8)', () => {
  const scripts: [string, (r: Awaited<ReturnType<typeof round>>) => void][] = [
    [
      'a perfect release',
      (r) => {
        r.press(r.enteredAt + 100);
        r.release(r.openAt + CENTRE_MS);
      },
    ],
    [
      'a tap',
      (r) => {
        r.press(r.enteredAt + 100);
        r.release(r.enteredAt + 140);
      },
    ],
    [
      'a press too late',
      (r) => {
        r.press(r.enteredAt + pressWithinMs + toleranceMs + 1);
      },
    ],
    [
      'a release before the pose',
      (r) => {
        r.press(r.enteredAt + 100);
        r.release(r.openAt - toleranceMs - 1);
      },
    ],
  ];

  it.each(scripts)('earlyPress: guard changes nothing for %s', async (_name, script) => {
    const fail = await resultOf(script, { earlyPress: 'fail' });
    const guard = await resultOf(script, { earlyPress: 'guard' });
    expect(guard).toEqual(fail);
    expect(fail).toHaveLength(1);
  });

  it.each(scripts)('carried or not, %s gives the same result', async (_name, script) => {
    const free = await resultOf(script, { isCarried: false });
    const carried = await resultOf(script, { isCarried: true });
    expect(carried).toEqual(free);
    expect(
      carried.some((result) => result.quality === 'fail' && result.reason === 'wrongResponse'),
    ).toBe(false);
  });
});

/** A def of the frozen content with `release` removed would be a plain firm: the schema keeps the two apart. */
describe('the def itself', () => {
  it('is a firm on Papa with a release and no holdUntilMs', () => {
    const def: ThreatDef = LAY;
    expect(def.response).toBe('firm');
    expect(def.target).toBe('papa');
    expect(def.holdUntilMs).toBeUndefined();
  });
});
