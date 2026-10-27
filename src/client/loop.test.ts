import { MAX_STEPS_PER_FRAME, RESUME_COUNTDOWN_MS, STEP_MS } from '@shared/constants';
import { createEmitter } from '@shared/emitter';
import { hashJson } from '@shared/hash';
import { log } from '@shared/log';
import { asRealMs, asSimMs } from '@shared/time';
import { createSim, type Sim, type SimEvent } from '@sim';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFakeScheduler } from '../../tests/support/fakeScheduler.ts';
import {
  createTestContent,
  createTestGeometry,
  createTestLevel,
} from '../../tests/support/testContent.ts';
import type { ClientEvents } from './app/clientEvents.ts';
import { createPauseController } from './app/pauseController.ts';
import { createGameLoop } from './loop.ts';
import { createTimeMap } from './timeMap.ts';

/** The scale handed to `SetTimeScale`: the only magic number of this file (see Testing standards). */
const SLOW_SCALE = 0.3;
/** One display frame in these tests: a step, so that scale 1 runs exactly one step per frame. */
const FRAME_MS = STEP_MS;

beforeAll(() => {
  // The warnings are asserted through `log.buffer()`; keep them out of the test output.
  log.setLevel('error');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function countWarnings(pattern: RegExp): number {
  return log.buffer().filter((entry) => entry.level === 'warn' && pattern.test(entry.message))
    .length;
}

/**
 * Wraps a real `Sim` so that a test can hold a freeze and count calls: `@sim` has no way to
 * request a hitstop yet (story 1.14). Everything else is the real sim.
 */
function createSimDouble(real: Sim) {
  let freezeRealMs = 0;
  let stepCalls = 0;
  const calls: string[] = [];
  const hooks: { afterStep?: (stepCall: number) => void; step?: () => void } = {};
  const sim: Sim = {
    enqueue: (command) => real.enqueue(command),
    step() {
      stepCalls++;
      calls.push('step');
      hooks.step?.();
      real.step();
      hooks.afterStep?.(stepCalls);
    },
    drainEvents() {
      calls.push('drain');
      return real.drainEvents();
    },
    get world() {
      return real.world;
    },
    get timeScale() {
      return real.timeScale;
    },
    get freezeRealMs() {
      return freezeRealMs;
    },
    consumeFreeze(realMs) {
      calls.push(`consume:${realMs}`);
      freezeRealMs = Math.max(0, freezeRealMs - realMs);
    },
    snapshot: () => real.snapshot(),
    restore: (snapshot, tail) => real.restore(snapshot, tail),
    journal: () => real.journal(),
  };
  return {
    sim,
    calls,
    hooks,
    get stepCalls() {
      return stepCalls;
    },
    setFreeze(ms: number) {
      freezeRealMs = ms;
    },
  };
}

async function createRig(options: { warnings?: string[] } = {}) {
  const double = createSimDouble(
    await createSim({
      content: createTestContent(),
      geometry: createTestGeometry(),
      level: createTestLevel(),
      seed: 1,
    }),
  );
  const scheduler = createFakeScheduler();
  const events = createEmitter<ClientEvents>();
  const pause = createPauseController({ events });
  const timeMap = createTimeMap({
    logger: { warn: (_channel, message) => options.warnings?.push(message) },
  });
  const alphas: number[] = [];
  const simEvents: SimEvent[] = [];
  const loop = createGameLoop({
    sim: double.sim,
    timeMap,
    pause,
    scheduler,
    render: (alpha) => {
      alphas.push(alpha);
      double.calls.push('render');
    },
    onSimEvent: (event) => {
      simEvents.push({ ...event });
      double.calls.push('event');
    },
  });
  loop.start();
  return {
    sim: double.sim,
    calls: double.calls,
    hooks: double.hooks,
    setFreeze: double.setFreeze,
    get stepCalls() {
      return double.stepCalls;
    },
    get freezeRealMs() {
      return double.sim.freezeRealMs;
    },
    scheduler,
    pause,
    timeMap,
    loop,
    alphas,
    simEvents,
    simMs: () => double.sim.world.time.sim as number,
    tick: (frameAtReal: number) => scheduler.tick(frameAtReal),
  };
}

type Rig = Awaited<ReturnType<typeof createRig>>;

/** Frames `spacingMs` apart, the first at `startAtReal`; returns the timestamp of the last one. */
function runFrames(rig: Rig, startAtReal: number, count: number, spacingMs: number): number {
  let at = startAtReal;
  for (let i = 0; i < count; i++) {
    rig.tick(at);
    if (i < count - 1) at += spacingMs;
  }
  return at;
}

describe('createGameLoop › fixed step', () => {
  it('runs no step on the first frame (no elapsed time), then one per STEP_MS of real time', async () => {
    const rig = await createRig();
    rig.tick(5000);
    expect(rig.loop.stats.stepsLastFrame).toBe(0);
    expect(rig.simMs()).toBe(0);
    for (let i = 1; i <= 7; i++) {
      rig.tick(5000 + i * FRAME_MS);
      expect(rig.loop.stats.stepsLastFrame).toBe(1);
    }
    expect(rig.simMs()).toBe(7 * STEP_MS);
    expect(rig.loop.stats.frames).toBe(8);
  });

  it('carries the remainder of a frame to the next and renders with alpha = remainder / STEP_MS', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.tick(2.5 * STEP_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(2);
    expect(rig.alphas.at(-1)).toBeCloseTo(0.5, 9);
    rig.tick(5 * STEP_MS); // 0.5 step left + 2.5 steps = 3 steps, nothing left
    expect(rig.loop.stats.stepsLastFrame).toBe(3);
    expect(rig.alphas.at(-1)).toBeCloseTo(0, 9);
    expect(rig.simMs()).toBe(5 * STEP_MS);
  });

  it('renders every frame with an alpha in [0, 1] for uneven frame spacings', async () => {
    const rig = await createRig();
    const spacings = [7, 13, 16.7, 33, 4, 10, 1, 25, 9.9, 0.1];
    let at = 1000;
    rig.tick(at);
    for (const spacing of spacings) {
      at += spacing;
      rig.tick(at);
    }
    expect(rig.alphas).toHaveLength(spacings.length + 1);
    for (const alpha of rig.alphas) {
      expect(alpha).toBeGreaterThanOrEqual(0);
      expect(alpha).toBeLessThan(1);
    }
    // Sim time is always a whole number of steps, whatever the frame spacing.
    expect(rig.simMs() % STEP_MS).toBe(0);
  });

  it('runs steps at timeScale × real time: 1 s of 10 ms frames after SetTimeScale gives 30 steps', async () => {
    const rig = await createRig();
    rig.sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: SLOW_SCALE });
    let at = 0;
    rig.tick(at);
    // Run until the command has been applied (it is processed by a step).
    for (let guard = 0; rig.sim.timeScale !== SLOW_SCALE && guard < 10; guard++) {
      at += FRAME_MS;
      rig.tick(at);
    }
    expect(rig.sim.timeScale).toBe(SLOW_SCALE);

    const stepsBefore = rig.stepCalls;
    const framesPerSecond = Math.round(1000 / FRAME_MS);
    for (let i = 0; i < framesPerSecond; i++) {
      at += FRAME_MS;
      rig.tick(at);
    }
    // ±1 for floating point; never a different step size.
    const steps = rig.stepCalls - stepsBefore;
    expect(steps).toBeGreaterThanOrEqual(29);
    expect(steps).toBeLessThanOrEqual(31);
    expect(rig.simMs() % STEP_MS).toBe(0);
  });
});

