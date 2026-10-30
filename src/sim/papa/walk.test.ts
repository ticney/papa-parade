import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';
import type { PapaSlice } from '../world.ts';
import { stepInDirection } from './walk.ts';

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
    glide: null,
    objectId: null,
    intent: 'none',
    busyUntil: asSimMs(0),
    ...patch,
  };
}

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
