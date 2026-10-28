import { PERF_HISTOGRAM_MAX_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import { createPerfMeter, type PerfMeter } from './perfMeter.ts';

/** Feeds `count` frames spaced by `intervalMs`, from `startAt`; returns the time of the last one. */
function feed(meter: PerfMeter, count: number, intervalMs: number, startAt = 0): number {
  let at = startAt;
  for (let i = 0; i < count; i++) {
    meter.frame(at, 10, 1000);
    at += intervalMs;
  }
  return at - intervalMs;
}

/** `share` frames at `fastMs`, the rest at `slowMs`, interleaved evenly (order does not change a p95). */
function feedMix(
  meter: PerfMeter,
  total: number,
  slowCount: number,
  fastMs: number,
  slowMs: number,
) {
  let at = 0;
  meter.frame(at, 0, 0);
  for (let i = 0; i < total; i++) {
    at += i < slowCount ? slowMs : fastMs;
    meter.frame(at, 0, 0);
  }
}

describe('createPerfMeter', () => {
  it('reports zeros before any frame', () => {
    expect(createPerfMeter().report()).toEqual({
      frames: 0,
      fpsLastSecond: 0,
      frameMsMeanLastSecond: 0,
      frameMsMean: 0,
      frameMsP95: 0,
      frameMsMax: 0,
      drawCallsMax: 0,
      trianglesMax: 0,
    });
  });

  it('gives no interval for the first frame', () => {
    const meter = createPerfMeter();
    meter.frame(1000, 5, 50);
    const report = meter.report();
    expect(report.frames).toBe(1);
    expect(report.frameMsP95).toBe(0);
    expect(report.frameMsMean).toBe(0);
    expect(report.frameMsMax).toBe(0);
  });

  it('reads a constant 16.7 ms stream as p95 16.7 ms (a bucket edge) and 60 FPS', () => {
    const meter = createPerfMeter();
    feed(meter, 200, 16.7);
    const report = meter.report();
    expect(report.frameMsP95).toBe(16.7);
    expect(report.frameMsMean).toBeCloseTo(16.7, 6);
    expect(report.frameMsMax).toBeCloseTo(16.7, 6);
    expect(Math.round(report.fpsLastSecond)).toBe(60);
    expect(report.frameMsMeanLastSecond).toBeCloseTo(16.7, 1);
  });

  it('puts an interval on the upper edge of its bucket: 16.71 ms reads 16.8, 16.0 reads 16.0', () => {
    const slow = createPerfMeter();
    feed(slow, 20, 16.71);
    expect(slow.report().frameMsP95).toBe(16.8);
    const exact = createPerfMeter();
    feed(exact, 20, 16);
    expect(exact.report().frameMsP95).toBe(16);
  });

  it('94 % at 16 ms and 6 % at 40 ms has a p95 at 40 ms; 96 % and 4 % has 16 ms', () => {
    const slowTail = createPerfMeter();
    feedMix(slowTail, 100, 6, 16, 40);
    expect(slowTail.report().frameMsP95).toBe(40);
    const fastTail = createPerfMeter();
    feedMix(fastTail, 100, 4, 16, 40);
    expect(fastTail.report().frameMsP95).toBe(16);
  });

  it('keeps an interval above the histogram in the overflow bucket and reports it as the max', () => {
    const meter = createPerfMeter();
    meter.frame(0, 0, 0);
    meter.frame(16, 0, 0);
    meter.frame(16 + PERF_HISTOGRAM_MAX_MS + 100, 0, 0);
    const report = meter.report();
    expect(report.frameMsMax).toBe(PERF_HISTOGRAM_MAX_MS + 100);
    // Two intervals, 95 % of them is both: the slowest one holds the p95.
    expect(report.frameMsP95).toBe(PERF_HISTOGRAM_MAX_MS + 100);
  });

  it('counts an interval of exactly the histogram max in the last regular bucket', () => {
    const meter = createPerfMeter();
    meter.frame(0, 0, 0);
    meter.frame(PERF_HISTOGRAM_MAX_MS, 0, 0);
    expect(meter.report().frameMsP95).toBe(PERF_HISTOGRAM_MAX_MS);
  });

  it('keeps the max draw calls and the max triangles', () => {
    const meter = createPerfMeter();
    meter.frame(0, 40, 9000);
    meter.frame(16, 71, 8000);
    meter.frame(32, 55, 12_000);
    const report = meter.report();
    expect(report.drawCallsMax).toBe(71);
    expect(report.trianglesMax).toBe(12_000);
  });

  it('reset() forgets everything, and the next frame is a first frame again', () => {
    const meter = createPerfMeter();
    feed(meter, 200, 30);
    meter.reset();
    expect(meter.report()).toEqual(createPerfMeter().report());
    meter.frame(99_999, 3, 3);
    expect(meter.report().frames).toBe(1);
    expect(meter.report().frameMsP95).toBe(0);
  });

  it('skipNextInterval() drops the gap of a hidden page but keeps the rest', () => {
    const meter = createPerfMeter();
    const last = feed(meter, 50, 16);
    meter.skipNextInterval();
    // The tab was hidden for 30 s: that is not a frame.
    meter.frame(last + 30_000, 0, 0);
    meter.frame(last + 30_016, 0, 0);
    const report = meter.report();
    expect(report.frames).toBe(52);
    expect(report.frameMsMax).toBe(16);
    expect(report.frameMsP95).toBe(16);
  });

  it('takes the FPS of the last whole second, not of the whole level', () => {
    const meter = createPerfMeter();
    // 2 s at 60 FPS, then 2 s at 30 FPS: the counter follows the present.
    const after60 = feed(meter, 121, 1000 / 60);
    feed(meter, 70, 1000 / 30, after60 + 1000 / 30);
    expect(Math.round(meter.report().fpsLastSecond)).toBe(30);
    expect(meter.report().frameMsMeanLastSecond).toBeCloseTo(1000 / 30, 0);
  });

  it('reports 0 FPS until a whole second has passed', () => {
    const meter = createPerfMeter();
    feed(meter, 20, 16);
    expect(meter.report().fpsLastSecond).toBe(0);
  });

  it('hands out the same object each time (nothing is allocated), with the latest numbers', () => {
    const meter = createPerfMeter();
    feed(meter, 5, 16);
    const first = meter.report();
    feed(meter, 5, 16, 1000);
    expect(meter.report()).toBe(first);
    expect(first.frames).toBe(10);
  });
});
