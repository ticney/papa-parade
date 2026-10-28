import type { ContentBundle } from '@content/contentBundle';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestOutlet,
  OUTLET,
  testWave,
} from '../../../tests/support/testContent.ts';
import {
  PARRY_RELEASE_AFTER_MS,
  SLOW_MO_COVER_MARGIN_MS,
} from '../../../tests/support/timeEffects.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

// Story 1.14: a successful response freezes the client (hitstop) and a perfect one also goes into
// slow-mo, both decided by `resolveThreat` from `feel.json`.

const content = createTestContent();
const { timing, input } = content.feel;
const outlet = createTestOutlet();
const OUTLET_ID = 1;
/** Sim time to run past a resolution so that its events and freeze have been seen. */
const SETTLE_MS = 100;
/** A release this long after the window opens is a success, not a perfect (the centre is perfect). */
const SUCCESS_RELEASE_AFTER_MS = 30;
/** A press this far before the buffer and tolerance is an early gag. */
const EARLY_PRESS_MARGIN_MS = 200;

async function newSim(withContent: ContentBundle = content): Promise<Sim> {
  return createSim({
    content: withContent,
    geometry: createTestGeometry(),
    level: createTestLevel({ waves: [testWave([OUTLET])] }),
    seed: 1,
  });
}

const press = (t: number): SimCommand => ({
  type: 'PressThreat',
  t: asSimMs(t),
  threatId: OUTLET_ID,
});
const release = (t: number): SimCommand => ({ type: 'Release', t: asSimMs(t) });

type Of<T extends SimEvent['type']> = Extract<SimEvent, { type: T }>;
const only = <T extends SimEvent['type']>(events: readonly SimEvent[], type: T): Of<T>[] =>
  events.filter((event): event is Of<T> => event.type === type);

interface Frame {
  t: number;
  events: readonly SimEvent[];
  timeScale: number;
  freezeRealMs: number;
}

/** Steps up to `untilSimMs`, recording what each step emitted and the scale and freeze it left. */
function runTo(sim: Sim, untilSimMs: number): Frame[] {
  const frames: Frame[] = [];
  while (sim.world.time.sim < untilSimMs) {
    sim.step();
    frames.push({
      t: sim.world.time.sim,
      events: [...sim.drainEvents()],
      timeScale: sim.timeScale,
      freezeRealMs: sim.freezeRealMs,
    });
  }
  return frames;
}

const eventsOf = (frames: readonly Frame[]): SimEvent[] => frames.flatMap((f) => f.events);

/** A sim stopped on the step that telegraphed the outlet, with the window it will judge. */
async function telegraphed(withContent: ContentBundle = content) {
  const sim = await newSim(withContent);
  sim.step();
  sim.drainEvents();
  const threat = sim.world.threats[0];
  if (threat === undefined || threat.responseWindow === null) throw new Error('not telegraphed');
  const { windowOpenAt, responseWindow } = threat;
  return { sim, openAt: windowOpenAt, center: windowOpenAt + responseWindow.windowMs / 2 };
}

const gridCeil = (t: number) => Math.ceil(t / STEP_MS) * STEP_MS;

