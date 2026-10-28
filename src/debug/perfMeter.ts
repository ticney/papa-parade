import { MS_PER_S, PERF_BUCKET_MS, PERF_HISTOGRAM_MAX_MS } from '@shared/constants';

/** What a level's frames measured so far. Times are frame intervals in real ms. */
export interface PerfReport {
  /** Level frames drawn since the last `reset()`. */
  frames: number;
  /** Frames per second over the last whole second (0 until one has passed). */
  fpsLastSecond: number;
  /** Mean frame interval over the last whole second, ms (0 until one has passed). */
  frameMsMeanLastSecond: number;
  frameMsMean: number;
  /** The upper edge of the histogram bucket that holds the 95th percentile: exact to `PERF_BUCKET_MS`, never optimistic. */
  frameMsP95: number;
  frameMsMax: number;
  drawCallsMax: number;
  trianglesMax: number;
}

export interface PerfMeter {
  /**
   * One level frame was drawn at real time `frameAtReal` (ms) with these renderer stats. The first
   * frame after `reset()` or `skipNextInterval()` has no previous frame, so it adds no interval.
   */
  frame(frameAtReal: number, drawCalls: number, triangles: number): void;
  /** Forgets everything: a new level starts. */
  reset(): void;
  /** The next frame adds no interval: the page was hidden or came back, and that gap is not a frame. */
  skipNextInterval(): void;
  /** One object, rewritten by each call (no allocation): copy it to keep it. */
  report(): Readonly<PerfReport>;
}

/** Buckets 0..BUCKET_COUNT hold the intervals up to the max; the last one is the overflow. */
const BUCKET_COUNT = Math.round(PERF_HISTOGRAM_MAX_MS / PERF_BUCKET_MS);
const OVERFLOW_BUCKET = BUCKET_COUNT + 1;
const P95_SHARE = 0.95;
/** Absorbs the float error of `interval / PERF_BUCKET_MS` (16.7 / 0.1 is 167.00000000000003). */
const BUCKET_EPSILON = 1e-9;

/**
 * Measures the frame intervals of a level, for the debug FPS counter and `__PP__.perf()`. Pure,
 * and nothing is allocated per frame: the p95 comes from a fixed histogram, the rolling FPS from a
 * running count, and `report()` rewrites one object. Bucket `k` holds the intervals in
 * `((k − 1) × PERF_BUCKET_MS, k × PERF_BUCKET_MS]`, so a constant 16.7 ms stream reports p95 16.7.
 */
export function createPerfMeter(): PerfMeter {
  const histogram = new Uint32Array(OVERFLOW_BUCKET + 1);
  const out: PerfReport = {
    frames: 0,
    fpsLastSecond: 0,
    frameMsMeanLastSecond: 0,
    frameMsMean: 0,
    frameMsP95: 0,
    frameMsMax: 0,
    drawCallsMax: 0,
    trianglesMax: 0,
  };
  let frames = 0;
  let intervals = 0;
  let intervalSumMs = 0;
  let intervalMaxMs = 0;
  let drawCallsMax = 0;
  let trianglesMax = 0;
  let hasPrevious = false;
  let previousAtReal = 0;
  // The rolling second: a count and a start, closed by the first frame that is a second past it.
  let secondStartAtReal = 0;
  let secondCount = 0;
  let fpsLastSecond = 0;
  let meanLastSecondMs = 0;

  const meter: PerfMeter = {
    frame(frameAtReal, drawCalls, triangles) {
      frames++;
      if (drawCalls > drawCallsMax) drawCallsMax = drawCalls;
      if (triangles > trianglesMax) trianglesMax = triangles;
      if (!hasPrevious) {
        hasPrevious = true;
        previousAtReal = frameAtReal;
        secondStartAtReal = frameAtReal;
        secondCount = 0;
        return;
      }
      const intervalMs = Math.max(0, frameAtReal - previousAtReal);
      previousAtReal = frameAtReal;
      intervals++;
      intervalSumMs += intervalMs;
      if (intervalMs > intervalMaxMs) intervalMaxMs = intervalMs;
      const bucket =
        intervalMs > PERF_HISTOGRAM_MAX_MS
          ? OVERFLOW_BUCKET
          : Math.max(0, Math.ceil(intervalMs / PERF_BUCKET_MS - BUCKET_EPSILON));
      histogram[bucket]++;
      secondCount++;
      const secondMs = frameAtReal - secondStartAtReal;
      if (secondMs >= MS_PER_S) {
        fpsLastSecond = (secondCount * MS_PER_S) / secondMs;
        meanLastSecondMs = secondMs / secondCount;
        secondStartAtReal = frameAtReal;
        secondCount = 0;
      }
    },

    reset() {
      histogram.fill(0);
      frames = 0;
      intervals = 0;
      intervalSumMs = 0;
      intervalMaxMs = 0;
      drawCallsMax = 0;
      trianglesMax = 0;
      hasPrevious = false;
      secondCount = 0;
      fpsLastSecond = 0;
      meanLastSecondMs = 0;
    },

    skipNextInterval() {
      hasPrevious = false;
    },

    report() {
      out.frames = frames;
      out.fpsLastSecond = fpsLastSecond;
      out.frameMsMeanLastSecond = meanLastSecondMs;
      out.frameMsMean = intervals === 0 ? 0 : intervalSumMs / intervals;
      out.frameMsMax = intervalMaxMs;
      out.drawCallsMax = drawCallsMax;
      out.trianglesMax = trianglesMax;
      out.frameMsP95 = p95Ms();
      return out;
    },
  };

  /** The upper edge of the bucket where the cumulative count first reaches 95 % of the intervals. */
  function p95Ms(): number {
    if (intervals === 0) return 0;
    const wanted = Math.ceil(intervals * P95_SHARE);
    let cumulative = 0;
    for (let bucket = 0; bucket <= OVERFLOW_BUCKET; bucket++) {
      cumulative += histogram[bucket] as number;
      if (cumulative < wanted) continue;
      // The overflow bucket has no upper edge: the slowest interval seen is the honest figure.
      if (bucket === OVERFLOW_BUCKET) return intervalMaxMs;
      return Math.round(bucket * PERF_BUCKET_MS * 1e6) / 1e6;
    }
    return intervalMaxMs;
  }

  return meter;
}
