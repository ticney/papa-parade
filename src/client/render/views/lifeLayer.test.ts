import { STEP_MS } from '@shared/constants';
import { describe, expect, it } from 'vitest';
import {
  type BreathConfig,
  breathPeriodMsOf,
  createBreathState,
  createLeanState,
  type LeanConfig,
  resetBreath,
  resetLean,
  stepBreath,
  stepLean,
  stoopDegOf,
} from './lifeLayer.ts';

const LEAN: LeanConfig = {
  maxAccelDeg: 10,
  maxTurnDeg: 8,
  fullAccelMps2: 45,
  fullTurnDegPerSec: 360,
  reachMs: 120,
};
const BREATH: BreathConfig = {
  periodMs: 3000,
  alertPeriodMs: 1500,
  papaAmplitudeDeg: 1.5,
  babyAmplitudeDeg: 2,
};
const DEG = Math.PI / 180;

describe('the lean (story 7.8, D6)', () => {
  it('pitches forward into a start, back from a stop, and returns to 0 at a steady speed', () => {
    const lean = createLeanState();
    let peakForward = 0;
    for (let t = 0; t < 400; t += STEP_MS) {
      stepLean(lean, 4, 0, STEP_MS, LEAN, false);
      peakForward = Math.max(peakForward, lean.pitchDeg);
    }
    expect(peakForward).toBeGreaterThan(5);
    expect(peakForward).toBeLessThanOrEqual(10);
    for (let t = 0; t < 1000; t += STEP_MS) stepLean(lean, 4, 0, STEP_MS, LEAN, false);
    expect(Math.abs(lean.pitchDeg)).toBeLessThan(0.05);
    let peakBack = 0;
    for (let t = 0; t < 400; t += STEP_MS) {
      stepLean(lean, 0, 0, STEP_MS, LEAN, false);
      peakBack = Math.min(peakBack, lean.pitchDeg);
    }
    expect(peakBack).toBeLessThan(-5);
    expect(peakBack).toBeGreaterThanOrEqual(-10);
  });

  it('pitches in proportion to the speed step, so a crawl leans him far less than a walk (the review)', () => {
    const peakOf = (speedMps: number): number => {
      const lean = createLeanState();
      let peak = 0;
      for (let t = 0; t < 600; t += STEP_MS) {
        stepLean(lean, speedMps, 0, STEP_MS, LEAN, false);
        peak = Math.max(peak, lean.pitchDeg);
      }
      return peak;
    };
    const walk = peakOf(3);
    const crawl = peakOf(0.6);
    expect(walk).toBeGreaterThan(5);
    expect(crawl).toBeGreaterThan(0);
    // 8 m/s² made both saturate at maxAccelDeg: here a crawl is about a fifth of a walk.
    expect(crawl).toBeLessThan(walk * 0.4);
  });

  it('leans into a turn, toward its inside, up to maxTurnDeg', () => {
    const lean = createLeanState();
    // Turning toward his left (+x) at 720°/s: past the full rate, so the full lean, to his left.
    const leftRadPerMs = (720 * DEG) / 1000;
    for (let t = 0; t < 1000; t += STEP_MS) stepLean(lean, 0, leftRadPerMs, STEP_MS, LEAN, false);
    expect(lean.rollDeg).toBeCloseTo(-8, 3);
    for (let t = 0; t < 1000; t += STEP_MS)
      stepLean(lean, 0, -leftRadPerMs / 4, STEP_MS, LEAN, false);
    // A quarter of the full rate the other way: a quarter of the lean, to his right.
    expect(lean.rollDeg).toBeCloseTo(8 * (720 / 4 / 360), 3);
    for (let t = 0; t < 1000; t += STEP_MS) stepLean(lean, 0, 0, STEP_MS, LEAN, false);
    expect(Math.abs(lean.rollDeg)).toBeLessThan(0.01);
  });

  it('never overshoots its target (damping 1)', () => {
    const lean = createLeanState();
    const leftRadPerMs = (720 * DEG) / 1000;
    let most = 0;
    for (let t = 0; t < 2000; t += STEP_MS) {
      stepLean(lean, 0, leftRadPerMs, STEP_MS, LEAN, false);
      most = Math.min(most, lean.rollDeg);
    }
    expect(most).toBeGreaterThanOrEqual(-8 - 1e-9);
  });

  it('is 0 at once under reduced motion', () => {
    const lean = createLeanState();
    for (let t = 0; t < 100; t += STEP_MS) stepLean(lean, 4, 0.01, STEP_MS, LEAN, false);
    expect(lean.pitchDeg).not.toBe(0);
    stepLean(lean, 4, 0.01, STEP_MS, LEAN, true);
    expect(lean.pitchDeg).toBe(0);
    expect(lean.rollDeg).toBe(0);
  });

  it('holds for a dt of 0, and starts at rest after a reset', () => {
    const lean = createLeanState();
    for (let t = 0; t < 50; t += STEP_MS) stepLean(lean, 4, 0, STEP_MS, LEAN, false);
    const held = lean.pitchDeg;
    stepLean(lean, 0, 0, 0, LEAN, false);
    expect(lean.pitchDeg).toBe(held);
    resetLean(lean);
    expect(lean.pitchDeg).toBe(0);
    expect(lean.speed.value).toBe(0);
  });
});

