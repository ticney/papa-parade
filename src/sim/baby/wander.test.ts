import { createRng } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { describe, expect, it } from 'vitest';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';
import type { BabySlice } from '../world.ts';
import { pickWanderCell, planWander } from './wander.ts';

// Cell (c, r) of a test grid covers x from c / 4 to (c + 1) / 4 (same for z): its centre is at
// (c + 0.5) / 4.
const center = (index: number) => (index + 0.5) / 4;

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

describe('pickWanderCell', () => {
  it('only picks cells of the baby’s own region', () => {
    // Two rooms of one row each, split by a wall column.
    const grid = createTestNavGrid(['11011111'], 0);
    const rng = createRng(1);
    const startRegion = grid.region[grid.cellAt(center(0), center(0))] as number;
    for (let i = 0; i < 200; i++) {
      const cell = pickWanderCell(grid, center(0), center(0), 0, 10, rng);
      expect(grid.region[cell]).toBe(startRegion);
    }
  });

  it('only picks cells whose centre is inside the ring', () => {
    const grid = createTestNavGrid(['11111111'], 0);
    const rng = createRng(2);
    for (let i = 0; i < 200; i++) {
      const cell = pickWanderCell(grid, center(0), center(0), 0.4, 1.1, rng);
      const distance = Math.abs(grid.centerXM(cell) - center(0));
      expect(distance).toBeGreaterThanOrEqual(0.4);
      expect(distance).toBeLessThanOrEqual(1.1);
    }
  });

  it('is uniform over the candidates', () => {
    // Candidates at 0.25, 0.5, 0.75 and 1.0 m of the first cell; the ring takes the last three.
    const grid = createTestNavGrid(['11111'], 0);
    const rng = createRng(3);
    const counts = new Map<number, number>();
    for (let i = 0; i < 3000; i++) {
      const cell = pickWanderCell(grid, center(0), center(0), 0.4, 1.1, rng);
      counts.set(cell, (counts.get(cell) ?? 0) + 1);
    }
    expect([...counts.keys()].sort((a, b) => a - b)).toEqual([2, 3, 4]);
    for (const hits of counts.values()) {
      expect(hits).toBeGreaterThan(850);
      expect(hits).toBeLessThan(1150);
    }
  });

  it('falls back to every other cell of the region when the ring is empty', () => {
    const grid = createTestNavGrid(['1111'], 0);
    const rng = createRng(4);
    const seen = new Set<number>();
    for (let i = 0; i < 300; i++) {
      seen.add(pickWanderCell(grid, center(0), center(0), 5, 6, rng));
    }
    expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3]);
  });

  it('never picks the cell the baby stands in', () => {
    const grid = createTestNavGrid(['111'], 0);
    const rng = createRng(5);
    for (let i = 0; i < 200; i++) {
      expect(pickWanderCell(grid, center(1), center(0), 0, 10, rng)).not.toBe(1);
    }
  });

  it('is -1 in a one-cell region, and draws nothing', () => {
    const grid = createTestNavGrid(['10', '01'], 0);
    const rng = createRng(6);
    const before = { ...rng };
    expect(pickWanderCell(grid, center(0), center(0), 0, 10, rng)).toBe(-1);
    expect(rng).toEqual(before);
  });

  it('is -1, drawing nothing, when the baby stands in a closed cell or off the grid', () => {
    const grid = createTestNavGrid(['101'], 0);
    const rng = createRng(7);
    const before = { ...rng };
    expect(pickWanderCell(grid, center(1), center(0), 0, 10, rng)).toBe(-1);
    expect(pickWanderCell(grid, 9, 9, 0, 10, rng)).toBe(-1);
    expect(rng).toEqual(before);
  });

  it('draws exactly once per pick', () => {
    const grid = createTestNavGrid(['1111'], 0);
    const one = createRng(8);
    const two = createRng(8);
    pickWanderCell(grid, center(0), center(0), 0, 10, one);
    pickWanderCell(grid, center(0), center(0), 5, 6, two); // the fallback path
    expect(two).toEqual(one);
  });
});

describe('planWander', () => {
  it('plans a path that ends at the centre of the cell, from the baby’s exact position', () => {
    const grid = createTestNavGrid(['1111', '1111'], 0);
    const baby = babyAt(0.1, 0.1);
    expect(planWander(baby, grid, 3)).toBe(true);
    expect(baby.pathIndex).toBe(0);
    expect(baby.path.slice(-2)).toEqual([grid.centerXM(3), grid.centerZM(3)]);
  });

  it('goes round a wall', () => {
    const grid = createTestNavGrid(['1111', '0001', '1111'], 0);
    const baby = babyAt(center(0), center(0));
    const goal = grid.cellAt(center(0), center(2));
    expect(planWander(baby, grid, goal)).toBe(true);
    expect(baby.path.length).toBeGreaterThan(2);
  });

  it('leaves the baby untouched when there is no path', () => {
    const grid = createTestNavGrid(['101'], 0);
    const baby = babyAt(center(0), center(0));
    expect(planWander(baby, grid, 2)).toBe(false);
    expect(baby.path).toEqual([]);
    expect(baby.pathIndex).toBe(0);
  });

  it('refuses a baby standing in a closed cell', () => {
    const grid = createTestNavGrid(['101'], 0);
    const baby = babyAt(center(1), center(0));
    expect(planWander(baby, grid, 2)).toBe(false);
  });
});