describe('createGameLoop › step cap and backlog', () => {
  it('runs at most MAX_STEPS_PER_FRAME steps after a stall and drops whole steps of the rest, with one warning', async () => {
    const rig = await createRig();
    rig.tick(0);
    const owedSteps = MAX_STEPS_PER_FRAME + 5;
    const before = countWarnings(/backlog/i);
    rig.tick(owedSteps * STEP_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(MAX_STEPS_PER_FRAME);
    expect(rig.simMs()).toBe(MAX_STEPS_PER_FRAME * STEP_MS);
    expect(rig.loop.stats.droppedBacklogMs).toBe(5 * STEP_MS);
    expect(rig.alphas.at(-1)).toBeCloseTo(0, 9);
    expect(countWarnings(/backlog/i)).toBe(before + 1);
  });

  it('keeps the sub-step remainder of a stall (it is not backlog)', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.tick((MAX_STEPS_PER_FRAME + 5) * STEP_MS + 0.25 * STEP_MS);
    expect(rig.loop.stats.droppedBacklogMs).toBe(5 * STEP_MS);
    expect(rig.alphas.at(-1)).toBeCloseTo(0.25, 9);
  });

  it('does not drop anything when exactly MAX_STEPS_PER_FRAME steps are owed', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.tick(MAX_STEPS_PER_FRAME * STEP_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(MAX_STEPS_PER_FRAME);
    expect(rig.loop.stats.droppedBacklogMs).toBe(0);
  });

  it('warns about a stall at most once per real second but keeps counting what it drops', async () => {
    const rig = await createRig();
    const stall = (MAX_STEPS_PER_FRAME + 2) * STEP_MS;
    rig.tick(0);
    const before = countWarnings(/backlog/i);
    rig.tick(stall); // warns
    rig.tick(2 * stall); // 'stall' later, well under 1 s: silent
    expect(countWarnings(/backlog/i)).toBe(before + 1);
    expect(rig.loop.stats.droppedBacklogMs).toBe(4 * STEP_MS);
    rig.tick(2 * stall + 1000); // a real second after the first warning (1 s of owed time, dropped): warns again
    expect(countWarnings(/backlog/i)).toBe(before + 2);
  });
});

