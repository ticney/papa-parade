import type { ContentBundle, LevelContent } from '@content/contentBundle';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';
import type { ThreatInstance } from '../world.ts';

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const content = createTestContent();
const geometry = createTestGeometry();
const { timing, input } = content.feel;
const OUTLET_ID = 1;

async function newSim(
  level: LevelContent = createTestLevel({ waves: [testWave([OUTLET])] }),
  withContent: ContentBundle = content,
): Promise<Sim> {
  return createSim({ content: withContent, geometry, level, seed: 1 });
}

const press = (t: number, threatId = OUTLET_ID): SimCommand => ({
  type: 'PressThreat',
  t: asSimMs(t),
  threatId,
});
const release = (t: number): SimCommand => ({ type: 'Release', t: asSimMs(t) });

/** Runs `steps` steps and returns the events they emitted. */
function run(sim: Sim, steps: number): SimEvent[] {
  const events: SimEvent[] = [];
  for (let i = 0; i < steps; i++) {
    sim.step();
    for (const event of sim.drainEvents()) events.push(event);
  }
  return events;
}

/** Runs until sim time reaches `untilSimMs` (a multiple of the step). */
function runTo(sim: Sim, untilSimMs: number): SimEvent[] {
  return run(sim, (untilSimMs - sim.world.time.sim) / STEP_MS);
}

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);
const threatOf = (sim: Sim, index = 0): Readonly<ThreatInstance> =>
  sim.world.threats[index] as ThreatInstance;
/** The events of the threat itself: the baby's and Papa's choreography are proved elsewhere. */
const threatEvents = (events: readonly SimEvent[]): SimEvent[] =>
  events.filter(
    (event) =>
      event.type === 'ThreatTelegraphed' ||
      event.type === 'WindowOpened' ||
      event.type === 'ResponseResolved' ||
      event.type === 'GagTriggered' ||
      event.type === 'ThreatRearmed',
  );

/** A sim stopped on the step that telegraphed the outlet. */
async function telegraphed(withContent: ContentBundle = content) {
  const sim = await newSim(createTestLevel({ waves: [testWave([OUTLET])] }), withContent);
  sim.step();
  sim.drainEvents();
  const { windowOpenAt, responseWindow } = threatOf(sim);
  if (responseWindow === null) throw new Error('the threat was not telegraphed');
  const center = windowOpenAt + responseWindow.windowMs / 2;
  return { sim, openAt: windowOpenAt, center, window: responseWindow };
}

describe('telegraph', () => {
  it('is announced at the first step at or after fromMs, with the delay of its def', async () => {
    const sim = await newSim(
      createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 95, gapMaxMs: 95 })] }),
    );
    const quiet = run(sim, 9);
    expect(threatEvents(quiet)).toEqual([]);
    expect(threatOf(sim).state).toBe('idle');
    const events = run(sim, 1);
    expect(only(events, 'ThreatTelegraphed')).toEqual([
      {
        type: 'ThreatTelegraphed',
        t: 100,
        threatId: 1,
        kind: 'outlet',
        anchorId: 'outlet_01',
        waveIndex: 0,
      },
    ]);
    expect(threatOf(sim)).toMatchObject({ state: 'telegraph', enteredAt: 100, windowOpenAt: 1300 });
  });

  it('freezes the window it will use: the feel base, the tolerance and the buffer', async () => {
    const { window } = await telegraphed();
    expect(window).toEqual({
      windowMs: timing.windowMs,
      perfectMs: timing.perfectMs,
      toleranceMs: timing.toleranceMs,
      bufferMs: timing.bufferMs,
    });
  });

  it('opens the window exactly 1200 ms of sim time after the telegraph', async () => {
    const { sim, openAt } = await telegraphed();
    expect(openAt).toBe(10 + 1200);
    const before = runTo(sim, openAt - STEP_MS);
    expect(only(before, 'WindowOpened')).toEqual([]);
    expect(threatOf(sim).state).toBe('telegraph');
    const at = run(sim, 1);
    expect(only(at, 'WindowOpened')).toEqual([{ type: 'WindowOpened', t: openAt, threatId: 1 }]);
    expect(threatOf(sim).state).toBe('windowOpen');
  });

  it('opens at the same sim time whatever the time scale (ADR-002)', async () => {
    const sim = await newSim();
    sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0.3 });
    const events = runTo(sim, 1300);
    expect(only(events, 'ThreatTelegraphed')[0]?.t).toBe(10);
    expect(only(events, 'WindowOpened')).toEqual([{ type: 'WindowOpened', t: 1210, threatId: 1 }]);
  });

  it('opens at the first step after an off-grid instant (a delay of 1205 ms)', async () => {
    const odd = createTestContent();
    const level = createTestLevel({ waves: [testWave([OUTLET])] });
    const def = level.threats.outlet;
    if (def === undefined) throw new Error('no outlet');
    const sim = await newSim(
      { ...level, threats: { outlet: { ...def, telegraphDelayMs: 1205 } } },
      odd,
    );
    sim.step();
    expect(threatOf(sim).windowOpenAt).toBe(1215);
    const events = runTo(sim, 1220);
    expect(only(events, 'WindowOpened')[0]?.t).toBe(1220);
  });

  it('takes the feel defaults when the def says null', async () => {
    const level = createTestLevel({ waves: [testWave([OUTLET])] });
    const def = level.threats.outlet;
    if (def === undefined) throw new Error('no outlet');
    const feel = createTestContent();
    feel.feel.timing.telegraphDelayDefaultMs = 900;
    feel.feel.timing.windowMs = 200;
    feel.feel.timing.perfectMs = 80;
    const sim = await newSim(
      { ...level, threats: { outlet: { ...def, telegraphDelayMs: null, windowMs: null } } },
      feel,
    );
    sim.step();
    expect(threatOf(sim).windowOpenAt).toBe(910);
    expect(threatOf(sim).responseWindow).toMatchObject({ windowMs: 200, perfectMs: 80 });
  });

  it('applies the difficulty tier of the feel to the base window', async () => {
    const feel = createTestContent();
    feel.feel.difficulty.normal.windowMultiplier = 1.5;
    const { window } = await telegraphed(feel);
    expect(window.windowMs).toBe(timing.windowMs * 1.5);
  });
});

