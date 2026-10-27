import {
  TIME_MAP_CAPACITY,
  TIME_MAP_HISTORY_MS,
  TIME_MAP_MAX_EXTRAPOLATION_MS,
} from '@shared/constants';
import type { LogChannel } from '@shared/log';
import { asRealMs, asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTimeMap, type TimeMap } from './timeMap.ts';

type Point = readonly [realMs: number, simMs: number, simPerRealMs: number];

interface Warning {
  channel: LogChannel;
  message: string;
}

function build(points: readonly Point[]) {
  const warnings: Warning[] = [];
  const map = createTimeMap({
    logger: { warn: (channel, message) => warnings.push({ channel, message }) },
  });
  for (const [realMs, simMs, rate] of points) {
    map.record(asRealMs(realMs), asSimMs(simMs), rate);
  }
  return { map, warnings };
}

function at(map: TimeMap, realMs: number): number {
  return map.realToSim(asRealMs(realMs));
}

describe('createTimeMap › realToSim', () => {
  it('interpolates a steady run at timeScale 1', () => {
    const { map, warnings } = build([
      [0, 0, 1],
      [100, 100, 1],
      [200, 200, 1],
    ]);
    expect(at(map, 150)).toBeCloseTo(150, 9);
    expect(warnings).toEqual([]);
  });

  it('interpolates slow motion (sim runs slower than real time)', () => {
    const { map } = build([
      [0, 0, 0.3],
      [100, 30, 0.3],
      [200, 60, 0.3],
    ]);
    expect(at(map, 150)).toBeCloseTo(45, 9);
  });

  const FREEZE: Point[] = [
    [0, 0, 1],
    [100, 100, 0],
    [250, 100, 0],
    [300, 150, 1],
  ];

  it('holds the sim time flat on a freeze plateau', () => {
    const { map } = build(FREEZE);
    expect(at(map, 120)).toBeCloseTo(100, 9);
  });

  it('resumes interpolating right after the freeze plateau', () => {
    const { map } = build(FREEZE);
    expect(at(map, 275)).toBeCloseTo(125, 9);
  });

  it('holds the sim time flat across a long pause plateau', () => {
    const { map } = build([
      [0, 0, 1],
      [100, 100, 0],
      [1100, 100, 0],
      [1110, 100, 1],
      [1200, 190, 1],
    ]);
    expect(at(map, 600)).toBeCloseTo(100, 9);
  });

  it('extrapolates after the newest record at the newest rate (slow motion)', () => {
    const { map } = build([[300, 160, 0.3]]);
    expect(at(map, 400)).toBeCloseTo(190, 9);
  });

  it('extrapolates after the newest record at the newest rate (steady)', () => {
    const { map } = build([
      [200, 100, 1],
      [300, 200, 1],
    ]);
    expect(at(map, 350)).toBeCloseTo(250, 9);
  });

  it('caps the extrapolation at TIME_MAP_MAX_EXTRAPOLATION_MS past the newest record, with a warning', () => {
    const { map, warnings } = build([
      [200, 100, 1],
      [300, 200, 1],
    ]);
    expect(at(map, 300 + TIME_MAP_MAX_EXTRAPOLATION_MS)).toBeCloseTo(
      200 + TIME_MAP_MAX_EXTRAPOLATION_MS,
      9,
    );
    expect(warnings).toEqual([]); // exactly at the cap is still fine
    expect(at(map, 5000)).toBeCloseTo(200 + TIME_MAP_MAX_EXTRAPOLATION_MS, 9);
    expect(warnings).toEqual([{ channel: 'input', message: expect.stringContaining('capped') }]);
  });

  it('warns once per recorded frame, not once per input past the cap', () => {
    const { map, warnings } = build([[300, 200, 1]]);
    for (let i = 0; i < 5; i++) at(map, 5000 + i);
    expect(warnings).toHaveLength(1);
    map.record(asRealMs(6000), asSimMs(300), 1); // a new frame: the next excess may warn again
    at(map, 9000);
    at(map, 9001);
    expect(warnings).toHaveLength(2);
  });

  it("caps at the newest record's rate, so a slow-motion tail is capped in sim time too", () => {
    const { map } = build([[300, 160, 0.3]]);
    expect(at(map, 10_000)).toBeCloseTo(160 + TIME_MAP_MAX_EXTRAPOLATION_MS * 0.3, 9);
  });

  it('does not move after the newest record when that record is frozen or paused (rate 0)', () => {
    const { map } = build([[300, 160, 0]]);
    expect(at(map, 400)).toBe(160);
  });

  it('lets the later of two records with the same real timestamp win at that instant', () => {
    const { map } = build([
      [0, 0, 1],
      [100, 100, 1],
      [100, 110, 1],
      [200, 210, 1],
    ]);
    expect(at(map, 100)).toBe(110);
    expect(at(map, 150)).toBeCloseTo(160, 9);
  });

  it('accepts two records at the same real timestamp with the same sim time', () => {
    const { map } = build([
      [100, 100, 1],
      [100, 100, 1],
    ]);
    expect(at(map, 100)).toBe(100);
  });

  it('converts a timestamp exactly TIME_MAP_HISTORY_MS back without a warning', () => {
    const newestAtReal = TIME_MAP_HISTORY_MS + 500;
    const points: Point[] = [];
    for (let realMs = 0; realMs <= newestAtReal; realMs += 100) points.push([realMs, realMs, 1]);
    const { map, warnings } = build(points);
    expect(at(map, newestAtReal - TIME_MAP_HISTORY_MS)).toBeCloseTo(500, 9);
    expect(warnings).toEqual([]);
  });

  it('clamps a timestamp older than the history to its start, with an input warning', () => {
    const newestAtReal = TIME_MAP_HISTORY_MS * 2;
    const points: Point[] = [];
    for (let realMs = 0; realMs <= newestAtReal; realMs += 100) points.push([realMs, realMs, 1]);
    const { map, warnings } = build(points);
    const historyStartAtReal = newestAtReal - TIME_MAP_HISTORY_MS;
    expect(at(map, historyStartAtReal - 1)).toBe(historyStartAtReal);
    expect(at(map, 0)).toBe(historyStartAtReal);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]?.channel).toBe('input');
  });

  it('answers 0 with an input warning while the history is empty', () => {
    const { map, warnings } = build([]);
    expect(at(map, 123)).toBe(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.channel).toBe('input');
  });

  it('throws on a non-finite query', () => {
    const { map } = build([[0, 0, 1]]);
    expect(() => at(map, Number.NaN)).toThrow();
    expect(() => at(map, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('forgets everything on reset', () => {
    const { map, warnings } = build([
      [0, 0, 1],
      [100, 100, 1],
    ]);
    map.reset();
    expect(at(map, 50)).toBe(0);
    expect(warnings).toHaveLength(1);
    map.record(asRealMs(5), asSimMs(5), 1);
    expect(at(map, 7)).toBeCloseTo(7, 9);
  });
});

describe('createTimeMap › record', () => {
  it('keeps the newest records and stays monotone when more than TIME_MAP_CAPACITY arrive inside the history', () => {
    // 0.5 ms apart: far more than the capacity fits in TIME_MAP_HISTORY_MS.
    const count = TIME_MAP_CAPACITY * 2 + 17;
    const stepMs = (TIME_MAP_HISTORY_MS / TIME_MAP_CAPACITY) * 0.5;
    const { map, warnings } = build([]);
    for (let i = 0; i < count; i++) {
      map.record(asRealMs(i * stepMs), asSimMs(i * stepMs), 1);
    }
    const newestAtReal = (count - 1) * stepMs;
    // The newest stretch is intact.
    expect(at(map, newestAtReal)).toBeCloseTo(newestAtReal, 6);
    expect(at(map, newestAtReal - stepMs * 10.5)).toBeCloseTo(newestAtReal - stepMs * 10.5, 6);
    // Conversions are non-decreasing over the whole kept stretch.
    const oldestKeptAtReal = newestAtReal - (TIME_MAP_CAPACITY - 1) * stepMs;
    let previous = Number.NEGATIVE_INFINITY;
    for (let query = oldestKeptAtReal; query <= newestAtReal; query += stepMs * 7.3) {
      const sim = at(map, query);
      expect(sim).toBeGreaterThanOrEqual(previous);
      previous = sim;
    }
    // Older than the oldest kept record: clamped, with a warning.
    expect(at(map, 0)).toBeGreaterThan(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('serves nothing older than TIME_MAP_HISTORY_MS before the newest record, even if a record is still kept there', () => {
    const newestAtReal = TIME_MAP_HISTORY_MS + 200;
    const { map, warnings } = build([
      [0, 0, 1],
      [100, 100, 1],
      [newestAtReal, newestAtReal, 1],
    ]);
    // Exactly TIME_MAP_HISTORY_MS back is inside, and the kept record at 100 anchors it.
    expect(at(map, 200)).toBeCloseTo(200, 9);
    expect(warnings).toEqual([]);
    // One step further back is outside: clamped to the start of the history, with a warning.
    expect(at(map, 150)).toBeCloseTo(200, 9);
    expect(warnings).toHaveLength(1);
  });

  it('throws when the real time decreases', () => {
    const { map } = build([[100, 100, 1]]);
    expect(() => map.record(asRealMs(99), asSimMs(120), 1)).toThrow();
  });

  it('throws when the sim time decreases', () => {
    const { map } = build([[100, 100, 1]]);
    expect(() => map.record(asRealMs(120), asSimMs(99), 1)).toThrow();
  });

  it('throws on a non-finite value or a negative rate', () => {
    const { map } = build([]);
    expect(() => map.record(asRealMs(Number.NaN), asSimMs(0), 1)).toThrow();
    expect(() => map.record(asRealMs(0), asSimMs(Number.POSITIVE_INFINITY), 1)).toThrow();
    expect(() => map.record(asRealMs(0), asSimMs(0), Number.NaN)).toThrow();
    expect(() => map.record(asRealMs(0), asSimMs(0), -0.5)).toThrow();
  });
});