describe('createGameLoop › freeze (hitstop)', () => {
  it('consumes a pending freeze in real time with no step, rendering on, and spends the leftover on steps', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.setFreeze(50);
    const stepsPerFrame: number[] = [];
    const frameMs = 16;
    for (let i = 1; i <= 5; i++) {
      rig.tick(i * frameMs);
      stepsPerFrame.push(rig.loop.stats.stepsLastFrame);
    }
    // 50 ms of freeze: 16 + 16 + 16 consumed, then 2 ms left of the freeze and 14 ms of time → one
    // step (4 ms left over), and the next frame has 20 ms owed → two steps.
    expect(stepsPerFrame).toEqual([0, 0, 0, 1, 2]);
    expect(rig.freezeRealMs).toBe(0);
    expect(rig.alphas).toHaveLength(6); // rendered every frame, frozen or not
    expect(rig.calls.filter((call) => call.startsWith('consume:'))).toEqual([
      'consume:16',
      'consume:16',
      'consume:16',
      'consume:2',
    ]);
  });

  it('stops step k+1 of the same frame when step k requests a freeze, and spends the owed time after it', async () => {
    const rig = await createRig();
    const freezeMs = 2 * FRAME_MS;
    const requestingStep = 2;
    rig.hooks.afterStep = (stepCall) => {
      if (stepCall === requestingStep) rig.setFreeze(freezeMs);
    };
    rig.tick(0);
    rig.tick(5 * STEP_MS); // 5 steps owed
    expect(rig.freezeRealMs).toBe(freezeMs); // the freeze is really pending
    expect(rig.loop.stats.stepsLastFrame).toBe(requestingStep);
    expect(rig.stepCalls).toBe(requestingStep);
    expect(rig.simMs()).toBe(requestingStep * STEP_MS);
    expect(rig.alphas.at(-1)).toBeLessThanOrEqual(1);

    rig.tick(5 * STEP_MS + FRAME_MS); // consumes half of the freeze, no time left, no step
    expect(rig.loop.stats.stepsLastFrame).toBe(0);
    expect(rig.freezeRealMs).toBe(FRAME_MS);

    rig.tick(5 * STEP_MS + 2 * FRAME_MS); // consumes the rest: the 3 owed steps run now
    expect(rig.freezeRealMs).toBe(0);
    expect(rig.loop.stats.stepsLastFrame).toBe(5 - requestingStep);
    expect(rig.simMs()).toBe(5 * STEP_MS);
    expect(rig.loop.stats.droppedBacklogMs).toBe(0);
  });

  it('holds back the owed steps, instead of dropping them, when a freeze coincides with the cap', async () => {
    const rig = await createRig();
    // The freeze arrives with the very step that hits the cap, so the frame stops for both
    // reasons. Step 7 of the story drops for the cap alone; here the loop keeps the owed steps
    // (a hitstop delays sim time, it does not delete it) and spends them after the freeze.
    rig.hooks.afterStep = (stepCall) => {
      if (stepCall === MAX_STEPS_PER_FRAME) rig.setFreeze(FRAME_MS);
    };
    const owedSteps = 2 * MAX_STEPS_PER_FRAME;
    rig.tick(0);
    rig.tick(owedSteps * STEP_MS);
    expect(rig.freezeRealMs).toBe(FRAME_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(MAX_STEPS_PER_FRAME);
    expect(rig.loop.stats.droppedBacklogMs).toBe(0);
    expect(rig.simMs()).toBe(MAX_STEPS_PER_FRAME * STEP_MS);

    // The next frame pays the freeze off with its real time, then spends the owed steps.
    rig.tick(owedSteps * STEP_MS + FRAME_MS);
    expect(rig.freezeRealMs).toBe(0);
    expect(rig.loop.stats.stepsLastFrame).toBe(MAX_STEPS_PER_FRAME);
    expect(rig.loop.stats.droppedBacklogMs).toBe(0);
    expect(rig.simMs()).toBe(owedSteps * STEP_MS);
  });

  it('records a flat segment in the time map while frozen', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.tick(3 * STEP_MS);
    const simAtFreeze = rig.simMs();
    rig.setFreeze(10 * FRAME_MS);
    rig.tick(3 * STEP_MS + FRAME_MS);
    rig.tick(3 * STEP_MS + 2 * FRAME_MS);
    expect(rig.timeMap.realToSim(asRealMs(3 * STEP_MS + 1.5 * FRAME_MS))).toBeCloseTo(
      simAtFreeze,
      9,
    );
  });
});

