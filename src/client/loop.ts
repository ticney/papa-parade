import {
  ADVANCE_MAX_STEPS,
  LOOP_WARN_INTERVAL_MS,
  MAX_STEPS_PER_FRAME,
  STEP_MS,
} from '@shared/constants';
import { invariant } from '@shared/invariant';
import { log } from '@shared/log';
import { asRealMs, asSimMs } from '@shared/time';
import type { Sim, SimEvent } from '@sim';
import type { PauseController } from './app/pauseController.ts';
import type { TimeMap } from './timeMap.ts';

export interface FrameScheduler {
  /** Asks for one call of `callback` at the next display frame; returns a handle for `cancel`. */
  request(callback: (frameAtReal: number) => void): number;
  cancel(handle: number): void;
}

export interface GameLoopOptions {
  readonly sim: Sim;
  readonly timeMap: TimeMap;
  readonly pause: PauseController;
  /** Default: `requestAnimationFrame` / `cancelAnimationFrame`. */
  readonly scheduler?: FrameScheduler;
  /**
   * Called every frame, paused or not. `alpha` is in `[0, 1]`: how far the next step is under way.
   * `frameAtReal` is the display frame's timestamp (a bad one is replaced by the last good one); an
   * `advance` render repeats the last frame's.
   */
  render(alpha: number, frameAtReal: number): void;
  /** Called synchronously for each sim event, right after the step that produced it. Do not keep the event. */
  onSimEvent(event: SimEvent): void;
  /** Real-time multiplier for the level (`?speed`). Default 1. A finite number above 0. */
  readonly speed?: number;
  /** Called before every `sim.step()` this loop runs, frames and `advance` alike. */
  readonly beforeStep?: (sim: Sim) => void;
  /**
   * A real-time clock in ms (`performance.now`), given only when the debug overlay is up: with it
   * the loop times its frames into `stats` (story 2.1). Without one it reads no clock at all.
   * `setMeasure` changes it later.
   */
  readonly measure?: () => number;
}

export interface LoopStats {
  stepsLastFrame: number;
  /** Sim ms thrown away because a frame owed more than `MAX_STEPS_PER_FRAME` steps. */
  droppedBacklogMs: number;
  frames: number;
  /**
   * With a `measure` clock only, else 0 (story 2.1): the real ms the last frame spent in all its
   * `sim.step()` calls, in `render`, and in total (from the start of the frame to the end of its
   * render; the browser's own work between two frames is not in it).
   */
  simMsLastFrame: number;
  renderMsLastFrame: number;
  frameMsLastFrame: number;
}

export interface GameLoop {
  /** Requests the first frame. Idempotent while a frame is pending; also restarts after a fail-stop. */
  start(): void;
  /** Cancels the pending frame. Idempotent. */
  stop(): void;
  /** One object, mutated in place by every frame. */
  readonly stats: LoopStats;
  readonly isFrozen: boolean;
  /**
   * The continuous game clock as the last frame recorded it in the time map, in sim ms: the world's
   * sim time plus the owed accumulator, never behind itself. 0 before the first frame. Unlike
   * `world.time.sim` it moves smoothly, not in 10 ms stairs: the beat scheduler maps it onto the
   * audio clock (story 4.5).
   */
  readonly clockMs: number;
  /**
   * Sim ms per real ms from `clockMs` on, as the last frame recorded it: `timeScale × speed`, and 0
   * while frozen (hitstop, a debug freeze) or paused. Dividing by it is a bug.
   */
  readonly simPerRealMs: number;
  /**
   * While frozen the loop keeps running frames (the countdown ends, the scene renders) but runs no
   * step, adds nothing to the accumulator and pays off no hitstop. Idempotent. Unfreezing measures
   * no elapsed time for the next frame: no catch-up.
   */
  setFrozen(isFrozen: boolean): void;
  /** Starts timing frames with this clock into `stats`, or stops with `null` (and zeroes the three timings). Idempotent. */
  setMeasure(measure: (() => number) | null): void;
  /**
   * Freezes the loop, then runs exactly `steps` steps now (hook, step, drain, events, as in a frame;
   * the pause state and a pending hitstop are ignored, and the hitstop is not consumed) and renders
   * once. Throws on a `steps` that is not an integer in `[0, ADVANCE_MAX_STEPS]`.
   */
  advance(steps: number): void;
}

const rafScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * The client loop (ADR-002): real time in, fixed `STEP_MS` steps out, then a render.
 *
 * Per frame, while `pause.state` is `running`: the real time since the previous running frame
 * pays off a freeze first (hitstop), the rest times `sim.timeScale` goes into the accumulator, and
 * whole steps are run (at most `MAX_STEPS_PER_FRAME` times `speed`; the rest of a stall is dropped). The freeze
 * is checked before every step, so a hitstop requested by step k stops step k+1. A frame that
 * follows a pause, a bad timestamp or the start measures no elapsed time, so a resume never
 * catches up. While paused the loop only renders. The accumulator survives a pause, which makes a
 * paused-and-resumed run identical to an uninterrupted one.
 *
 * Every frame also records the continuous sim clock (`world.time.sim` plus the accumulator) in the
 * time map, paused or not.
 *
 * `speed` multiplies the real time a frame measures (the hitstop's payment included), and the cap
 * on steps per frame, so a slow frame at ×4 still runs ×4. A frozen loop
 * (`setFrozen`, `advance`) keeps rendering and ending a pause countdown, but steps nothing.
 * `beforeStep` runs before every step, wherever the step comes from, so a bot is asked exactly as
 * `playGame` asks it.
 *
 * Fail-stop: the next frame is requested at the end of a successful frame, so an exception ends
 * the loop and reaches the global error hook; `start()` brings it back (story 1.6 restarts a
 * level that way). Nothing here allocates per frame.
 */
export function createGameLoop(options: GameLoopOptions): GameLoop {
  const { sim, timeMap, pause, render, onSimEvent, beforeStep } = options;
  const speed = options.speed ?? 1;
  // At ×4 a 50 ms frame owes 200 ms of sim (20 steps): the cap grows with `speed`, or a slow frame
  // would drop the speed-up as a stall.
  const maxStepsPerFrame = Math.ceil(MAX_STEPS_PER_FRAME * speed);
  invariant(Number.isFinite(speed) && speed > 0, 'the loop speed must be a finite number above 0');
  const scheduler = options.scheduler ?? rafScheduler;
  const stats: LoopStats = {
    stepsLastFrame: 0,
    droppedBacklogMs: 0,
    frames: 0,
    simMsLastFrame: 0,
    renderMsLastFrame: 0,
    frameMsLastFrame: 0,
  };
  /** The clock of `measure`, or null: nothing is read then, so the overlay costs nothing when absent. */
  let clock: (() => number) | null = options.measure ?? null;
  /** The real ms the `sim.step()` calls of the current frame took so far. */
  let simMsInFrame = 0;

  let isRunning = false; // between start() and stop()
  /** Counts the `stop()` calls: a step hook or event listener that stops the loop cuts the steps still owed. */
  let stopCount = 0;
  let isPending = false; // a frame is requested and has not run yet
  let handle = 0;
  let accumulatorMs = 0; // owed sim time
  let lastSeenAtReal = 0; // newest valid frame timestamp: timestamps never go back
  let lastRunningAtReal = 0;
  let hasLastRunning = false; // false after a pause, a start or at the beginning: next dt is 0
  let lastClockMs = 0;
  /** What the last frame recorded in the time map: the rate the clock runs at from `lastClockMs` on. */
  let lastSimPerRealMs = 0;
  let lastBacklogWarnAtReal = Number.NEGATIVE_INFINITY;
  let lastTimestampWarnAtReal = Number.NEGATIVE_INFINITY;
  let isFrozen = false;

  /** One step as a frame runs it, and as `advance` does: the hook, the step, then its events. */
  const runStep = (): void => {
    beforeStep?.(sim);
    const stepClock = clock;
    if (stepClock === null) {
      sim.step();
    } else {
      const startedAt = stepClock();
      sim.step();
      simMsInFrame += stepClock() - startedAt;
    }
    const events = sim.drainEvents();
    for (let i = 0; i < events.length; i++) onSimEvent(events[i] as SimEvent);
  };

  const setFrozen = (next: boolean): void => {
    if (next === isFrozen) return;
    isFrozen = next;
    // Frozen or not, the next frame measures no elapsed time (a pause's rule: no catch-up).
    hasLastRunning = false;
  };

  const setMeasure = (next: (() => number) | null): void => {
    clock = next;
    if (next !== null) return;
    stats.simMsLastFrame = 0;
    stats.renderMsLastFrame = 0;
    stats.frameMsLastFrame = 0;
  };

  const onFrame = (frameAtReal: number): void => {
    // Read once: a hook that turns the measure off mid-frame must not leave a half timing.
    const frameClock = clock;
    const frameStartedAt = frameClock === null ? 0 : frameClock();
    simMsInFrame = 0;
    isPending = false;
    stats.frames++;
    const stopCountAtFrame = stopCount;

    const isGood = Number.isFinite(frameAtReal) && frameAtReal >= lastSeenAtReal;
    if (isGood) lastSeenAtReal = frameAtReal;
    // A bad timestamp (NaN, or one that went back) measures no time: reuse the last good one so
    // that the pause and the time map keep seeing a monotone clock.
    const atReal = lastSeenAtReal;
    if (!isGood && atReal - lastTimestampWarnAtReal >= LOOP_WARN_INTERVAL_MS) {
      lastTimestampWarnAtReal = atReal;
      log.warn('sim', 'bad frame timestamp counted as zero elapsed time', { frameAtReal });
    }

    pause.update(asRealMs(atReal));

    let steps = 0;
    let simPerRealMs = 0;
    if (pause.state === 'running' && !isFrozen) {
      let dtSpedMs = 0;
      if (isGood) {
        if (hasLastRunning) dtSpedMs = (atReal - lastRunningAtReal) * speed;
        lastRunningAtReal = atReal;
        hasLastRunning = true;
      }

      // A hitstop eats (sped-up) real time first; rendering goes on meanwhile.
      if (sim.freezeRealMs > 0) {
        const consumedMs = Math.min(dtSpedMs, sim.freezeRealMs);
        if (consumedMs > 0) sim.consumeFreeze(consumedMs);
        dtSpedMs -= consumedMs;
      }

      accumulatorMs += dtSpedMs * sim.timeScale;

      // A hook or a listener may stop the loop (a restart, a level change) and dispose the sim: the
      // steps still owed are then dropped, not run on a sim that is gone.
      while (
        accumulatorMs >= STEP_MS &&
        steps < maxStepsPerFrame &&
        sim.freezeRealMs === 0 &&
        stopCount === stopCountAtFrame
      ) {
        runStep();
        accumulatorMs -= STEP_MS;
        steps++;
      }

      // Stopped by the cap with whole steps still owed: a stall. Drop them rather than spiral.
      // Deviation from the literal step 7 of the story: if a freeze is pending too (the last step
      // asked for a hitstop), keep them. A hitstop delays sim time, it does not delete it, and the
      // next frames spend the owed steps after the freeze (a stall is dropped then, if it remains).
      if (steps === maxStepsPerFrame && accumulatorMs >= STEP_MS && sim.freezeRealMs === 0) {
        const remainderMs = accumulatorMs % STEP_MS;
        const droppedMs = accumulatorMs - remainderMs;
        accumulatorMs = remainderMs;
        stats.droppedBacklogMs += droppedMs;
        if (atReal - lastBacklogWarnAtReal >= LOOP_WARN_INTERVAL_MS) {
          lastBacklogWarnAtReal = atReal;
          log.warn('sim', `frame stall: dropped ${droppedMs} ms of sim backlog`, {
            droppedBacklogMs: stats.droppedBacklogMs,
          });
        }
      }

      simPerRealMs = sim.freezeRealMs > 0 ? 0 : sim.timeScale * speed;
    } else {
      hasLastRunning = false;
    }
    stats.stepsLastFrame = steps;

    // Read the world fresh: it is another object after `restore`. The clamp absorbs a float
    // rounding of one ulp between two frames that run the same time.
    const clockMs = Math.max(sim.world.time.sim + accumulatorMs, lastClockMs);
    lastClockMs = clockMs;
    lastSimPerRealMs = simPerRealMs;
    timeMap.record(asRealMs(atReal), asSimMs(clockMs), simPerRealMs);

    // Owed whole steps (held back by a freeze) must not push the view past the last step.
    if (frameClock === null) {
      render(Math.min(accumulatorMs / STEP_MS, 1), atReal);
    } else {
      const renderStartedAt = frameClock();
      render(Math.min(accumulatorMs / STEP_MS, 1), atReal);
      const endedAt = frameClock();
      // A listener or a hook may have turned the measure off (or swapped it) during the frame:
      // `setMeasure(null)` has zeroed the stats and they must stay zero, not get half a timing.
      if (clock === frameClock) {
        stats.simMsLastFrame = simMsInFrame;
        stats.renderMsLastFrame = endedAt - renderStartedAt;
        stats.frameMsLastFrame = endedAt - frameStartedAt;
      }
    }

    // Only a frame that went through asks for the next (fail-stop), and not after a stop().
    // A start() made from inside this frame has already requested one: never two chains.
    if (isRunning && !isPending) {
      handle = scheduler.request(onFrame);
      isPending = true;
    }
  };

  return {
    stats,
    get isFrozen() {
      return isFrozen;
    },
    get clockMs() {
      return lastClockMs;
    },
    get simPerRealMs() {
      return lastSimPerRealMs;
    },
    setFrozen,
    setMeasure,
    advance(steps) {
      invariant(
        Number.isInteger(steps) && steps >= 0 && steps <= ADVANCE_MAX_STEPS,
        'advance: steps must be an integer in [0, ADVANCE_MAX_STEPS]',
      );
      setFrozen(true);
      const stopCountAtCall = stopCount;
      for (let i = 0; i < steps && stopCount === stopCountAtCall; i++) runStep();
      // The clock moved with the steps, and the loop is frozen: the beat ring and a screenshot of it
      // read this clock, so it must follow `advance` too (the time map is left alone).
      lastClockMs = Math.max(sim.world.time.sim + accumulatorMs, lastClockMs);
      lastSimPerRealMs = 0;
      render(Math.min(accumulatorMs / STEP_MS, 1), lastSeenAtReal);
    },
    start() {
      // After a fail-stop (a frame threw) `isRunning` is still true but nothing is pending: restart.
      if (isRunning && isPending) return;
      isRunning = true;
      hasLastRunning = false;
      handle = scheduler.request(onFrame);
      isPending = true;
    },
    stop() {
      isRunning = false;
      stopCount++;
      if (!isPending) return;
      scheduler.cancel(handle);
      isPending = false;
    },
  };
}
