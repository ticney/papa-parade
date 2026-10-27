import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';
import type { BabySlice } from '../world.ts';
import { gazeAt, planApproach } from './approach.ts';

const center = (index: number) => (index + 0.5) / 4;
const GRID = createTestNavGrid(['11111011', '11111011', '11111011']);

function babyAt(xM: number, zM: number): BabySlice {
  return {
    state: 'babble',
    enteredAt: asSimMs(0),
    xM,
    zM,
    prevXM: xM,
    prevZM: zM,
    headingX: 0,
    headingZ: 1,
    gazeX: 0,
    gazeZ: 1,
    path: [],
    pathIndex: 0,
    wanderAt: asSimMs(0),
    babbling: true,
    targetThreatId: null,
    approachSpeedMps: 0,
  };
}

describe('planApproach', () => {
  it('plans a new path that ends at the target and starts from the first waypoint', () => {
    const baby = babyAt(center(0), center(0));
    const previous = baby.path;
    expect(planApproach(baby, GRID, 1.1, 0.6)).toBe(true);
    expect(baby.path).not.toBe(previous);
    expect(baby.pathIndex).toBe(0);
    expect(baby.path.slice(-2)).toEqual([1.1, 0.6]);
  });

  it('snaps a closed target (an outlet in a wall) to the nearest open cell', () => {
    const baby = babyAt(center(0), center(0));
    expect(planApproach(baby, GRID, 1.375, 0.375)).toBe(true);
    expect(baby.path.slice(-2)).toEqual([center(4), center(1)]);
  });

  it('returns false and leaves the baby untouched when it stands in a closed cell', () => {
    const baby = babyAt(1.375, 0.375);
    baby.path = [7, 7];
    baby.pathIndex = 1;
    expect(planApproach(baby, GRID, 0.1, 0.1)).toBe(false);
    expect(baby.path).toEqual([7, 7]);
    expect(baby.pathIndex).toBe(1);
  });
});

describe('gazeAt', () => {
  it('turns the gaze to a unit vector towards the point', () => {
    const baby = babyAt(1, 1);
    gazeAt(baby, 4, 5);
    expect(baby.gazeX).toBeCloseTo(0.6, 12);
    expect(baby.gazeZ).toBeCloseTo(0.8, 12);
  });

  it('leaves the heading alone: gaze and heading are separate', () => {
    const baby = babyAt(1, 1);
    gazeAt(baby, -3, 1);
    expect([baby.gazeX, baby.gazeZ]).toEqual([-1, 0]);
    expect([baby.headingX, baby.headingZ]).toEqual([0, 1]);
  });

  it('keeps the gaze when the point is where the baby is', () => {
    const baby = babyAt(2, 3);
    baby.gazeX = 1;
    baby.gazeZ = 0;
    gazeAt(baby, 2, 3);
    expect([baby.gazeX, baby.gazeZ]).toEqual([1, 0]);
  });

  it('keeps the gaze for a point so close that its distance underflows', () => {
    const baby = babyAt(2, 3);
    gazeAt(baby, 2 + 1e-200, 3);
    expect([baby.gazeX, baby.gazeZ]).toEqual([0, 1]);
  });
});
