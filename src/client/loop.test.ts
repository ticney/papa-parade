import {
  ADVANCE_MAX_STEPS,
  MAX_STEPS_PER_FRAME,
  RESUME_COUNTDOWN_MS,
  STEP_MS,
} from '@shared/constants';
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
  createTestOutlet,
  OUTLET,
  testWave,
} from '../../tests/support/testContent.ts';
import {
  PARRY_RELEASE_AFTER_MS,
  SLOW_MO_COVER_MARGIN_MS,
} from '../../tests/support/timeEffects.ts';
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
 * Wraps a real `Sim` so that a test can hold a freeze and count calls: the double lets a test hold
 * an arbitrary freeze; the real sim requests one on a successful response (story 1.14, see the
 * « real sim » describe at the end). Everything else is the real sim.
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
    objects: real.objects,
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
    dispose: () => real.dispose(),
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

async function createRig(
  options: { warnings?: string[]; speed?: number; beforeStep?: (sim: Sim) => void } = {},
) {
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
    speed: options.speed,
    beforeStep: options.beforeStep,
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

describe('createGameLoop › step hook', () => {
  it('calls beforeStep once before every step of a frame, with the sim, never between frames without a step', async () => {
    const seenAtMs: number[] = [];
    const rig = await createRig({ beforeStep: (sim) => seenAtMs.push(sim.world.time.sim) });
    rig.tick(0);
    expect(seenAtMs).toEqual([]);
    rig.tick(3 * STEP_MS);
    expect(seenAtMs).toEqual([0, STEP_MS, 2 * STEP_MS]);
    expect(rig.stepCalls).toBe(3);
  });

  it('puts the hook right before sim.step() in the call order', async () => {
    const holder: { rig?: Rig } = {};
    const rig = await createRig({ beforeStep: () => holder.rig?.calls.push('hook') });
    holder.rig = rig;
    rig.tick(0);
    rig.tick(STEP_MS);
    expect(rig.calls.filter((call) => call !== 'render')).toEqual(['hook', 'step', 'drain']);
  });
});

describe('createGameLoop › stop from inside a step', () => {
  it('runs no more steps of the frame once a step hook has stopped the loop', async () => {
    const holder: { rig?: Rig } = {};
    const rig = await createRig({ beforeStep: () => holder.rig?.loop.stop() });
    holder.rig = rig;
    rig.tick(0);
    rig.tick(3 * STEP_MS);
    expect(rig.stepCalls).toBe(1);
  });

  it('stops advance(steps) the same way', async () => {
    const holder: { rig?: Rig } = {};
    const rig = await createRig({ beforeStep: () => holder.rig?.loop.stop() });
    holder.rig = rig;
    rig.loop.advance(5);
    expect(rig.stepCalls).toBe(1);
  });

  it('runs steps again after a start()', async () => {
    const holder: { rig?: Rig; isStopping: boolean } = { isStopping: true };
    const rig = await createRig({
      beforeStep: () => {
        if (holder.isStopping) holder.rig?.loop.stop();
      },
    });
    holder.rig = rig;
    rig.loop.advance(5);
    holder.isStopping = false;
    rig.loop.start();
    rig.loop.advance(2);
    expect(rig.stepCalls).toBe(3);
  });
});

describe('createGameLoop › speed', () => {
  it('multiplies the real time of a frame: speed 4 with 10 ms frames runs 4 steps per frame', async () => {
    const rig = await createRig({ speed: 4 });
    rig.tick(0);
    rig.tick(FRAME_MS);
    expect(rig.loop.stats.stepsLastFrame).toBe(4);
    rig.tick(2 * FRAME_MS);
    expect(rig.simMs()).toBe(8 * STEP_MS);
  });

  it('lets the step cap grow with speed: a slow frame at ×4 keeps the speed-up instead of dropping it', async () => {
    const rig = await createRig({ speed: 4 });
    rig.tick(0);
    const owedSteps = MAX_STEPS_PER_FRAME + 5; // owed at ×4 by a frame of (10 + 5) × STEP_MS / 4 real ms
    rig.tick((owedSteps * STEP_MS) / 4);
    expect(rig.loop.stats.stepsLastFrame).toBe(owedSteps);
    expect(rig.loop.stats.droppedBacklogMs).toBe(0);
  });

  it('pays a hitstop in sped-up time too: 25 real ms at ×4 pay 100 ms of freeze', async () => {
    const rig = await createRig({ speed: 4 });
    rig.tick(0);
    rig.setFreeze(100);
    rig.tick(25);
    expect(rig.freezeRealMs).toBe(0);
    expect(rig.loop.stats.stepsLastFrame).toBe(0);
  });

  it('records speed × timeScale as the real to sim rate in the time map', async () => {
    const rig = await createRig({ speed: 2 });
    rig.tick(0);
    rig.tick(FRAME_MS);
    rig.tick(2 * FRAME_MS);
    // 20 ms of real time = 40 ms of sim at speed 2: an input 5 ms after the last frame is 10 ms later in sim.
    const atLast = rig.simMs();
    expect(rig.timeMap.realToSim(asRealMs(2 * FRAME_MS + 5))).toBeCloseTo(atLast + 10, 9);
  });

  it('throws at creation on a speed that is not a finite number above 0', async () => {
    for (const speed of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      await expect(createRig({ speed })).rejects.toThrow(/speed/);
    }
  });
});

describe('createGameLoop › frozen', () => {
  it('renders every frame, runs no step, keeps the sim time and ends a countdown', async () => {
    const rig = await createRig();
    const last = runFrames(rig, 0, 5, FRAME_MS);
    const simBefore = rig.simMs();
    rig.loop.setFrozen(true);
    expect(rig.loop.isFrozen).toBe(true);
    const rendersBefore = rig.alphas.length;
    runFrames(rig, last + FRAME_MS, 20, 100);
    expect(rig.simMs()).toBe(simBefore);
    expect(rig.alphas.length).toBe(rendersBefore + 20);
    expect(rig.loop.stats.stepsLastFrame).toBe(0);

    // A countdown still ends while frozen: `loadLevel` resolves on it.
    rig.pause.requestPause('user');
    rig.pause.requestResume();
    rig.tick(10_000);
    rig.tick(10_000 + RESUME_COUNTDOWN_MS);
    expect(rig.pause.state).toBe('running');
    expect(rig.simMs()).toBe(simBefore);
  });

  it('does not pay off a hitstop and adds nothing to the accumulator while frozen', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.loop.setFrozen(true);
    rig.setFreeze(50);
    runFrames(rig, FRAME_MS, 5, 100);
    expect(rig.freezeRealMs).toBe(50);
    expect(rig.alphas.at(-1)).toBe(0);
  });

  it('records a flat segment in the time map while frozen', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.tick(FRAME_MS);
    rig.loop.setFrozen(true);
    rig.tick(2 * FRAME_MS);
    rig.tick(1000);
    const simMs = rig.simMs();
    expect(rig.timeMap.realToSim(asRealMs(500))).toBeCloseTo(simMs, 9);
  });

  it('measures no elapsed time on the first frame after unfreezing: no catch-up', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.loop.setFrozen(true);
    rig.tick(5000);
    rig.loop.setFrozen(false);
    expect(rig.loop.isFrozen).toBe(false);
    rig.tick(9000);
    expect(rig.stepCalls).toBe(0);
    rig.tick(9000 + FRAME_MS);
    expect(rig.stepCalls).toBe(1);
  });

  it('is idempotent', async () => {
    const rig = await createRig();
    rig.loop.setFrozen(true);
    rig.loop.setFrozen(true);
    rig.loop.setFrozen(false);
    rig.loop.setFrozen(false);
    expect(rig.loop.isFrozen).toBe(false);
  });
});

