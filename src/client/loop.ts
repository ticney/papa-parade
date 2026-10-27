import { MAX_STEPS_PER_FRAME, STEP_MS } from '@shared/constants';
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
  /** Called every frame, paused or not. `alpha` is in `[0, 1]`: how far the next step is under way. */
  render(alpha: number): void;
  /** Called synchronously for each sim event, right after the step that produced it. Do not keep the event. */
  onSimEvent(event: SimEvent): void;
}

export interface LoopStats {
  stepsLastFrame: number;
  /** Sim ms thrown away because a frame owed more than `MAX_STEPS_PER_FRAME` steps. */
  droppedBacklogMs: number;
  frames: number;
}

export interface GameLoop {
  /** Requests the first frame. Idempotent. */
  start(): void;
  /** Cancels the pending frame. Idempotent. */
  stop(): void;
  /** One object, mutated in place by every frame. */
  readonly stats: LoopStats;
}

/** Warnings from the hot path are rate-limited to one per this much real time. */
const WARN_EVERY_MS = 1000;

const rafScheduler: FrameScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/**
 * The client loop (ADR-002): real time in, fixed `STEP_MS` steps out, then a render.
 *
 * Per frame, while `pause.state` is `running`: the real time since the previous running frame
 * pays off a freeze first (hitstop), the rest times `sim.timeScale` goes into the accumulator, and
 * whole steps are run (at most `MAX_STEPS_PER_FRAME`; the rest of a stall is dropped). The freeze
 * is checked before every step, so a hitstop requested by step k stops step k+1. A frame that
 * follows a pause, a bad timestamp or the start measures no elapsed time, so a resume never
 * catches up. While paused the loop only renders. The accumulator survives a pause, which makes a
 * paused-and-resumed run identical to an uninterrupted one.
 *
 * Every frame also records the continuous sim clock (`world.time.sim` plus the accumulator) in the
 * time map, paused or not.
 *
 * Fail-stop: the next frame is requested at the end of a successful frame, so an exception ends
 * the loop and reaches the global error hook. Nothing here allocates per frame.
 */
export function createGameLoop(options: GameLoopOptions): GameLoop {
  const { sim, timeMap, pause, render, onSimEvent } = options;
  const scheduler = options.scheduler ?? rafScheduler;
  const stats: LoopStats = { stepsLastFrame: 0, droppedBacklogMs: 0, frames: 0 };

  let isRunning = false; // between start() and stop()
  let isPending = false; // a frame is requested and has not run yet
  let handle = 0;
  let accumulatorMs = 0; // owed sim time
  let lastSeenAtReal = 0; // newest valid frame timestamp: timestamps never go back
  let lastRunningAtReal = 0;
  let hasLastRunning = false; // false after a pause, a start or at the beginning: next dt is 0
  let lastClockMs = 0;
  let lastBacklogWarnAtReal = Number.NEGATIVE_INFINITY;
  let lastTimestampWarnAtReal = Number.NEGATIVE_INFINITY;

  const onFrame = (frameAtReal: number): void => {
    isPending = false;
    stats.frames++;

    const isGood = Number.isFinite(frameAtReal) && frameAtReal >= lastSeenAtReal;
    if (isGood) lastSeenAtReal = frameAtReal;
    // A bad timestamp (NaN, or one that went back) measures no time: reuse the last good one so
    // that the pause and the time map keep seeing a monotone clock.
    const atReal = lastSeenAtReal;
    if (!isGood && atReal - lastTimestampWarnAtReal >= WARN_EVERY_MS) {
      lastTimestampWarnAtReal = atReal;
      log.warn('sim', 'bad frame timestamp counted as zero elapsed time', { frameAtReal });
    }

    pause.update(asRealMs(atReal));

    let steps = 0;
    let simPerRealMs = 0;
    if (pause.state === 'running') {
      let dtRealMs = 0;
      if (isGood) {
        if (hasLastRunning) dtRealMs = atReal - lastRunningAtReal;
        lastRunningAtReal = atReal;
        hasLastRunning = true;
      }

      // A hitstop eats real time first; rendering goes on meanwhile.
      if (sim.freezeRealMs > 0) {
        const consumedMs = Math.min(dtRealMs, sim.freezeRealMs);
        if (consumedMs > 0) sim.consumeFreeze(consumedMs);
        dtRealMs -= consumedMs;
      }

      accumulatorMs += dtRealMs * sim.timeScale;

      while (accumulatorMs >= STEP_MS && steps < MAX_STEPS_PER_FRAME && sim.freezeRealMs === 0) {
        sim.step();
        accumulatorMs -= STEP_MS;
        steps++;
        const events = sim.drainEvents();
        for (let i = 0; i < events.length; i++) onSimEvent(events[i] as SimEvent);
      }

      // Stopped by the cap with whole steps still owed: a stall. Drop them rather than spiral
      // (never because of a freeze: that time is spent after it).
      if (steps === MAX_STEPS_PER_FRAME && accumulatorMs >= STEP_MS && sim.freezeRealMs === 0) {
        const remainderMs = accumulatorMs % STEP_MS;
        const droppedMs = accumulatorMs - remainderMs;
        accumulatorMs = remainderMs;
        stats.droppedBacklogMs += droppedMs;
        if (atReal - lastBacklogWarnAtReal >= WARN_EVERY_MS) {
          lastBacklogWarnAtReal = atReal;
          log.warn('sim', `frame stall: dropped ${droppedMs} ms of sim backlog`, {
            droppedBacklogMs: stats.droppedBacklogMs,
          });
        }
      }

      simPerRealMs = sim.freezeRealMs > 0 ? 0 : sim.timeScale;
    } else {
      hasLastRunning = false;
    }
    stats.stepsLastFrame = steps;

    // Read the world fresh: it is another object after `restore`. The clamp absorbs a float
    // rounding of one ulp between two frames that run the same time.
    const clockMs = Math.max(sim.world.time.sim + accumulatorMs, lastClockMs);
    lastClockMs = clockMs;
    timeMap.record(asRealMs(atReal), asSimMs(clockMs), simPerRealMs);

    // Owed whole steps (held back by a freeze) must not push the view past the last step.
    render(Math.min(accumulatorMs / STEP_MS, 1));

    // Only a frame that went through asks for the next (fail-stop), and not after a stop().
    if (isRunning) {
      handle = scheduler.request(onFrame);
      isPending = true;
    }
  };

  return {
    stats,
    start() {
      if (isRunning) return;
      isRunning = true;
      hasLastRunning = false;
      handle = scheduler.request(onFrame);
      isPending = true;
    },
    stop() {
      isRunning = false;
      if (!isPending) return;
      scheduler.cancel(handle);
      isPending = false;
    },
  };
}
