import { describe, expect, it } from 'vitest';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';

describe('createNavGrid', () => {
  it('maps cells and points both ways (cell (c, r) covers x = c * 0.25, z = r * 0.25)', () => {
    const grid = createTestNavGrid(['111', '111']);
    expect(grid.cols).toBe(3);
    expect(grid.rows).toBe(2);
    expect(grid.cellAt(0.3, 0.1)).toBe(1);
    expect(grid.cellAt(0.1, 0.3)).toBe(3);
    expect(grid.centerXM(4)).toBe(0.375);
    expect(grid.centerZM(4)).toBe(0.375);
    expect(grid.cellAt(grid.centerXM(5), grid.centerZM(5))).toBe(5);
    expect(grid.columnAt(0.75)).toBe(3);
  });

  it('puts a point off the grid in no cell, and a point on the near edge of a cell in that cell', () => {
    const grid = createTestNavGrid(['11']);
    expect(grid.cellAt(-0.01, 0.1)).toBe(-1);
    expect(grid.cellAt(0.1, 0.25)).toBe(-1);
    expect(grid.cellAt(0.5, 0.1)).toBe(-1);
    expect(grid.cellAt(0.25, 0)).toBe(1);
  });

  it('opens exactly the walkable cells when the agent has no clearance', () => {
    const grid = createTestNavGrid(['101', '111']);
    expect([...grid.open]).toEqual([1, 0, 1, 1, 1, 1]);
    expect(grid.clearanceCells).toBe(0);
    expect(grid.isOpenAt(0.1, 0.1)).toBe(true);
    expect(grid.isOpenAt(0.3, 0.1)).toBe(false);
    expect(grid.isOpenAt(-1, 0.1)).toBe(false);
  });

  it('erodes by ceil(radius / cell) cells, and the edge of the grid counts as blocked', () => {
    const rows = ['11111', '11111', '11011', '11111', '11111'];
    const one = createTestNavGrid(rows, 0.25);
    expect(one.clearanceCells).toBe(1);
    // Only the cells with a fully walkable 3 x 3 square around them: none touches the hole or the edge.
    expect([...one.open]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ]);
    const wide = createTestNavGrid(['1111111', '1111111', '1111111', '1111111', '1111111'], 0.25);
    expect([...wide.open]).toEqual([
      0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    // A radius a hair above one cell needs two.
    expect(createTestNavGrid(['1'], 0.26).clearanceCells).toBe(2);
    expect(createTestNavGrid(['1'], 0.5).clearanceCells).toBe(2);
    expect(createTestNavGrid(['1'], 0).clearanceCells).toBe(0);
  });

  it('refuses a clearance that is negative or not a number', () => {
    expect(() => createTestNavGrid(['1'], -1)).toThrow(/clearanceM/);
    expect(() => createTestNavGrid(['1'], Number.NaN)).toThrow(/clearanceM/);
  });

  it('labels 4-neighbour regions in order of their first cell, -1 for closed cells', () => {
    const grid = createTestNavGrid(['11011', '00011', '11100']);
    expect([...grid.region]).toEqual([0, 0, -1, 1, 1, -1, -1, -1, 1, 1, 2, 2, 2, -1, -1]);
  });

  it('does not join two regions that only touch at a corner', () => {
    const grid = createTestNavGrid(['10', '01']);
    expect([...grid.region]).toEqual([0, -1, -1, 1]);
  });

  describe('nearestOpenCell', () => {
    it('is the cell holding the point when it is open', () => {
      const grid = createTestNavGrid(['111', '111']);
      expect(grid.nearestOpenCell(0.4, 0.1, -1)).toBe(1);
    });

    it('finds the closest centre for a point in a blocked cell and off the grid', () => {
      const grid = createTestNavGrid(['101', '111']);
      expect(grid.nearestOpenCell(0.3, 0.05, -1)).toBe(0);
      expect(grid.nearestOpenCell(10, 10, -1)).toBe(5);
      expect(grid.nearestOpenCell(-10, -10, -1)).toBe(0);
    });

    it('breaks a tie by the lowest cell index', () => {
      const grid = createTestNavGrid(['101']);
      // The blocked middle cell: equally far from cell 0 and cell 2.
      expect(grid.nearestOpenCell(0.375, 0.125, -1)).toBe(0);
      const column = createTestNavGrid(['1', '0', '1']);
      expect(column.nearestOpenCell(0.125, 0.375, -1)).toBe(0);
    });

    it('only looks in the asked region, and gives -1 when there is none', () => {
      const grid = createTestNavGrid(['1011']);
      expect(grid.nearestOpenCell(0.1, 0.1, 1)).toBe(2);
      expect(grid.nearestOpenCell(0.1, 0.1, 0)).toBe(0);
      expect(grid.nearestOpenCell(0.1, 0.1, 5)).toBe(-1);
      expect(createTestNavGrid(['00']).nearestOpenCell(0, 0, -1)).toBe(-1);
    });
  });
});