describe('createGameLoop › advance', () => {
  it('runs exactly n steps, each with the hook before it and its events delivered, renders once, and leaves the loop frozen', async () => {
    const seenAtMs: number[] = [];
    const rig = await createRig({ beforeStep: (sim) => seenAtMs.push(sim.world.time.sim) });
    rig.tick(0);
    const rendersBefore = rig.alphas.length;
    rig.loop.advance(5);
    expect(rig.stepCalls).toBe(5);
    expect(rig.simMs()).toBe(5 * STEP_MS);
    expect(seenAtMs).toEqual([0, 1, 2, 3, 4].map((i) => i * STEP_MS));
    expect(rig.alphas.length).toBe(rendersBefore + 1);
    expect(rig.loop.isFrozen).toBe(true);
    // Step, drain, then the event handler, as in a frame.
    const advanced = rig.calls.slice(rig.calls.indexOf('step'));
    expect(advanced.slice(0, 2)).toEqual(['step', 'drain']);
  });

  it('delivers the events of the steps it runs', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.sim.enqueue({ type: 'SetTimeScale', t: asSimMs(0), scale: 0.5 });
    rig.loop.advance(3);
    expect(rig.simEvents.length).toBeGreaterThan(0);
  });

  it('works while paused, and ignores a pending hitstop without consuming it', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.pause.requestPause('user');
    rig.setFreeze(70);
    rig.loop.advance(4);
    expect(rig.simMs()).toBe(4 * STEP_MS);
    expect(rig.freezeRealMs).toBe(70);
  });

  it('with 0 steps only freezes and renders', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.loop.advance(0);
    expect(rig.stepCalls).toBe(0);
    expect(rig.loop.isFrozen).toBe(true);
  });

  it('renders with the current alpha (the accumulator is untouched)', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.tick(1.5 * STEP_MS); // one step, half a step owed
    rig.loop.advance(2);
    expect(rig.alphas.at(-1)).toBeCloseTo(0.5, 9);
  });

  it('throws on a count that is not an integer in [0, ADVANCE_MAX_STEPS], and runs nothing', async () => {
    const rig = await createRig();
    rig.tick(0);
    for (const steps of [1.5, -1, ADVANCE_MAX_STEPS + 1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => rig.loop.advance(steps)).toThrow(/steps/);
    }
    expect(rig.stepCalls).toBe(0);
    expect(rig.loop.isFrozen).toBe(false);
  });

  it('keeps the frames going after an advance (frozen frames still render)', async () => {
    const rig = await createRig();
    rig.tick(0);
    rig.loop.advance(2);
    const rendersBefore = rig.alphas.length;
    rig.tick(100);
    rig.tick(200);
    expect(rig.alphas.length).toBe(rendersBefore + 2);
    expect(rig.simMs()).toBe(2 * STEP_MS);
  });
});