describe('a perfect parry', () => {
  it('freezes for hitstopMs and goes into slow-mo at the step that resolves it', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    sim.enqueue(release(center + PARRY_RELEASE_AFTER_MS));
    const frames = runTo(sim, center + SETTLE_MS);
    const resolving = frames.find((f) => only(f.events, 'ResponseResolved').length > 0);
    expect(resolving?.t).toBe(center + PARRY_RELEASE_AFTER_MS);
    expect(resolving?.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['ResponseResolved', 'TimeScaleChanged']),
    );
    const types = (resolving?.events ?? []).map((e) => e.type);
    expect(types.indexOf('TimeScaleChanged')).toBeGreaterThan(types.indexOf('ResponseResolved'));
    expect(only(resolving?.events ?? [], 'ResponseResolved')[0]?.quality).toBe('perfect');
    expect(only(resolving?.events ?? [], 'TimeScaleChanged')).toEqual([
      {
        type: 'TimeScaleChanged',
        t: center + PARRY_RELEASE_AFTER_MS,
        from: 1,
        to: timing.slowMoPerfect.timeScale,
      },
    ]);
    expect(resolving?.freezeRealMs).toBe(timing.hitstopMs);
    expect(resolving?.timeScale).toBe(timing.slowMoPerfect.timeScale);
    // Nothing before the resolving step.
    for (const frame of frames.filter((f) => f.t < center + PARRY_RELEASE_AFTER_MS)) {
      expect(frame.freezeRealMs).toBe(0);
      expect(frame.timeScale).toBe(1);
    }
  });

  it('holds the scale for durationMs of sim time, ramps back, and is 1 at the end', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    sim.enqueue(release(center + PARRY_RELEASE_AFTER_MS));
    const resolvedAt = center + PARRY_RELEASE_AFTER_MS;
    const { timeScale, durationMs, returnMs } = timing.slowMoPerfect;
    const frames = runTo(sim, resolvedAt + durationMs + returnMs + 2 * STEP_MS).filter(
      (f) => f.t >= resolvedAt,
    );
    const at = (t: number) => frames.find((f) => f.t === gridCeil(t))?.timeScale;
    expect(at(resolvedAt)).toBe(timeScale);
    expect(at(resolvedAt + durationMs - STEP_MS)).toBe(timeScale);
    expect(at(resolvedAt + durationMs)).toBe(timeScale);
    expect(at(resolvedAt + durationMs + STEP_MS)).toBeGreaterThan(timeScale);
    expect(at(resolvedAt + durationMs + returnMs)).toBe(1);
    expect(at(resolvedAt + durationMs + returnMs - STEP_MS)).toBeLessThan(1);
    expect(sim.world.time.slowMos).toEqual([]);
  });

  it('still slows down when hitstopMs is 0, and requests no freeze', async () => {
    const noHitstop = createTestContent();
    noHitstop.feel.timing.hitstopMs = 0;
    const { sim, center } = await telegraphed(noHitstop);
    sim.enqueue(press(center));
    sim.enqueue(release(center + PARRY_RELEASE_AFTER_MS));
    const frames = runTo(sim, center + 60);
    expect(frames.at(-1)?.freezeRealMs).toBe(0);
    expect(frames.at(-1)?.timeScale).toBe(timing.slowMoPerfect.timeScale);
  });

  it('plays the glide in slow-mo without changing it: same sim arrival as without a slow-mo', async () => {
    /** One perfect parry: the glide it starts, when Papa arrives, and the scale at that step. */
    async function glideOf(withContent: ContentBundle) {
      const { sim, center } = await telegraphed(withContent);
      sim.enqueue(press(center));
      sim.enqueue(release(center + PARRY_RELEASE_AFTER_MS));
      const pressed = runTo(sim, center + STEP_MS);
      expect(pressed.at(-1)?.timeScale).toBe(1);
      const glide = sim.world.papa.glide;
      if (glide === null) throw new Error('no glide after the press');
      const frames = runTo(
        sim,
        center + PARRY_RELEASE_AFTER_MS + content.feel.movement.glideMaxMs + 2 * STEP_MS,
      );
      const arrived = frames.find((f) => only(f.events, 'PapaArrived').length > 0);
      return { glide, arrived };
    }

    const noSlowMo = createTestContent();
    noSlowMo.feel.timing.slowMoPerfect.timeScale = 1;
    const control = await glideOf(noSlowMo);
    const slowed = await glideOf(content);

    const { arriveAt, startedAt } = slowed.glide;
    expect(arriveAt - startedAt).toBeLessThanOrEqual(content.feel.movement.glideMaxMs);
    expect(arriveAt - startedAt).toBe(control.glide.arriveAt - control.glide.startedAt);
    expect(slowed.arrived?.t).toBe(gridCeil(arriveAt));
    expect(slowed.arrived?.t).toBe(control.arrived?.t);
    expect(control.arrived?.timeScale).toBe(1);
    expect(slowed.arrived?.timeScale).toBeLessThan(1);
  });
});

describe('a successful (not perfect) parry', () => {
  it('freezes for hitstopMs and does not slow down', async () => {
    const { sim, openAt } = await telegraphed();
    sim.enqueue(press(openAt));
    sim.enqueue(release(openAt + SUCCESS_RELEASE_AFTER_MS));
    const frames = runTo(sim, openAt + SETTLE_MS);
    const resolving = frames.find((f) => only(f.events, 'ResponseResolved').length > 0);
    expect(only(resolving?.events ?? [], 'ResponseResolved')[0]?.quality).toBe('success');
    expect(resolving?.freezeRealMs).toBe(timing.hitstopMs);
    expect(only(eventsOf(frames), 'TimeScaleChanged')).toEqual([]);
    expect(sim.timeScale).toBe(1);
    expect(sim.world.time.slowMos).toEqual([]);
  });
});

