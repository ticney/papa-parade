import { describe, expect, it } from 'vitest';
import { type CalibrationRules, computePhaseOffset } from './calibration.ts';

// 100 BPM: a beat every 600 ms.
const RULES: CalibrationRules = {
  bpm: 100,
  outlierMs: 150,
  offsetMinMs: -50,
  offsetMaxMs: 250,
  minValidTaps: 5,
};
const BEATS = [1000, 1600, 2200, 2800, 3400, 4000, 4600, 5200];
const lagged = (gapsMs: number[], beats = BEATS): number[] =>
  gapsMs.map((gap, i) => (beats[i] as number) + gap);

describe('computePhaseOffset', () => {
  it('gives 0 for taps exactly on the beats', () => {
    expect(computePhaseOffset(BEATS, [...BEATS], RULES)).toEqual({
      isEnough: true,
      offsetMs: 0,
      validCount: 8,
    });
  });

  it('gives a constant lag back', () => {
    expect(
      computePhaseOffset(
        BEATS,
        BEATS.map((b) => b + 90),
        RULES,
      ),
    ).toMatchObject({
      isEnough: true,
      offsetMs: 90,
    });
    expect(
      computePhaseOffset(
        BEATS,
        BEATS.map((b) => b - 30),
        RULES,
      ),
    ).toMatchObject({
      isEnough: true,
      offsetMs: -30,
    });
  });

  it('clamps to the bounds', () => {
    expect(
      computePhaseOffset(
        BEATS,
        BEATS.map((b) => b + 280),
        RULES,
      ),
    ).toMatchObject({
      offsetMs: 250,
    });
    expect(
      computePhaseOffset(
        BEATS,
        BEATS.map((b) => b - 120),
        { ...RULES, outlierMs: 500 },
      ),
    ).toMatchObject({ offsetMs: -50 });
    expect(
      computePhaseOffset(
        BEATS,
        BEATS.map((b) => b + 250),
        RULES,
      ),
    ).toMatchObject({
      offsetMs: 250,
    });
    expect(
      computePhaseOffset(
        BEATS,
        BEATS.map((b) => b - 50),
        RULES,
      ),
    ).toMatchObject({
      offsetMs: -50,
    });
  });

  it('keeps an outlier at exactly outlierMs from the median and rejects one at 151', () => {
    const base = [100, 100, 100, 100, 100, 100, 100];
    const kept = computePhaseOffset(BEATS, lagged([...base, 250]), RULES);
    expect(kept).toMatchObject({ isEnough: true, validCount: 8 });
    const rejected = computePhaseOffset(BEATS, lagged([...base, 251]), RULES);
    expect(rejected).toMatchObject({ isEnough: true, validCount: 7, offsetMs: 100 });
  });

  it('takes the median of the kept values: the middle one when odd, the mean of the two when even', () => {
    const odd = computePhaseOffset(BEATS, lagged([40, 60, 80, 100, 120]), RULES);
    expect(odd).toEqual({ isEnough: true, offsetMs: 80, validCount: 5 });
    const even = computePhaseOffset(BEATS, lagged([40, 60, 80, 100, 120, 140]), RULES);
    expect(even).toEqual({ isEnough: true, offsetMs: 90, validCount: 6 });
  });

  it('rounds to a whole millisecond, and never answers -0', () => {
    const rounded = computePhaseOffset(BEATS, lagged([10, 11, 12, 13, 14, 15]), RULES);
    expect(rounded).toMatchObject({ offsetMs: 13 }); // median 12.5 -> 13
    const zero = computePhaseOffset(BEATS, lagged([-0.4, -0.4, -0.4, -0.4, -0.4]), RULES);
    expect(Object.is((zero as { offsetMs: number }).offsetMs, 0)).toBe(true);
  });

  it('keeps only the first tap of a beat (a double tap)', () => {
    const taps = [...BEATS.map((b) => b + 100), BEATS[0] + 250, BEATS[1] + 260].sort(
      (a, b) => a - b,
    );
    expect(computePhaseOffset(BEATS, taps, RULES)).toEqual({
      isEnough: true,
      offsetMs: 100,
      validCount: 8,
    });
  });

  it('counts a double tap once: 5 beats tapped twice are 5 valid, not 10', () => {
    const taps = BEATS.slice(0, 5).flatMap((b) => [b + 50, b + 60]);
    expect(computePhaseOffset(BEATS, taps, RULES)).toEqual({
      isEnough: true,
      offsetMs: 50,
      validCount: 5,
    });
  });

  it('refuses 4 valid taps and accepts 5', () => {
    expect(computePhaseOffset(BEATS, lagged([20, 20, 20, 20]), RULES)).toEqual({
      isEnough: false,
      validCount: 4,
    });
    expect(computePhaseOffset(BEATS, lagged([20, 20, 20, 20, 20]), RULES)).toMatchObject({
      isEnough: true,
      validCount: 5,
    });
  });

  it('refuses no taps at all', () => {
    expect(computePhaseOffset(BEATS, [], RULES)).toEqual({ isEnough: false, validCount: 0 });
  });

  it('refuses no beats at all', () => {
    expect(computePhaseOffset([], [1, 2, 3], RULES)).toEqual({ isEnough: false, validCount: 0 });
  });

  it('drops a tap further than half a beat interval from every beat', () => {
    // 301 ms after beat 0 is 299 ms before beat 1: both over... 300 is half: 301 is closer to beat 1.
    const far = [BEATS[0] - 301, BEATS[7] + 301];
    expect(computePhaseOffset(BEATS, far, { ...RULES, minValidTaps: 1 })).toEqual({
      isEnough: false,
      validCount: 0,
    });
    // Exactly half an interval is still a tap (pairs with the earlier beat on a tie).
    expect(
      computePhaseOffset(BEATS, [BEATS[7] + 300], { ...RULES, minValidTaps: 1 }),
    ).toMatchObject({ isEnough: true, offsetMs: 250 });
  });

  it('pairs a tap before the first beat with the first beat when it is within half an interval', () => {
    const taps = [BEATS[0] - 100, ...BEATS.slice(1, 5).map((b) => b - 100)];
    expect(computePhaseOffset(BEATS, taps, RULES)).toMatchObject({
      isEnough: true,
      offsetMs: -50,
      validCount: 5,
    });
  });

  it('pairs each tap with the nearest beat, whatever the order they come in', () => {
    const taps = [...BEATS].reverse().map((b) => b + 40);
    expect(computePhaseOffset(BEATS, taps, RULES)).toMatchObject({ offsetMs: 40, validCount: 8 });
  });

  it('does not change its inputs', () => {
    const taps = [...BEATS].reverse();
    const copy = [...taps];
    const beats = [...BEATS];
    computePhaseOffset(beats, taps, RULES);
    expect(taps).toEqual(copy);
    expect(beats).toEqual(BEATS);
  });
});