/**
 * A loop over the real sim and the outlet level (the rig above plays an empty level over a double):
 * hitstop and slow-mo come from the sim itself (story 1.14). One frame is one step at scale 1.
 */
async function createRealRig(withContent = createTestContent()) {
  const sim = await createSim({
    content: withContent,
    geometry: createTestGeometry(),
    level: createTestLevel({ waves: [testWave([OUTLET])] }),
    seed: 1,
  });
  const scheduler = createFakeScheduler();
  const events = createEmitter<ClientEvents>();
  const pause = createPauseController({ events });
  const timeMap = createTimeMap({ logger: { warn: () => undefined } });
  let renders = 0;
  let atReal = 0;
  const seen: { event: SimEvent; atReal: number; timeScale: number }[] = [];
  const loop = createGameLoop({
    sim,
    timeMap,
    pause,
    scheduler,
    render: () => {
      renders++;
    },
    onSimEvent: (event) => seen.push({ event: { ...event }, atReal, timeScale: sim.timeScale }),
  });
  loop.start();
  const frame = () => {
    scheduler.tick(atReal);
    atReal += FRAME_MS;
  };
  return {
    sim,
    seen,
    loop,
    get renders() {
      return renders;
    },
    get atReal() {
      return atReal;
    },
    frame,
    /** Frames until `done` holds, at most `limit` of them. */
    frameUntil(done: () => boolean, limit = 100_000) {
      for (let i = 0; i < limit && !done(); i++) frame();
      if (!done()) throw new Error('the condition was never reached');
    },
    /** The first event of `type` seen at or after index `from`. */
    find<T extends SimEvent['type']>(type: T, from = 0) {
      return seen.slice(from).find((entry) => entry.event.type === type) as
        | { event: Extract<SimEvent, { type: T }>; atReal: number; timeScale: number }
        | undefined;
    },
  };
}

type RealRig = Awaited<ReturnType<typeof createRealRig>>;

/** Enqueues a perfect Parry (press at the centre of the window, release `PARRY_RELEASE_AFTER_MS` later) on the outlet. */
function enqueuePerfectParry(rig: RealRig): number {
  rig.frameUntil(() => rig.sim.world.threats[0]?.state === 'telegraph');
  const { windowOpenAt, responseWindow } = rig.sim.world.threats[0] ?? {};
  if (responseWindow == null || windowOpenAt === undefined) throw new Error('not telegraphed');
  const center = windowOpenAt + responseWindow.windowMs / 2;
  rig.sim.enqueue({ type: 'PressThreat', t: asSimMs(center), threatId: 1 });
  rig.sim.enqueue({ type: 'Release', t: asSimMs(center + PARRY_RELEASE_AFTER_MS) });
  return center + PARRY_RELEASE_AFTER_MS;
}

