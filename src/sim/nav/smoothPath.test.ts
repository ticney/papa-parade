import { describe, expect, it } from 'vitest';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';
import { findPath } from './astar.ts';
import { hasLineOfSight, smoothPath } from './smoothPath.ts';

describe('hasLineOfSight', () => {
  const open = createTestNavGrid(['1111', '1111', '1111', '1111']);

  it('sees across an empty grid, including along a single cell and a point', () => {
    expect(hasLineOfSight(open, 0.1, 0.1, 0.9, 0.9)).toBe(true);
    expect(hasLineOfSight(open, 0.1, 0.1, 0.15, 0.2)).toBe(true);
    expect(hasLineOfSight(open, 0.1, 0.1, 0.1, 0.1)).toBe(true);
  });

  it('is blocked by a closed cell on the way, in both directions', () => {
    const grid = createTestNavGrid(['111', '101', '111']);
    expect(hasLineOfSight(grid, 0.125, 0.375, 0.625, 0.375)).toBe(false);
    expect(hasLineOfSight(grid, 0.625, 0.375, 0.125, 0.375)).toBe(false);
    expect(hasLineOfSight(grid, 0.125, 0.125, 0.625, 0.125)).toBe(true);
    expect(hasLineOfSight(grid, 0.125, 0.125, 0.625, 0.625)).toBe(false); // crosses the corner of (1, 1)
  });

  it('refuses an end point in a closed cell or off the grid, and a start likewise', () => {
    const grid = createTestNavGrid(['101']);
    expect(hasLineOfSight(grid, 0.1, 0.1, 0.3, 0.1)).toBe(false);
    expect(hasLineOfSight(grid, 0.3, 0.1, 0.1, 0.1)).toBe(false);
    expect(hasLineOfSight(grid, 0.1, 0.1, 2, 0.1)).toBe(false);
    expect(hasLineOfSight(grid, 5, 5, 0.1, 0.1)).toBe(false);
  });

  it('refuses to slip through a grid corner that touches a blocked cell', () => {
    // Diagonal from the centre of (0,0) to the centre of (1,1) passes exactly through the shared corner.
    const oneBlocked = createTestNavGrid(['10', '11']);
    const free = createTestNavGrid(['11', '11']);
    // from (0,1) centre to (1,0)... blocked cell is (1,0): the diagonal from (0,1) to (1,0) is not the question.
    expect(hasLineOfSight(free, 0.125, 0.125, 0.375, 0.375)).toBe(true);
    const blockedRight = createTestNavGrid(['11', '10']);
    expect(hasLineOfSight(blockedRight, 0.125, 0.125, 0.375, 0.375)).toBe(false);
    const blockedBeside = createTestNavGrid(['11', '01']);
    expect(hasLineOfSight(blockedBeside, 0.125, 0.125, 0.375, 0.375)).toBe(false);
    expect(hasLineOfSight(oneBlocked, 0.375, 0.125, 0.125, 0.375)).toBe(false);
  });

  it('sees along grid lines (zero dx or dz)', () => {
    const grid = createTestNavGrid(['111', '111', '111']);
    expect(hasLineOfSight(grid, 0.125, 0.125, 0.125, 0.625)).toBe(true);
    expect(hasLineOfSight(grid, 0.625, 0.625, 0.125, 0.625)).toBe(true);
  });
});

describe('smoothPath', () => {
  function walk(
    rows: string[],
    startCell: number,
    goalCell: number,
    grid = createTestNavGrid(rows),
  ) {
    const cells: number[] = [];
    expect(findPath(grid, startCell, goalCell, cells)).toBe(true);
    const out: number[] = [];
    smoothPath(
      grid,
      cells,
      grid.centerXM(startCell),
      grid.centerZM(startCell),
      grid.centerXM(goalCell),
      grid.centerZM(goalCell),
      out,
    );
    return { grid, cells, out };
  }

  it('reduces a direct path to one segment: the goal', () => {
    const { grid, out } = walk(['111111', '111111', '111111'], 0, 17);
    expect(out).toEqual([grid.centerXM(17), grid.centerZM(17)]);
  });

  it('keeps corner waypoints for a detour, and every segment stays in line of sight', () => {
    const rows = ['1111111', '1111111', '1110111', '1110111', '1111111', '1111111'];
    const startCell = 2 * 7; // (0, 2)
    const goalCell = 2 * 7 + 6; // (6, 2)
    const { grid, out } = walk(rows, startCell, goalCell);
    expect(out.length).toBeGreaterThanOrEqual(4);
    expect(out.length).toBeLessThan(2 * 8);
    let x = grid.centerXM(startCell);
    let z = grid.centerZM(startCell);
    for (let i = 0; i < out.length; i += 2) {
      expect(hasLineOfSight(grid, x, z, out[i] as number, out[i + 1] as number)).toBe(true);
      x = out[i] as number;
      z = out[i + 1] as number;
    }
    expect(x).toBe(grid.centerXM(goalCell));
    expect(z).toBe(grid.centerZM(goalCell));
  });

  it('ends at the exact goal point and starts from the exact start point', () => {
    const grid = createTestNavGrid(['1111', '1111']);
    const cells: number[] = [];
    findPath(grid, 0, 3, cells);
    const out: number[] = [];
    smoothPath(grid, cells, 0.03, 0.2, 0.93, 0.01, out);
    expect(out).toEqual([0.93, 0.01]);
  });

  it('gives only the goal when start and goal share a cell', () => {
    const grid = createTestNavGrid(['11']);
    const out: number[] = [9, 9];
    smoothPath(grid, [0], 0.05, 0.05, 0.2, 0.1, out);
    expect(out).toEqual([0.2, 0.1]);
  });

  it('gives only the goal for two neighbouring cells', () => {
    const grid = createTestNavGrid(['11']);
    const out: number[] = [];
    smoothPath(grid, [0, 1], 0.05, 0.05, 0.4, 0.1, out);
    expect(out).toEqual([0.4, 0.1]);
  });
});
