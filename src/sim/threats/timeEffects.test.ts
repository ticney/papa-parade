import type { ContentBundle } from '@content/contentBundle';
import { STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
  createTestOutlet,
  outletEntry,
} from '../../../tests/support/testContent.ts';
import type { SimCommand } from '../commands.ts';
import { createSim, type Sim } from '../createSim.ts';
import type { SimEvent } from '../events.ts';

// Story 1.14: a successful response freezes the client (hitstop) and a perfect one also goes into
// slow-mo, both decided by `resolveThreat` from `feel.json`.

const content = createTestContent();
const { timing, input } = content.feel;
const outlet = createTestOutlet();
const OUTLET_ID = 1;

async function newSim(withContent: ContentBundle = content): Promise<Sim> {
  return createSim({
    content: withContent,
    geometry: createTestGeometry(),
    level: createTestLevel([outletEntry(0)]),
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
    sim.enqueue(release(center + 50));
    const frames = runTo(sim, center + 100);
    const resolving = frames.find((f) => only(f.events, 'ResponseResolved').length > 0);
    expect(resolving?.t).toBe(center + 50);
    expect(resolving?.events.map((e) => e.type)).toEqual(
      expect.arrayContaining(['ResponseResolved', 'TimeScaleChanged']),
    );
    const types = (resolving?.events ?? []).map((e) => e.type);
    expect(types.indexOf('TimeScaleChanged')).toBeGreaterThan(types.indexOf('ResponseResolved'));
    expect(only(resolving?.events ?? [], 'ResponseResolved')[0]?.quality).toBe('perfect');
    expect(only(resolving?.events ?? [], 'TimeScaleChanged')).toEqual([
      { type: 'TimeScaleChanged', t: center + 50, from: 1, to: timing.slowMoPerfect.timeScale },
    ]);
    expect(resolving?.freezeRealMs).toBe(timing.hitstopMs);
    expect(resolving?.timeScale).toBe(timing.slowMoPerfect.timeScale);
    // Nothing before the resolving step.
    for (const frame of frames.filter((f) => f.t < center + 50)) {
      expect(frame.freezeRealMs).toBe(0);
      expect(frame.timeScale).toBe(1);
    }
  });

  it('holds the scale for durationMs of sim time, ramps back, and is 1 at the end', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    sim.enqueue(release(center + 50));
    const resolvedAt = center + 50;
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
    sim.enqueue(release(center + 50));
    const frames = runTo(sim, center + 60);
    expect(frames.at(-1)?.freezeRealMs).toBe(0);
    expect(frames.at(-1)?.timeScale).toBe(timing.slowMoPerfect.timeScale);
  });

  it('plays the glide in slow-mo without changing it: sim time arrival, scale below 1', async () => {
    const { sim, center } = await telegraphed();
    sim.enqueue(press(center));
    sim.enqueue(release(center + 50));
    const pressed = runTo(sim, center + STEP_MS);
    expect(pressed.at(-1)?.timeScale).toBe(1);
    const glide = sim.world.papa.glide;
    if (glide === null) throw new Error('no glide after the press');
    const { arriveAt, startedAt } = glide;
    expect(arriveAt - startedAt).toBeLessThanOrEqual(content.feel.movement.glideMaxMs);
    const frames = runTo(sim, center + 50 + content.feel.movement.glideMaxMs + 2 * STEP_MS);
    const arrived = frames.find((f) => only(f.events, 'PapaArrived').length > 0);
    expect(arrived?.t).toBe(gridCeil(arriveAt));
    expect(arrived?.timeScale).toBeLessThan(1);
  });
});

describe('a successful (not perfect) parry', () => {
  it('freezes for hitstopMs and does not slow down', async () => {
    const { sim, openAt } = await telegraphed();
    sim.enqueue(press(openAt));
    sim.enqueue(release(openAt + 30));
    const frames = runTo(sim, openAt + 100);
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
    sim.enqueue(press(openAt - timing.toleranceMs - timing.bufferMs - 200));
    const frames = runTo(sim, openAt + 200);
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
  it('a window that opens during a slow-mo lasts as many sim ms as without it', async () => {
    const long = createTestContent();
    // Long enough to cover the next cycle: cooldown, then the telegraph delay, plus a margin.
    long.feel.timing.slowMoPerfect.durationMs =
      outlet.cooldownMs + (outlet.telegraphDelayMs ?? 0) + 3000;
    const { sim, center } = await telegraphed(long);
    sim.enqueue(press(center));
    sim.enqueue(release(center + 50));
    const resolvedAt = center + 50;
    const frames = runTo(
      sim,
      resolvedAt + outlet.cooldownMs + (outlet.telegraphDelayMs ?? 0) + 2000 + 5000,
    ).filter((f) => f.t > resolvedAt);
    const second = frames.filter((f) => only(f.events, 'WindowOpened').length > 0)[0];
    expect(second).toBeDefined();
    // The scale is still low when the second window opens.
    expect(second?.timeScale).toBe(timing.slowMoPerfect.timeScale);
    const telegraph = frames.find((f) => only(f.events, 'ThreatTelegraphed').length > 0);
    expect((second?.t ?? 0) - (telegraph?.t ?? 0)).toBe(outlet.telegraphDelayMs);
    const gag = frames.find((f) => only(f.events, 'GagTriggered').length > 0);
    // `windowMs + toleranceMs` of sim time later, to the step.
    expect(gag?.t).toBe(
      (second?.t ?? 0) + gridCeil(timing.windowMs + timing.toleranceMs) + STEP_MS,
    );
  });
});