describe('the breath (story 7.8, D7)', () => {
  it('runs one cycle per period on the sim clock', () => {
    const breath = createBreathState();
    expect(stepBreath(breath, 750, 3000, false, false)).toBeCloseTo(1, 9);
    expect(stepBreath(breath, 1500, 3000, false, false)).toBeCloseTo(-1, 9);
    expect(stepBreath(breath, 750, 3000, false, false)).toBeCloseTo(0, 9);
  });

  it('never jumps when the period changes', () => {
    const breath = createBreathState();
    for (let t = 0; t < 1000; t += 16) stepBreath(breath, 16, 3000, false, false);
    const before = breath.factor;
    const after = stepBreath(breath, 16, 1500, false, false);
    // One frame at the faster rate moves it by at most 2π × 16 / 1500 of a unit sine.
    expect(Math.abs(after - before)).toBeLessThan((2 * Math.PI * 16) / 1500 + 1e-9);
  });

  it('takes the alarmed period above the alert', () => {
    expect(breathPeriodMsOf(BREATH, false)).toBe(3000);
    expect(breathPeriodMsOf(BREATH, true)).toBe(1500);
  });

  it('fades out while held and back in after', () => {
    const breath = createBreathState();
    for (let t = 0; t < 750; t += STEP_MS) stepBreath(breath, STEP_MS, 3000, true, false);
    expect(breath.envelope).toBe(0);
    expect(breath.factor).toBeCloseTo(0, 9);
    for (let t = 0; t < 750; t += STEP_MS) stepBreath(breath, STEP_MS, 3000, false, false);
    expect(breath.envelope).toBeCloseTo(1, 9);
  });

  it('holds for a dt of 0 (a freeze), and is 0 at once under reduced motion', () => {
    const breath = createBreathState();
    const moving = stepBreath(breath, 400, 3000, false, false);
    expect(stepBreath(breath, 0, 3000, false, false)).toBe(moving);
    expect(stepBreath(breath, 16, 3000, false, true)).toBe(0);
    expect(breath.envelope).toBe(0);
    resetBreath(breath);
    expect(breath).toEqual({ phase: 0, envelope: 1, factor: 0 });
  });
});

describe('the stoop (story 7.8, D9)', () => {
  it('is the fatigue share of maxDeg, clamped', () => {
    expect(stoopDegOf(0, 15)).toBe(0);
    expect(stoopDegOf(50, 15)).toBe(7.5);
    expect(stoopDegOf(100, 15)).toBe(15);
    expect(stoopDegOf(140, 15)).toBe(15);
    expect(stoopDegOf(-3, 15)).toBe(0);
  });
});