describe('a perfect or successful Parry', () => {
  it('is perfect at the centre of the window and resolves at the release', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    sim.enqueue(release(center + 50));
    const events = runTo(sim, 1500);
    expect(only(events, 'ResponseResolved')).toEqual([
      {
        type: 'ResponseResolved',
        t: center + 50,
        threatId: 1,
        response: 'parry',
        quality: 'perfect',
        offsetMs: 0,
      },
    ]);
    expect(only(events, 'GagTriggered')).toEqual([]);
    expect(threatOf(sim)).toMatchObject({ state: 'resolved', press: null });
  });

  it('is a success at the start of the window, with its offset', async () => {
    const { sim, openAt, center } = await telegraphed();
    sim.enqueue(press(openAt));
    sim.enqueue(release(openAt + 30));
    const events = runTo(sim, 1500);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'success', offsetMs: openAt - center, t: openAt + 30 }),
    ]);
  });

  it('judges the press on its own t, not on the step that applies it (late enqueue)', async () => {
    const { sim, center } = await telegraphed();
    runTo(sim, center + 200);
    // The press happened at the centre but reaches the sim 200 ms later.
    sim.enqueue(press(center));
    sim.enqueue(release(center + 40));
    const events = runTo(sim, center + 400);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'perfect', offsetMs: 0 }),
    ]);
  });

  it('keeps a press made just before the window (the input buffer) and resolves it when the window opens', async () => {
    const { sim, openAt, center } = await telegraphed();
    const t = openAt - timing.toleranceMs - timing.bufferMs; // the first accepted instant
    sim.enqueue(press(t));
    sim.enqueue(release(t + 50));
    const before = runTo(sim, openAt - STEP_MS);
    expect(threatEvents(before)).toEqual([]);
    expect(threatOf(sim)).toMatchObject({ state: 'telegraph', press: { t, quality: 'success' } });
    const at = run(sim, 1);
    expect(threatEvents(at).map((event) => event.type)).toEqual([
      'WindowOpened',
      'ResponseResolved',
    ]);
    expect(only(at, 'ResponseResolved')[0]).toMatchObject({
      quality: 'success',
      offsetMs: t - center,
      t: openAt,
    });
  });

  it('accepts a press at the very end of the tolerance', async () => {
    const { sim, openAt, window } = await telegraphed();
    const t = openAt + window.windowMs + window.toleranceMs;
    sim.enqueue(press(t));
    sim.enqueue(release(t + 10));
    const events = runTo(sim, t + 100);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'success' }),
    ]);
  });

  it('judges a press on the last instant of the tolerance even when it is applied at the step that would expire the window', async () => {
    const { sim, openAt, window } = await telegraphed();
    const t = openAt + window.windowMs + window.toleranceMs; // 1570: applied at the 1570 step
    runTo(sim, t - STEP_MS);
    sim.enqueue(press(t));
    sim.enqueue(release(t));
    const events = runTo(sim, t + 50);
    expect(only(events, 'GagTriggered')).toEqual([]);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'success' }),
    ]);
  });
});

