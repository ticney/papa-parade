import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  createSpring,
  omegaOf,
  reachTauOf,
  resetSpring,
  type Spring,
  stepAngleSpring,
  stepSpring,
} from './characterSpring.ts';

const DEG = Math.PI / 180;
const NO_CAP = Number.POSITIVE_INFINITY;

/** Runs a spring on a constant target for `totalMs`, in frames of `frameMs`; the peak and the first reach. */
function run(
  spring: Spring,
  target: number,
  totalMs: number,
  frameMs: number,
  reachMs: number,
  zeta: number,
  cap = NO_CAP,
): { peak: number; firstReachMs: number | null; final: number } {
  let peak = spring.drawn;
  let firstReachMs: number | null = null;
  for (let t = 0; t < totalMs; t += frameMs) {
    const value = stepSpring(spring, target, frameMs, reachMs, zeta, cap);
    if (Math.abs(value) > Math.abs(peak)) peak = value;
    if (firstReachMs === null && Math.abs(value) >= Math.abs(target)) firstReachMs = t + frameMs;
  }
  return { peak, firstReachMs, final: spring.drawn };
}

describe('the characters spring (story 7.8, D5)', () => {
  it('never overshoots at a damping of 1', () => {
    const spring = createSpring(0);
    const { peak, final } = run(spring, 90, 3000, STEP_MS, 250, 1);
    expect(peak).toBeLessThanOrEqual(90);
    expect(final).toBeCloseTo(90, 6);
  });

  it('overshoots a 90° turn by 5 to 10° at a damping of 0.6, then settles', () => {
    const spring = createSpring(0);
    const { peak, final, firstReachMs } = run(spring, 90 * DEG, 3000, STEP_MS, 250, 0.6, 10 * DEG);
    const overshootDeg = peak / DEG - 90;
    expect(overshootDeg).toBeGreaterThanOrEqual(5);
    expect(overshootDeg).toBeLessThanOrEqual(10);
    expect(final / DEG).toBeCloseTo(90, 4);
    // It first reaches its target « about » the reach time: 95 % in 250 ms, the crossing a little later.
    expect(firstReachMs).toBeGreaterThanOrEqual(230);
    expect(firstReachMs).toBeLessThanOrEqual(300);
  });

  it('caps the swing of a 180° turn at the overshoot cap', () => {
    const spring = createSpring(0);
    const { peak } = run(spring, 180 * DEG, 3000, STEP_MS, 250, 0.6, 10 * DEG);
    // Uncapped it would swing about 17° past.
    expect(peak / DEG - 180).toBeLessThanOrEqual(10 + 1e-9);
    expect(peak / DEG - 180).toBeGreaterThan(9);
    const uncapped = run(createSpring(0), 180 * DEG, 3000, STEP_MS, 250, 0.6);
    expect(uncapped.peak / DEG - 180).toBeGreaterThan(15);
  });

  it('holds still for a dt of 0 (a pause, a hitstop, the end photo)', () => {
    const spring = createSpring(0);
    stepSpring(spring, 1, 37, 250, 0.6, NO_CAP);
    const before = { ...spring };
    expect(stepSpring(spring, 1, 0, 250, 0.6, NO_CAP)).toBe(before.drawn);
    expect(spring).toEqual(before);
  });

  it.each([1, 3, 7])('gives the same value whether a span is split in %i frames', (frames) => {
    const reference = createSpring(0);
    stepSpring(reference, 1, 210, 250, 0.6, NO_CAP);
    const split = createSpring(0);
    for (let i = 0; i < frames; i++) stepSpring(split, 1, 210 / frames, 250, 0.6, NO_CAP);
    expect(split.value).toBeCloseTo(reference.value, 12);
    expect(split.drawn).toBeCloseTo(reference.drawn, 12);
    expect(split.velocityPerMs).toBeCloseTo(reference.velocityPerMs, 12);
  });

  it('draws between its last two steps by the time left over', () => {
    const spring = createSpring(0);
    stepSpring(spring, 1, STEP_MS, 250, 1, NO_CAP);
    const afterOne = spring.value;
    const drawn = stepSpring(spring, 1, STEP_MS / 2, 250, 1, NO_CAP);
    expect(spring.value).toBe(afterOne);
    expect(drawn).toBeGreaterThan(0);
    expect(drawn).toBeLessThan(afterOne);
  });

  it('follows a feel change at once (new reach, new damping)', () => {
    const slow = createSpring(0);
    const fast = createSpring(0);
    stepSpring(slow, 1, 100, 1000, 1, NO_CAP);
    stepSpring(fast, 1, 100, 1000, 1, NO_CAP);
    stepSpring(slow, 1, 100, 1000, 1, NO_CAP);
    stepSpring(fast, 1, 100, 50, 1, NO_CAP);
    expect(fast.value).toBeGreaterThan(slow.value);
  });

  it('gives ω from the reach time and the damping', () => {
    expect(omegaOf(250, 1)).toBeCloseTo(reachTauOf(1) / 250, 12);
    expect(reachTauOf(1)).toBeCloseTo(4.74, 2);
    expect(reachTauOf(0.6)).toBeGreaterThan(2);
    expect(reachTauOf(0.6)).toBeLessThan(reachTauOf(1));
  });

  it('starts at rest again on a reset', () => {
    const spring = createSpring(0);
    stepSpring(spring, 1, 55, 250, 0.6, NO_CAP);
    resetSpring(spring, 2);
    expect(spring).toMatchObject({ value: 2, prevValue: 2, drawn: 2, velocityPerMs: 0 });
    expect(spring.leftoverMs).toBe(0);
  });

  it('turns an angle by the shortest arc, through the half turn', () => {
    const spring = createSpring(170 * DEG);
    for (let i = 0; i < 300; i++) stepAngleSpring(spring, -170 * DEG, STEP_MS, 250, 1, NO_CAP);
    // 190° the long way round is -170°: it went up through 180°, not down through 0.
    expect(spring.drawn / DEG).toBeCloseTo(190, 4);
    let lowest = Number.POSITIVE_INFINITY;
    const other = createSpring(170 * DEG);
    for (let i = 0; i < 300; i++) {
      lowest = Math.min(lowest, stepAngleSpring(other, -170 * DEG, STEP_MS, 250, 1, NO_CAP));
    }
    expect(lowest / DEG).toBeGreaterThanOrEqual(170 - 1e-9);
  });

  it('keeps an angle spring near 0 over many turns', () => {
    const spring = createSpring(0);
    let target = 0;
    for (let i = 0; i < 200; i++) {
      target += 120 * DEG;
      for (let k = 0; k < 50; k++) stepAngleSpring(spring, target, STEP_MS, 250, 0.6, 10 * DEG);
    }
    expect(Math.abs(spring.value)).toBeLessThan(6 * Math.PI);
    for (let k = 0; k < 300; k++) stepAngleSpring(spring, target, STEP_MS, 250, 0.6, 10 * DEG);
    const wrapped = Math.atan2(Math.sin(spring.drawn), Math.cos(spring.drawn));
    const wanted = Math.atan2(Math.sin(target), Math.cos(target));
    expect(wrapped).toBeCloseTo(wanted, 5);
  });

  it('does not let the cap pull it when the target jumps back during a swing', () => {
    const spring = createSpring(0);
    // Into the swing past 90°...
    for (let i = 0; i < 30; i++) stepSpring(spring, 90, STEP_MS, 250, 0.6, 10);
    expect(spring.isPast).toBe(true);
    const before = spring.value;
    // ...the target jumps 40° back: the spring keeps moving smoothly, it does not jump to the cap.
    stepSpring(spring, 50, STEP_MS, 250, 0.6, 10);
    expect(Math.abs(spring.value - before)).toBeLessThan(5);
  });
});