describe('a gag', () => {
  it('requests nothing: an early press', async () => {
    const { sim, openAt } = await telegraphed();
    sim.enqueue(press(openAt - timing.toleranceMs - timing.bufferMs - EARLY_PRESS_MARGIN_MS));
    const frames = runTo(sim, openAt + 2 * SETTLE_MS);
    expect(only(eventsOf(frames), 'GagTriggered')).toHaveLength(1);
    expect(sim.freezeRealMs).toBe(0);
    expect(only(eventsOf(frames), 'TimeScaleChanged')).toEqual([]);
  });

  it('requests nothing: a late miss', async () => {
    const { sim, openAt } = await telegraphed();
    const frames = runTo(sim, openAt + timing.windowMs + timing.toleranceMs + 2 * STEP_MS);
    expect(only(eventsOf(frames), 'GagTriggered')).toHaveLength(1);
    expect(sim.freezeRealMs).toBe(0);
    expect(only(eventsOf(frames), 'TimeScaleChanged')).toEqual([]);
  });

  it('requests nothing: the wrong response (a press held)', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    const frames = runTo(sim, center + input.holdMinMs + 2 * STEP_MS);
    expect(only(eventsOf(frames), 'GagTriggered')).toEqual([
      expect.objectContaining({ reason: 'wrongResponse' }),
    ]);
    expect(sim.freezeRealMs).toBe(0);
    expect(only(eventsOf(frames), 'TimeScaleChanged')).toEqual([]);
  });
});

describe('windows stay in sim time (ADR-002, AC 4)', () => {
  /** A perfect parry, then the second window of the outlet: when it opens, closes, and at what scale. */
  async function secondWindow(withContent: ContentBundle) {
    const { sim, center } = await telegraphed(withContent);
    sim.enqueue(press(center));
    sim.enqueue(release(center + PARRY_RELEASE_AFTER_MS));
    const resolvedAt = center + PARRY_RELEASE_AFTER_MS;
    const frames = runTo(
      sim,
      resolvedAt + outlet.cooldownMs + (outlet.telegraphDelayMs ?? 0) + 2 * SLOW_MO_COVER_MARGIN_MS,
    ).filter((f) => f.t > resolvedAt);
    const opened = frames.find((f) => only(f.events, 'WindowOpened').length > 0);
    const telegraph = frames.find((f) => only(f.events, 'ThreatTelegraphed').length > 0);
    const gag = frames.find((f) => only(f.events, 'GagTriggered').length > 0);
    if (opened === undefined || telegraph === undefined || gag === undefined) {
      throw new Error('the second cycle did not run to its end');
    }
    return { opened, telegraph, gag };
  }

  it('a window that opens during a slow-mo lasts as many sim ms as without it', async () => {
    // A hold long enough to cover the next cycle: cooldown, then the telegraph delay, plus a margin.
    const slowed = createTestContent();
    slowed.feel.timing.slowMoPerfect.durationMs =
      outlet.cooldownMs + (outlet.telegraphDelayMs ?? 0) + SLOW_MO_COVER_MARGIN_MS;
    // The control is the same level with a slow-mo that does not slow anything down.
    const control = createTestContent();
    control.feel.timing = {
      ...slowed.feel.timing,
      slowMoPerfect: { ...slowed.feel.timing.slowMoPerfect, timeScale: 1 },
    };

    const withSlowMo = await secondWindow(slowed);
    const without = await secondWindow(control);

    expect(without.opened.timeScale).toBe(1);
    expect(withSlowMo.opened.timeScale).toBe(timing.slowMoPerfect.timeScale);
    // Telegraph to opening, and opening to the close: the same sim ms, with or without the slow-mo.
    const telegraphToOpen = (r: typeof withSlowMo) => r.opened.t - r.telegraph.t;
    const openToClose = (r: typeof withSlowMo) => r.gag.t - r.opened.t;
    expect(telegraphToOpen(withSlowMo)).toBe(telegraphToOpen(without));
    expect(telegraphToOpen(withSlowMo)).toBe(outlet.telegraphDelayMs);
    expect(openToClose(withSlowMo)).toBe(openToClose(without));
    // The window closes on the first step strictly after `windowMs + toleranceMs`.
    expect(openToClose(withSlowMo)).toBeGreaterThanOrEqual(timing.windowMs + timing.toleranceMs);
    expect(openToClose(withSlowMo)).toBeLessThanOrEqual(
      gridCeil(timing.windowMs + timing.toleranceMs) + STEP_MS,
    );
  });
});