describe('a gag', () => {
  it('is an early press: ResponseResolved{fail, early} then GagTriggered, at the press step', async () => {
    const { sim, openAt, center } = await telegraphed();
    const t = openAt - timing.toleranceMs - timing.bufferMs - 1;
    sim.enqueue(press(t));
    const events = runTo(sim, openAt);
    expect(threatEvents(events)).toEqual([
      {
        type: 'ResponseResolved',
        t: 1050,
        threatId: 1,
        response: 'parry',
        quality: 'fail',
        reason: 'early',
        offsetMs: t - center,
      },
      { type: 'GagTriggered', t: 1050, threatId: 1, gag: 'outlet_hair', reason: 'early' },
    ]);
    expect(threatOf(sim)).toMatchObject({ state: 'gag', press: null });
    // No window ever opens for a threat that already failed.
    expect(only(runTo(sim, openAt + 500), 'WindowOpened')).toEqual([]);
  });

  it('is a miss when nothing is pressed: the window closes after the tolerance', async () => {
    const { sim, openAt, window } = await telegraphed();
    const closesAfter = openAt + window.windowMs + window.toleranceMs;
    const before = runTo(sim, closesAfter);
    expect(only(before, 'GagTriggered')).toEqual([]);
    expect(threatOf(sim).state).toBe('windowOpen');
    const events = run(sim, 1);
    expect(threatEvents(events)).toEqual([
      {
        type: 'ResponseResolved',
        t: closesAfter + STEP_MS,
        threatId: 1,
        response: 'parry',
        quality: 'fail',
        reason: 'late',
        offsetMs: null,
      },
      {
        type: 'GagTriggered',
        t: closesAfter + STEP_MS,
        threatId: 1,
        gag: 'outlet_hair',
        reason: 'late',
      },
    ]);
  });

  it('is a press after the tolerance, judged late with its offset', async () => {
    const { sim, openAt, center, window } = await telegraphed();
    const t = openAt + window.windowMs + window.toleranceMs + 1; // 1571
    runTo(sim, 1560);
    sim.enqueue(press(t)); // applied at the 1580 step, before the window would expire there
    const events = runTo(sim, 1600);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: t - center, t: 1580 }),
    ]);
    expect(only(events, 'GagTriggered')).toHaveLength(1);
  });

  it('is the wrong kind of response: a press held holdMinMs is not a Parry', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    const events = runTo(sim, center + input.holdMinMs + STEP_MS);
    const at = center + input.holdMinMs;
    expect(threatEvents(events).slice(1)).toEqual([
      expect.objectContaining({
        type: 'ResponseResolved',
        t: at,
        quality: 'fail',
        reason: 'wrongResponse',
        offsetMs: 0,
      }),
      expect.objectContaining({ type: 'GagTriggered', t: at, reason: 'wrongResponse' }),
    ]);
  });

  it('is wrong too when the release comes at holdMinMs', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    sim.enqueue(release(center + input.holdMinMs));
    const events = runTo(sim, center + input.holdMinMs + 50);
    expect(only(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ reason: 'wrongResponse' }),
    ]);
    // One before is a Parry.
    const other = await telegraphed();
    other.sim.enqueue(press(other.center));
    other.sim.enqueue(release(other.center + input.holdMinMs - 1));
    const parried = runTo(other.sim, other.center + input.holdMinMs + 50);
    expect(only(parried, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'perfect' }),
    ]);
  });

  it('is an event only: nothing of Papa or of the room changes because of it', async () => {
    const { sim, openAt, window } = await telegraphed();
    runTo(sim, openAt + window.windowMs + window.toleranceMs);
    const papa = structuredClone(sim.world.papa);
    const rest = { rng: structuredClone(sim.world.rng), nextId: sim.world.nextId };
    const events = run(sim, 1);
    expect(only(events, 'GagTriggered')).toHaveLength(1);
    expect(sim.world.papa).toEqual({ ...papa, prevXM: papa.xM, prevZM: papa.zM });
    expect({ rng: sim.world.rng, nextId: sim.world.nextId }).toEqual(rest);
  });

  it('cannot be undone by a later press: the threat is over', async () => {
    const { sim, openAt, center } = await telegraphed();
    sim.enqueue(press(openAt - 200));
    runTo(sim, openAt);
    expect(threatOf(sim).state).toBe('gag');
    sim.enqueue(press(center));
    sim.enqueue(release(center + 20));
    const events = runTo(sim, center + 100);
    expect(threatEvents(events)).toEqual([]);
  });
});

