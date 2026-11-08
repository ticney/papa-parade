import { describe, expect, it } from 'vitest';
import {
  createPapaGazeAim,
  createPapaGazeSight,
  type GazeThreatEntry,
  isBabyShownForGaze,
  type PapaGazeInput,
  papaGazeOf,
  pickGazeThreat,
} from './papaGaze.ts';

const DEG = Math.PI / 180;
const MAX_YAW_RAD = 60 * DEG;

const INPUT: PapaGazeInput = {
  papaXM: 0,
  papaZM: 0,
  bodyYawRad: 0,
  babyXM: 1,
  babyZM: 1,
  isResponding: false,
  isAsleep: false,
};

function entry(threatId: number, xM: number, zM: number, followsPapa = false): GazeThreatEntry {
  return { threatId, xM, zM, followsPapa };
}

describe('the gaze target (story 7.8, D8)', () => {
  it('follows the baby when he is shown and Papa is not responding', () => {
    const aim = createPapaGazeAim();
    const sight = { ...createPapaGazeSight(), isBabyShown: true, hasThreat: true, threatXM: -1 };
    papaGazeOf(INPUT, sight, MAX_YAW_RAD, aim);
    expect(aim.kind).toBe('baby');
    // The baby is at 45° toward +x, his left: a positive head yaw.
    expect(aim.yawRad).toBeCloseTo(45 * DEG, 9);
  });

  it('follows the threat while he responds, or when the baby is not shown', () => {
    const aim = createPapaGazeAim();
    const sight = {
      isBabyShown: true,
      hasThreat: true,
      threatXM: -1,
      threatZM: 1,
    };
    papaGazeOf({ ...INPUT, isResponding: true }, sight, MAX_YAW_RAD, aim);
    expect(aim.kind).toBe('threat');
    expect(aim.yawRad).toBeCloseTo(-45 * DEG, 9);
    papaGazeOf(INPUT, { ...sight, isBabyShown: false }, MAX_YAW_RAD, aim);
    expect(aim.kind).toBe('threat');
  });

  it('looks ahead with nothing to see, and asleep', () => {
    const aim = createPapaGazeAim();
    papaGazeOf(INPUT, createPapaGazeSight(), MAX_YAW_RAD, aim);
    expect(aim).toEqual({ kind: 'ahead', yawRad: 0 });
    const sight = { isBabyShown: true, hasThreat: true, threatXM: 1, threatZM: 0 };
    papaGazeOf({ ...INPUT, isAsleep: true }, sight, MAX_YAW_RAD, aim);
    expect(aim).toEqual({ kind: 'ahead', yawRad: 0 });
  });

  it('clamps the head to ±maxYawDeg relative to his body', () => {
    const aim = createPapaGazeAim();
    const sight = { ...createPapaGazeSight(), isBabyShown: true };
    // The baby behind him to his left: past the clamp.
    papaGazeOf({ ...INPUT, babyXM: 1, babyZM: -1 }, sight, MAX_YAW_RAD, aim);
    expect(aim.yawRad).toBeCloseTo(60 * DEG, 9);
    papaGazeOf({ ...INPUT, babyXM: -1, babyZM: -1 }, sight, MAX_YAW_RAD, aim);
    expect(aim.yawRad).toBeCloseTo(-60 * DEG, 9);
    // Relative to the body: turned 90° to his left, the baby straight ahead of the world's +x is ahead.
    papaGazeOf({ ...INPUT, bodyYawRad: 90 * DEG, babyXM: 2, babyZM: 0 }, sight, MAX_YAW_RAD, aim);
    expect(aim.yawRad).toBeCloseTo(0, 9);
  });

  it('looks ahead at a baby in his arms, on top of him', () => {
    const aim = createPapaGazeAim();
    const sight = { ...createPapaGazeSight(), isBabyShown: true };
    papaGazeOf({ ...INPUT, babyXM: 0.01, babyZM: 0.01 }, sight, MAX_YAW_RAD, aim);
    expect(aim.yawRad).toBe(0);
  });
});

describe('what the gaze may see (story 7.8, D8, T7)', () => {
  it('never sees a baby in a suspicious silence, nor one off the screen', () => {
    expect(isBabyShownForGaze('wander', true)).toBe(true);
    expect(isBabyShownForGaze('carried', true)).toBe(true);
    expect(isBabyShownForGaze('mischiefSilent', true)).toBe(false);
    expect(isBabyShownForGaze('wander', false)).toBe(false);
  });

  it('picks the most advanced ring on screen, ties to the lowest id', () => {
    const sight = createPapaGazeSight();
    const entries = [entry(4, 4, 0), entry(2, 2, 0), entry(3, 3, 0)];
    const permilles: Record<number, number> = { 2: 500, 3: 700, 4: 700 };
    pickGazeThreat(
      entries,
      (id) => permilles[id] ?? null,
      () => true,
      sight,
    );
    expect(sight).toMatchObject({ hasThreat: true, threatXM: 3 });
  });

  it('never picks a hidden threat (no ring drawn), nor one standing on Papa', () => {
    const sight = createPapaGazeSight();
    // 1: hidden (no ring drawn: a silence, a `wait`); 2: the micro-sleep on Papa; 3: off screen.
    const entries = [entry(1, 1, 0), entry(2, 0, 0, true), entry(3, 3, 0)];
    const permilles: Record<number, number | null> = { 1: null, 2: 900, 3: 900 };
    pickGazeThreat(
      entries,
      (id) => permilles[id] ?? null,
      (id) => id !== 3,
      sight,
    );
    expect(sight.hasThreat).toBe(false);
  });

  it('forgets last frame’s threat when none is seen now', () => {
    const sight = createPapaGazeSight();
    pickGazeThreat(
      [entry(1, 1, 0)],
      () => 100,
      () => true,
      sight,
    );
    expect(sight.hasThreat).toBe(true);
    pickGazeThreat(
      [entry(1, 1, 0)],
      () => null,
      () => true,
      sight,
    );
    expect(sight.hasThreat).toBe(false);
  });
});