describe('createGameLoop › real sim: hitstop and slow-mo (story 1.14)', () => {
  const { hitstopMs, slowMoPerfect } = createTestContent().feel.timing;

  it('freezes steps for hitstopMs of real time after a perfect response, then runs at the slow-mo scale', async () => {
    const rig = await createRealRig();
    const resolvedAt = enqueuePerfectParry(rig);
    rig.frameUntil(() => rig.find('ResponseResolved') !== undefined);
    expect(rig.sim.world.time.sim).toBe(resolvedAt);
    expect(rig.sim.freezeRealMs).toBe(hitstopMs);
    expect(rig.sim.timeScale).toBe(slowMoPerfect.timeScale);

    // The freeze: no step for hitstopMs of real time, and every frame still renders.
    const frozenFrames = hitstopMs / FRAME_MS;
    for (let i = 0; i < frozenFrames; i++) {
      const rendersBefore = rig.renders;
      rig.frame();
      expect(rig.loop.stats.stepsLastFrame).toBe(0);
      expect(rig.sim.world.time.sim).toBe(resolvedAt);
      expect(rig.renders).toBe(rendersBefore + 1);
      expect(rig.sim.freezeRealMs).toBe(hitstopMs - (i + 1) * FRAME_MS);
    }
    expect(rig.sim.freezeRealMs).toBe(0);

    // Then the accumulator receives timeScale × real time: 10 frames of 10 ms are 3 steps at ×0.3.
    const frames = 10;
    let steps = 0;
    for (let i = 0; i < frames; i++) {
      rig.frame();
      steps += rig.loop.stats.stepsLastFrame;
    }
    expect(steps).toBe(Math.floor((frames * FRAME_MS * slowMoPerfect.timeScale) / STEP_MS));
    expect(rig.sim.world.time.sim).toBe(resolvedAt + steps * STEP_MS);
  });

  it('does not freeze after a gag: steps carry on at the same scale', async () => {
    const rig = await createRealRig();
    rig.frameUntil(() => rig.find('ResponseResolved') !== undefined);
    expect(rig.find('GagTriggered')).toBeDefined();
    expect(rig.sim.freezeRealMs).toBe(0);
    rig.frame();
    expect(rig.loop.stats.stepsLastFrame).toBe(1);
    expect(rig.sim.timeScale).toBe(1);
  });

  it('keeps a window open for windowMs of sim time: windowMs / timeScale of real time under a slow-mo (ADR-002)', async () => {
    const long = createTestContent();
    const outlet = createTestOutlet();
    // The perfect slow-mo covers the outlet's next cycle (cooldown, telegraph, window), with no ramp.
    long.feel.timing.slowMoPerfect.durationMs =
      outlet.cooldownMs + (outlet.telegraphDelayMs ?? 0) + SLOW_MO_COVER_MARGIN_MS;
    long.feel.timing.slowMoPerfect.returnMs = 0;
    const { timing } = long.feel;
    const rig = await createRealRig(long);
    enqueuePerfectParry(rig);
    rig.frameUntil(() => rig.find('ResponseResolved') !== undefined);
    const first = rig.seen.length;
    // Nobody answers the second cycle: its window opens, then closes on a late gag.
    rig.frameUntil(() => rig.find('GagTriggered', first) !== undefined);
    const opened = rig.find('WindowOpened', first);
    const gagged = rig.find('ResponseResolved', first);
    if (opened === undefined || gagged === undefined) throw new Error('no second window');
    expect(gagged.event.quality).toBe('fail');
    expect(opened.timeScale).toBe(timing.slowMoPerfect.timeScale);

    // Sim time: the window and its tolerance, closed at the next step.
    const simMs = gagged.event.t - opened.event.t;
    expect(simMs).toBeGreaterThanOrEqual(timing.windowMs + timing.toleranceMs);
    // Real time: the same sim time at ×timeScale, within one frame (no hitstop after a gag).
    const realMs = gagged.atReal - opened.atReal;
    expect(Math.abs(realMs - simMs / timing.slowMoPerfect.timeScale)).toBeLessThanOrEqual(FRAME_MS);
  });
});