describe('earlyPress: guard', () => {
  async function guarded() {
    const feel = createTestContent();
    feel.feel.input.earlyPress = 'guard';
    return telegraphed(feel);
  }

  it('does not judge an early press: no event of the threat, but Papa sets off', async () => {
    const { sim, openAt } = await guarded();
    sim.enqueue(press(openAt - 400));
    const events = runTo(sim, openAt - 200);
    expect(threatEvents(events)).toEqual([]);
    expect(only(events, 'PapaGlideStarted')).toHaveLength(1);
    expect(threatOf(sim)).toMatchObject({ state: 'telegraph', press: null });
  });

  it('still resolves a new press in the window', async () => {
    const { sim, openAt, center } = await guarded();
    sim.enqueue(press(openAt - 400));
    runTo(sim, openAt - 100);
    sim.enqueue(press(center));
    sim.enqueue(release(center + 30));
    const events = runTo(sim, center + 100);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'perfect' }),
    ]);
  });

  it('still gags a late press', async () => {
    const { sim, openAt, window } = await guarded();
    const t = openAt + window.windowMs + window.toleranceMs + 100;
    sim.enqueue(press(t));
    const events = runTo(sim, t + 30);
    expect(only(events, 'GagTriggered')).toHaveLength(1);
  });
});

describe('commands that do nothing', () => {
  it('a Release with no pending press', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(release(center));
    const events = runTo(sim, center + 100);
    expect(threatEvents(events)).toEqual([only(events, 'WindowOpened')[0]]);
    expect(threatOf(sim).press).toBeNull();
  });

  it('a second PressThreat while one is pending', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    sim.enqueue(press(center + 20));
    sim.enqueue(release(center + 50));
    const events = runTo(sim, center + 100);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'perfect', offsetMs: 0 }),
    ]);
  });

  it('a press on a threat that does not exist', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center, 99));
    sim.enqueue(release(center + 20));
    const events = runTo(sim, center + 100);
    expect(only(events, 'ResponseResolved')).toEqual([]);
    expect(only(events, 'PapaGlideStarted')).toEqual([]);
  });

  it('a press on a threat that is idle', async () => {
    const sim = await newSim(
      createTestLevel({ waves: [testWave([OUTLET], { gapMinMs: 5000, gapMaxMs: 5000 })] }),
    );
    sim.enqueue(press(1000));
    sim.enqueue(release(1050));
    const events = runTo(sim, 1200);
    expect(threatEvents(events)).toEqual([]);
    expect(only(events, 'PapaGlideStarted')).toEqual([]);
    expect(threatOf(sim).state).toBe('idle');
  });

  it('a Release before the press it would end', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(release(center - 20));
    sim.enqueue(press(center));
    const events = runTo(sim, center + input.holdMinMs + 20);
    // The release came first: it does not end the press, which is held to holdMinMs.
    expect(only(events, 'GagTriggered')).toEqual([
      expect.objectContaining({ reason: 'wrongResponse' }),
    ]);
  });
});

describe('a pending press', () => {
  it('keeps the window from expiring while the finger is down', async () => {
    const { sim, center, window, openAt } = await telegraphed();
    sim.enqueue(press(center));
    const events = runTo(sim, openAt + window.windowMs + window.toleranceMs + 2 * STEP_MS);
    expect(only(events, 'GagTriggered')).toEqual([]);
    expect(threatOf(sim)).toMatchObject({ state: 'windowOpen', press: { t: center } });
  });
});

