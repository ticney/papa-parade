import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';
import type { PapaSlice } from '../world.ts';
import { advanceAlongPath, stepInDirection } from './walk.ts';

function papaAt(xM: number, zM: number, patch: Partial<PapaSlice> = {}): PapaSlice {
  return {
    state: 'idle',
    enteredAt: asSimMs(0),
    xM,
    zM,
    prevXM: xM,
    prevZM: zM,
    headingX: 0,
    headingZ: 1,
    path: [],
    pathIndex: 0,
    dirX: 0,
    dirZ: 0,
    isBlocked: false,
    ...patch,
  };
}

describe('advanceAlongPath', () => {
  it('moves by the budget along the segment and turns toward it', () => {
    const papa = papaAt(0, 0, { path: [3, 4] });
    expect(advanceAlongPath(papa, 1)).toBe(false);
    expect(papa.xM).toBeCloseTo(0.6, 12);
    expect(papa.zM).toBeCloseTo(0.8, 12);
    expect([papa.headingX, papa.headingZ]).toEqual([0.6, 0.8]);
    expect(papa.pathIndex).toBe(0);
  });

  it('snaps to the last waypoint and reports the arrival, whatever is left of the budget', () => {
    const papa = papaAt(0, 0, { path: [1, 0] });
    expect(advanceAlongPath(papa, 5)).toBe(true);
    expect([papa.xM, papa.zM, papa.pathIndex]).toEqual([1, 0, 1]);
  });

  it('crosses several waypoints in one step and keeps the heading of the last segment', () => {
    const papa = papaAt(0, 0, { path: [1, 0, 1, 1, 1, 3] });
    expect(advanceAlongPath(papa, 2.5)).toBe(false);
    expect(papa.pathIndex).toBe(2);
    expect(papa.xM).toBe(1);
    expect(papa.zM).toBeCloseTo(1.5, 12);
    expect([papa.headingX, papa.headingZ]).toEqual([0, 1]);
  });

  it('arrives exactly when the budget is exactly the distance', () => {
    const papa = papaAt(0, 0, { path: [0.5, 0] });
    expect(advanceAlongPath(papa, 0.5)).toBe(true);
    expect(papa.xM).toBe(0.5);
  });

  it('leaves the heading alone on a zero-length segment', () => {
    const papa = papaAt(2, 2, { path: [2, 2], headingX: 1, headingZ: 0 });
    expect(advanceAlongPath(papa, 0.03)).toBe(true);
    expect([papa.headingX, papa.headingZ]).toEqual([1, 0]);
  });

  it('does nothing with an empty path, and reports that there is nothing left to walk', () => {
    const papa = papaAt(1, 1);
    expect(advanceAlongPath(papa, 1)).toBe(true);
    expect([papa.xM, papa.zM]).toEqual([1, 1]);
  });

  it('is the same walk whatever the budget is cut into', () => {
    const whole = papaAt(0, 0, { path: [1, 0, 1, 2] });
    advanceAlongPath(whole, 2);
    const cut = papaAt(0, 0, { path: [1, 0, 1, 2] });
    for (let i = 0; i < 4; i++) advanceAlongPath(cut, 0.5);
    expect(cut.xM).toBeCloseTo(whole.xM, 12);
    expect(cut.zM).toBeCloseTo(whole.zM, 12);
  });
});

describe('stepInDirection', () => {
  // A 4 x 4 room whose cell (2, 0) is blocked; cell (c, r) covers x = c / 4, z = r / 4.
  const grid = createTestNavGrid(['1101', '1111', '1111', '1111']);

  it('takes the whole step when its end is open', () => {
    const papa = papaAt(0.1, 0.6, { dirX: 1, dirZ: 0 });
    expect(stepInDirection(papa, grid, 0.03)).toBe(true);
    expect(papa.xM).toBeCloseTo(0.13, 12);
    expect(papa.zM).toBe(0.6);
  });

  it('stops against an obstacle straight ahead, without moving', () => {
    const papa = papaAt(0.49, 0.1, { dirX: 1, dirZ: 0 });
    expect(stepInDirection(papa, grid, 0.03)).toBe(false);
    expect([papa.xM, papa.zM]).toEqual([0.49, 0.1]);
  });

  it('slides along x when a diagonal push runs into a wall and only the z part is blocked', () => {
    // Row 1 is open, the cell above (2, 0) is not: pushing right and up along it.
    const papa = papaAt(0.6, 0.255, { dirX: Math.SQRT1_2, dirZ: -Math.SQRT1_2 });
    expect(grid.isOpenAt(papa.xM, papa.zM)).toBe(true);
    expect(grid.isOpenAt(papa.xM + 0.03 * Math.SQRT1_2, papa.zM - 0.03 * Math.SQRT1_2)).toBe(false);
    expect(stepInDirection(papa, grid, 0.03)).toBe(true);
    expect(papa.zM).toBe(0.255);
    expect(papa.xM).toBeCloseTo(0.6 + 0.03 * Math.SQRT1_2, 12);
  });

  it('slides along z when a diagonal push runs into a wall and only the x part is blocked', () => {
    // Left of the blocked cell (2, 0): going right and up, the x part enters it, the z part does not.
    const papa = papaAt(0.49, 0.24, { dirX: Math.SQRT1_2, dirZ: -Math.SQRT1_2 });
    expect(grid.isOpenAt(0.49 + 0.03 * Math.SQRT1_2, 0.24 - 0.03 * Math.SQRT1_2)).toBe(false);
    expect(stepInDirection(papa, grid, 0.03)).toBe(true);
    expect(papa.xM).toBe(0.49);
    expect(papa.zM).toBeCloseTo(0.24 - 0.03 * Math.SQRT1_2, 12);
  });

  it('is blocked when neither the x part nor the z part is open', () => {
    const papa = papaAt(0.49, 0.1, { dirX: 1, dirZ: 0 });
    expect(stepInDirection(papa, grid, 0.03)).toBe(false);
  });

  it('does not squeeze through a corner: a diagonal cell is not enough when both sides are closed', () => {
    const corner = createTestNavGrid(['10', '01']);
    const papa = papaAt(0.24, 0.24, { dirX: Math.SQRT1_2, dirZ: Math.SQRT1_2 });
    expect(corner.isOpenAt(0.24 + 0.03 * Math.SQRT1_2, 0.24 + 0.03 * Math.SQRT1_2)).toBe(true);
    expect(stepInDirection(papa, corner, 0.03)).toBe(false);
    expect([papa.xM, papa.zM]).toEqual([0.24, 0.24]);
  });

  it('refuses a step off the grid', () => {
    const papa = papaAt(0.01, 0.5, { dirX: -1, dirZ: 0 });
    expect(stepInDirection(papa, grid, 0.03)).toBe(false);
  });
});