// Story 1.18: the last threat of a wave, answered well, also slows time (FR8: ×0.2 for 1.5 s).
describe('the last threat of a wave', () => {
  const { slowMoLastThreat } = timing;

  /**
   * A level whose only wave closes to new telegraphs at 1000 ms (a 6 s level with a 5 s lull), so
   * that the outlet telegraphed at 10 ms and answered around 1.3 s is the last threat of its wave.
   * `lullMs: 0` gives the same level without that rule: the wave never closes.
   */
  async function lastLevel(lullMs: number) {
    const sim = await createSim({
      content,
      geometry: createTestGeometry(),
      level: createTestLevel({ durationMs: 6000, waves: [testWave([OUTLET], { lullMs })] }),
      seed: 1,
    });
    sim.step();
    sim.drainEvents();
    const threat = sim.world.threats[0];
    if (threat === undefined || threat.responseWindow === null) throw new Error('not telegraphed');
    const { windowOpenAt, responseWindow } = threat;
    return { sim, openAt: windowOpenAt, center: windowOpenAt + responseWindow.windowMs / 2 };
  }

  it('starts the lastThreat slow-mo on a success: ×0.2 for 1500 ms of sim time', async () => {
    expect(slowMoLastThreat).toMatchObject({ timeScale: 0.2, durationMs: 1500 });
    const { sim, openAt } = await lastLevel(5000);
    sim.enqueue(press(openAt));
    sim.enqueue(release(openAt + SUCCESS_RELEASE_AFTER_MS));
    const frames = runTo(sim, openAt + SETTLE_MS);
    const resolving = frames.find((f) => only(f.events, 'ResponseResolved').length > 0);
    expect(only(resolving?.events ?? [], 'ResponseResolved')[0]?.quality).toBe('success');
    expect(only(resolving?.events ?? [], 'TimeScaleChanged')).toEqual([
      { type: 'TimeScaleChanged', t: resolving?.t, from: 1, to: slowMoLastThreat.timeScale },
    ]);
    expect(sim.world.time.slowMos).toEqual([
      expect.objectContaining({
        source: 'lastThreat',
        scale: slowMoLastThreat.timeScale,
        startedAt: resolving?.t,
        holdUntil: (resolving?.t ?? 0) + slowMoLastThreat.durationMs,
      }),
    ]);
    expect(resolving?.freezeRealMs).toBe(timing.hitstopMs);
  });

  it('adds it to the perfect slow-mo: both entries, and the scale is the slowest', async () => {
    const { sim, center } = await lastLevel(5000);
    sim.enqueue(press(center));
    sim.enqueue(release(center + PARRY_RELEASE_AFTER_MS));
    runTo(sim, center + SETTLE_MS);
    expect(sim.world.time.slowMos.map((slowMo) => slowMo.source).sort()).toEqual([
      'lastThreat',
      'perfect',
    ]);
    expect(sim.world.time.scale).toBe(
      Math.min(slowMoLastThreat.timeScale, timing.slowMoPerfect.timeScale),
    );
  });

  it('starts nothing on a gag', async () => {
    const { sim, openAt } = await lastLevel(5000);
    const frames = runTo(sim, openAt + timing.windowMs + timing.toleranceMs + 2 * STEP_MS);
    expect(only(eventsOf(frames), 'GagTriggered')).toHaveLength(1);
    expect(only(eventsOf(frames), 'TimeScaleChanged')).toEqual([]);
    expect(sim.world.time.slowMos).toEqual([]);
  });

  it('starts nothing when the wave is still open (not the last threat)', async () => {
    const { sim, openAt } = await lastLevel(0);
    sim.enqueue(press(openAt));
    sim.enqueue(release(openAt + SUCCESS_RELEASE_AFTER_MS));
    const frames = runTo(sim, openAt + SETTLE_MS);
    expect(only(eventsOf(frames), 'ResponseResolved')[0]?.quality).toBe('success');
    expect(only(eventsOf(frames), 'TimeScaleChanged')).toEqual([]);
    expect(sim.world.time.slowMos).toEqual([]);
  });
});