describe('the cycle', () => {
  it('rearms after the cooldown of its def and can be targeted again', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    sim.enqueue(release(center + 50));
    const resolvedAt = center + 50;
    const events = runTo(sim, resolvedAt + 6000 + 2 * STEP_MS);
    expect(only(events, 'ThreatRearmed')).toEqual([
      { type: 'ThreatRearmed', t: resolvedAt + 6000, threatId: 1 },
    ]);
    // Re-targeted as soon as the baby is free.
    const telegraphs = only(events, 'ThreatTelegraphed');
    expect(telegraphs.length).toBe(1);
    expect(telegraphs[0]?.t).toBeGreaterThanOrEqual(resolvedAt + 6000);
  });

  it('rearms after a gag too, with nothing left of the last cycle', async () => {
    const { sim, openAt, window } = await telegraphed();
    const gagAt = openAt + window.windowMs + window.toleranceMs + STEP_MS;
    const events = runTo(sim, gagAt + 6000);
    expect(only(events, 'ThreatRearmed')).toEqual([
      { type: 'ThreatRearmed', t: gagAt + 6000, threatId: 1 },
    ]);
    expect(threatOf(sim)).toMatchObject({
      state: 'idle',
      press: null,
      responseWindow: null,
      windowOpenAt: 0,
    });
  });
});

describe('several threats', () => {
  it('targets one at a time (the wave allows one), and each command names its threat', async () => {
    const level = createTestLevel({
      waves: [testWave([OUTLET, { def: 'outlet', anchor: 'phone' }])],
    });
    const sim = await newSim(level);
    const first = run(sim, 1);
    const telegraphed = only(first, 'ThreatTelegraphed').map((event) => event.threatId);
    expect(telegraphed).toHaveLength(1);
    // The director picks one of the two with the PRNG; the other stays idle.
    const idleId = telegraphed[0] === 1 ? 2 : 1;
    expect(sim.world.threats.map((threat) => threat.id)).toEqual([1, 2]);
    expect(sim.world.threats.find((threat) => threat.id === idleId)?.state).toBe('idle');
    // A press on the idle one does nothing.
    sim.enqueue(press(1200, idleId));
    const events = runTo(sim, 1250);
    expect(only(events, 'ResponseResolved')).toEqual([]);
  });
});

// Story 1.18 D13: two threats at once resolve one after the other with sequential taps (press,
// release, press, release); each press is classified on its own release.
describe('two threats active at once', () => {
  it('resolves both when they are tapped one after the other, each by its own id', async () => {
    const level = createTestLevel({
      waves: [testWave([OUTLET, { def: 'outlet', anchor: 'phone' }], { maxSimultaneous: 2 })],
    });
    const sim = await newSim(level);
    const events = run(sim, 3);
    const telegraphed = only(events, 'ThreatTelegraphed').map((event) => event.threatId);
    expect(telegraphed).toHaveLength(2);
    const [first, second] = telegraphed as [number, number];
    const openAt = Math.max(...sim.world.threats.map((threat) => threat.windowOpenAt));
    // Both windows are open by `openAt`; tap the first, then the second, inside both.
    sim.enqueue(press(openAt + 60, first));
    sim.enqueue(release(openAt + 100));
    sim.enqueue(press(openAt + 140, second));
    sim.enqueue(release(openAt + 180));
    const later = runTo(sim, openAt + 400);
    const resolved = only(later, 'ResponseResolved');
    expect(resolved.map((event) => event.threatId)).toEqual([first, second]);
    expect(resolved.every((event) => event.quality !== 'fail')).toBe(true);
    expect(only(later, 'GagTriggered')).toEqual([]);
  });
});

describe('a busy Papa (story 1.19 D6)', () => {
  const makeBusy = (sim: Sim): void => {
    const papa = sim.world.papa as Mutable<typeof sim.world.papa>;
    papa.state = 'asleep';
    papa.busyUntil = asSimMs(60_000);
  };

  it('ignores PressThreat: the threat opens, then ends in its gag (late)', async () => {
    const sim = await newSim();
    runTo(sim, 500);
    makeBusy(sim);
    const t = threatOf(sim).windowOpenAt + (threatOf(sim).responseWindow?.windowMs ?? 0) / 2;
    sim.enqueue(press(t));
    sim.enqueue(release(t + 50));
    const events = runTo(sim, t + 800);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'fail', reason: 'late', offsetMs: null }),
    ]);
  });

  it('still processes Release: a press made before the nap ends as it should', async () => {
    const sim = await newSim();
    runTo(sim, 500);
    const t = threatOf(sim).windowOpenAt + (threatOf(sim).responseWindow?.windowMs ?? 0) / 2;
    sim.enqueue(press(t));
    runTo(sim, t + STEP_MS);
    expect(threatOf(sim).press).not.toBeNull();
    makeBusy(sim);
    sim.enqueue(release(t + 100));
    const events = runTo(sim, t + 800);
    expect(only(events, 'ResponseResolved')).toEqual([
      expect.objectContaining({ quality: 'perfect' }),
    ]);
  });
});