describe('createGameLoop › events', () => {
  it('drains the sim events after each step and hands them to onSimEvent', async () => {
    const rig = await createRig();
    rig.calls.length = 0;
    rig.tick(0);
    rig.tick(3 * STEP_MS);
    expect(rig.calls.filter((call) => call !== 'render')).toEqual([
      'step',
      'drain',
      'step',
      'drain',
      'step',
      'drain',
    ]);
  });

  it('delivers an event of the sim', async () => {
    const rig = await createRig();
    rig.sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: SLOW_SCALE });
    rig.tick(0);
    rig.tick(FRAME_MS);
    rig.tick(2 * FRAME_MS);
    expect(rig.simEvents).toHaveLength(1);
    expect(rig.simEvents[0]).toMatchObject({ type: 'TimeScaleChanged', to: SLOW_SCALE });
  });
});

describe('createGameLoop › failure and lifecycle', () => {
  it('stops for good when a step throws: the error propagates and no further frame is requested', async () => {
    const rig = await createRig();
    rig.hooks.step = () => {
      throw new Error('sim exploded');
    };
    rig.tick(0);
    expect(() => rig.tick(FRAME_MS)).toThrow('sim exploded');
    expect(rig.scheduler.pending).toBe(false);
    const requested = rig.scheduler.requested;
    expect(() => rig.tick(2 * FRAME_MS)).toThrow('no frame is pending');
    expect(rig.scheduler.requested).toBe(requested);
  });

  it('start() brings the loop back after a fail-stop, without catching up', async () => {
    const rig = await createRig();
    rig.hooks.step = () => {
      throw new Error('sim exploded');
    };
    rig.tick(0);
    expect(() => rig.tick(FRAME_MS)).toThrow('sim exploded');
    expect(rig.scheduler.pending).toBe(false);

    rig.hooks.step = undefined;
    const requested = rig.scheduler.requested;
    rig.loop.start();
    expect(rig.scheduler.pending).toBe(true);
    expect(rig.scheduler.requested).toBe(requested + 1);
    // The first frame after a start measures no real time: the only step it runs is the one the
    // failed frame still owed (its accumulator was not paid off), not 60 s worth.
    rig.tick(60_000);
    expect(rig.loop.stats.stepsLastFrame).toBe(1);
    expect(rig.simMs()).toBe(STEP_MS);
    rig.tick(60_000 + FRAME_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(1);
    expect(rig.simMs()).toBe(2 * STEP_MS);
  });

  it('keeps a single chain of frames when a frame stops and restarts the loop', async () => {
    const double = createSimDouble(
      await createSim({
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel(),
        seed: 1,
      }),
    );
    const scheduler = createFakeScheduler();
    const pause = createPauseController({ events: createEmitter<ClientEvents>() });
    let restartOnce = true;
    const loop = createGameLoop({
      sim: double.sim,
      timeMap: createTimeMap(),
      pause,
      scheduler,
      render: () => {
        if (!restartOnce) return;
        restartOnce = false;
        loop.stop();
        loop.start();
      },
      onSimEvent: () => {},
    });
    loop.start();
    const requestedBefore = scheduler.requested;
    // The fake scheduler throws on a second request while one is pending.
    expect(() => scheduler.tick(0)).not.toThrow();
    expect(scheduler.pending).toBe(true);
    expect(scheduler.requested).toBe(requestedBefore + 1);
    expect(() => scheduler.tick(FRAME_MS)).not.toThrow();
    expect(scheduler.requested).toBe(requestedBefore + 2);
  });

  it('cancels the pending frame on stop()', async () => {
    const rig = await createRig();
    rig.tick(0);
    expect(rig.scheduler.pending).toBe(true);
    rig.loop.stop();
    expect(rig.scheduler.pending).toBe(false);
    rig.loop.stop(); // idempotent
    expect(() => rig.tick(FRAME_MS)).toThrow('no frame is pending');
  });

  it('does not request another frame when render calls stop()', async () => {
    const double = createSimDouble(
      await createSim({
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel(),
        seed: 1,
      }),
    );
    const scheduler = createFakeScheduler();
    const pause = createPauseController({ events: createEmitter<ClientEvents>() });
    const loop = createGameLoop({
      sim: double.sim,
      timeMap: createTimeMap(),
      pause,
      scheduler,
      render: () => loop.stop(),
      onSimEvent: () => {},
    });
    loop.start();
    scheduler.tick(0);
    expect(scheduler.pending).toBe(false);
  });

  it('start() twice requests one frame; a restart does not catch up on the time spent stopped', async () => {
    const rig = await createRig();
    rig.loop.start();
    expect(rig.scheduler.requested).toBe(1);
    runFrames(rig, 0, 3, FRAME_MS);
    const simBefore = rig.simMs();
    rig.loop.stop();
    rig.loop.start();
    rig.tick(60_000);
    expect(rig.loop.stats.stepsLastFrame).toBe(0);
    expect(rig.simMs()).toBe(simBefore);
    rig.tick(60_000 + FRAME_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(1);
  });

  it('uses requestAnimationFrame and cancelAnimationFrame when no scheduler is given', async () => {
    const requested: Array<(frameAtReal: number) => void> = [];
    const cancelled: number[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: (frameAtReal: number) => void) => {
      requested.push(callback);
      return requested.length;
    });
    vi.stubGlobal('cancelAnimationFrame', (handle: number) => {
      cancelled.push(handle);
    });
    const double = createSimDouble(
      await createSim({
        content: createTestContent(),
        geometry: createTestGeometry(),
        level: createTestLevel(),
        seed: 1,
      }),
    );
    const loop = createGameLoop({
      sim: double.sim,
      timeMap: createTimeMap(),
      pause: createPauseController({ events: createEmitter<ClientEvents>() }),
      render: () => {},
      onSimEvent: () => {},
    });
    loop.start();
    expect(requested).toHaveLength(1);
    requested[0]?.(0);
    expect(requested).toHaveLength(2);
    loop.stop();
    expect(cancelled).toEqual([2]);
  });
});

describe('createGameLoop › bad timestamps', () => {
  it.each([
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a timestamp that went back', 5],
    ['a negative timestamp', -FRAME_MS],
  ])(
    'counts %s as zero elapsed time, warns, and neither throws nor loses its place',
    async (_name, bad) => {
      const rig = await createRig();
      rig.tick(0);
      rig.tick(FRAME_MS);
      rig.tick(2 * FRAME_MS);
      expect(rig.simMs()).toBe(2 * STEP_MS);

      const before = countWarnings(/timestamp/i);
      rig.tick(bad);
      expect(rig.loop.stats.stepsLastFrame).toBe(0);
      expect(rig.simMs()).toBe(2 * STEP_MS);
      expect(countWarnings(/timestamp/i)).toBe(before + 1);

      // The next good frame measures from the last good one.
      rig.tick(3 * FRAME_MS);
      expect(rig.loop.stats.stepsLastFrame).toBe(1);
      expect(rig.simMs()).toBe(3 * STEP_MS);
    },
  );

  it.each([
    ['NaN', Number.NaN],
    ['a negative timestamp', -FRAME_MS],
  ])('copes with %s as the very first timestamp', async (_name, bad) => {
    const rig = await createRig();
    const before = countWarnings(/timestamp/i);
    rig.tick(bad);
    expect(countWarnings(/timestamp/i)).toBe(before + 1);
    expect(rig.loop.stats.stepsLastFrame).toBe(0);
    rig.tick(FRAME_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(0); // first real measurement starts here
    rig.tick(2 * FRAME_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(1);
  });
});

describe('createGameLoop › pause', () => {
  it('runs no step while paused, keeps rendering, and keeps the sim time', async () => {
    const rig = await createRig();
    const last = runFrames(rig, 0, 5, FRAME_MS);
    const simBefore = rig.simMs();
    const stepsBefore = rig.stepCalls;
    const rendersBefore = rig.alphas.length;
    rig.pause.requestPause('user');
    const frames = 30;
    runFrames(rig, last + FRAME_MS, frames, 1000);
    expect(rig.stepCalls).toBe(stepsBefore);
    expect(rig.simMs()).toBe(simBefore);
    expect(rig.alphas.length).toBe(rendersBefore + frames);
    expect(rig.loop.stats.stepsLastFrame).toBe(0);
  });

  it('feeds the time map a flat segment while paused: a late input maps to the sim time of the pause', async () => {
    const rig = await createRig();
    const last = runFrames(rig, 0, 5, FRAME_MS);
    const simBefore = rig.simMs();
    rig.pause.requestPause('visibilityHidden');
    rig.tick(last + FRAME_MS);
    rig.tick(last + 1500);
    // Inside the paused stretch, and later than the newest record (an input between two frames).
    expect(rig.timeMap.realToSim(asRealMs(last + 700))).toBeCloseTo(simBefore, 9);
    expect(rig.timeMap.realToSim(asRealMs(last + 1500 + 200))).toBeCloseTo(simBefore, 9);
  });

  it('resumes at exactly the same sim time as an uninterrupted twin (30 s pause, 3 s countdown)', async () => {
    const [a, b] = await Promise.all([createRig(), createRig()]);
    // Both sims run in slow motion so the accumulator is mid-step at the pause and the hash is
    // not just a step counter.
    for (const rig of [a, b]) {
      rig.sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: SLOW_SCALE });
    }
    const spacings = [7, 13, 10, 25, 4, 16, 16, 9, 33, 11, 12, 6, 20, 17, 8, 14, 5, 19, 10, 15];
    const pauseAfter = 11;

    let atA = 1000;
    let atB = 1000;
    a.tick(atA);
    b.tick(atB);
    for (let i = 0; i < pauseAfter; i++) {
      atA += spacings[i] as number;
      atB += spacings[i] as number;
      a.tick(atA);
      b.tick(atB);
    }
    expect(hashJson(b.sim.world)).toBe(hashJson(a.sim.world));
    expect(a.simMs()).toBeGreaterThan(0);

    // B is paused for 30 s of real frames, then resumes through the countdown.
    const simAtPause = b.simMs();
    const stepsAtPause = b.stepCalls;
    b.pause.requestPause('user');
    const pausedFrames = Math.round(30_000 / 16);
    for (let i = 0; i < pausedFrames; i++) {
      atB += 16;
      b.tick(atB);
      expect(b.simMs()).toBe(simAtPause);
    }
    b.pause.requestResume();
    let countdownFrames = 0;
    for (;;) {
      atB += 16;
      b.tick(atB);
      countdownFrames++;
      if (b.pause.state === 'running') break;
      expect(b.pause.state).toBe('resuming');
      expect(countdownFrames).toBeLessThan(10_000);
    }
    // The countdown really lasted RESUME_COUNTDOWN_MS of frame time.
    expect(countdownFrames * 16).toBeGreaterThanOrEqual(RESUME_COUNTDOWN_MS);
    // No step during the whole pause + countdown, and none on the first running frame (no catch-up).
    expect(b.stepCalls).toBe(stepsAtPause);
    expect(b.loop.stats.stepsLastFrame).toBe(0);
    expect(b.simMs()).toBe(simAtPause);

    // A gets the zero-elapsed frame B just had, then both see the same frame spacing.
    a.tick(atA);
    expect(a.loop.stats.stepsLastFrame).toBe(0);
    for (let i = pauseAfter; i < spacings.length; i++) {
      atA += spacings[i] as number;
      atB += spacings[i] as number;
      a.tick(atA);
      b.tick(atB);
      expect(b.loop.stats.stepsLastFrame).toBe(a.loop.stats.stepsLastFrame);
    }
    expect(b.simMs()).toBe(a.simMs());
    expect(hashJson(b.sim.world)).toBe(hashJson(a.sim.world));
    expect(b.alphas.at(-1)).toBe(a.alphas.at(-1));
    expect(b.stepCalls).toBe(a.stepCalls);
  });

  it('does not resume without the countdown: requestResume alone leaves the loop idle', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.pause.requestPause('user');
    rig.pause.requestResume();
    rig.tick(100);
    rig.tick(100 + RESUME_COUNTDOWN_MS - 1);
    expect(rig.pause.state).toBe('resuming');
    expect(rig.stepCalls).toBe(0);
    rig.tick(100 + RESUME_COUNTDOWN_MS);
    expect(rig.pause.state).toBe('running');
    expect(rig.stepCalls).toBe(0); // the frame that ends the countdown measures no time
    rig.tick(100 + RESUME_COUNTDOWN_MS + FRAME_MS);
    expect(rig.stepCalls).toBe(1);
  });
});
