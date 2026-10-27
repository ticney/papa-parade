import { describe, expect, it } from 'vitest';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';
import { findPath } from './astar.ts';

function pathOf(rows: string[], from: number, to: number): number[] | null {
  const grid = createTestNavGrid(rows);
  const out: number[] = [];
  return findPath(grid, from, to, out) ? out : null;
}

describe('findPath', () => {
  it('goes straight along an empty row', () => {
    expect(pathOf(['11111'], 0, 4)).toEqual([0, 1, 2, 3, 4]);
  });

  it('takes the diagonal across an empty grid (cost sqrt 2 per step)', () => {
    const rows = ['1111', '1111', '1111', '1111'];
    expect(pathOf(rows, 0, 15)).toEqual([0, 5, 10, 15]);
  });

  it('goes around a block', () => {
    const rows = ['11111', '11011', '11011', '11111'];
    const path = pathOf(rows, 10, 14) as number[]; // from (0, 2) to (4, 2), with (2, 2) and (2, 1) blocked
    expect(path).not.toBeNull();
    // The block is cell 12 (and 7): the path goes round it and uses open cells only.
    expect(path).not.toContain(12);
    expect(path[0]).toBe(10);
    expect(path.at(-1)).toBe(14);
    const grid = createTestNavGrid(rows);
    for (const cell of path) expect(grid.open[cell]).toBe(1);
  });

  it('returns a path of one cell when start and goal are the same', () => {
    expect(pathOf(['111'], 1, 1)).toEqual([1]);
  });

  it('returns false for a goal in another region, a closed cell, or a cell off the grid', () => {
    expect(pathOf(['1101'], 0, 3)).toBeNull();
    expect(pathOf(['1101'], 0, 2)).toBeNull();
    expect(pathOf(['1101'], 0, 4)).toBeNull();
    expect(pathOf(['1101'], -1, 0)).toBeNull();
    expect(pathOf(['1101'], 2, 0)).toBeNull();
  });

  it('clears `out` when it finds nothing', () => {
    const grid = createTestNavGrid(['101']);
    const out = [1, 2, 3];
    expect(findPath(grid, 0, 2, out)).toBe(false);
    expect(out).toEqual([]);
  });

  it('never cuts a corner between two blocked cells', () => {
    // Cells 1 and 2 (the two off-diagonal ones) are blocked: 0 and 3 are in different regions.
    expect(pathOf(['10', '01'], 0, 3)).toBeNull();
    // One blocked orthogonal neighbour is enough to forbid the diagonal step.
    const rows = ['110', '111', '011'];
    const path = pathOf(rows, 0, 4) as number[];
    expect(path).toEqual([0, 4]); // both orthogonal neighbours (1 and 3) are open
    const squeezed = pathOf(['11', '01'], 0, 3) as number[];
    expect(squeezed).toEqual([0, 1, 3]); // the diagonal 0 -> 3 would cut the blocked cell 2
  });

  it('breaks ties the same way twice, and the same way as a fresh grid', () => {
    const rows = ['11111', '11111', '11111', '11111', '11111'];
    const grid = createTestNavGrid(rows);
    const a: number[] = [];
    const b: number[] = [];
    findPath(grid, 2, 22, a);
    findPath(grid, 2, 22, b);
    expect(a).toEqual(b);
    const fresh: number[] = [];
    findPath(createTestNavGrid(rows), 2, 22, fresh);
    expect(fresh).toEqual(a);
    expect(a).toEqual([2, 7, 12, 17, 22]);
  });

  it('reuses its scratch across searches without leaking one into the next', () => {
    const grid = createTestNavGrid(['1111', '1011', '1111']);
    const first: number[] = [];
    const second: number[] = [];
    expect(findPath(grid, 0, 11, first)).toBe(true);
    expect(findPath(grid, 11, 0, second)).toBe(true);
    expect([...second].reverse().length).toBe(first.length);
    expect(second[0]).toBe(11);
    expect(second.at(-1)).toBe(0);
    for (const cell of [...first, ...second]) expect(grid.open[cell]).toBe(1);
  });

  it('is optimal against a brute-force search on a maze', () => {
    const rows = [
      '1111111111',
      '1000000001',
      '1011111101',
      '1010010101',
      '1010110101',
      '1010110101',
      '1010000101',
      '1011111101',
      '1000010001',
      '1111111111',
    ];
    const grid = createTestNavGrid(rows);
    const out: number[] = [];
    expect(findPath(grid, 0, 55, out)).toBe(true);
    expect(out[0]).toBe(0);
    expect(out.at(-1)).toBe(55);
    let cost = 0;
    for (let i = 1; i < out.length; i++) {
      const dc = Math.abs(((out[i] as number) % 10) - ((out[i - 1] as number) % 10));
      const dr = Math.abs(
        Math.floor((out[i] as number) / 10) - Math.floor((out[i - 1] as number) / 10),
      );
      expect(Math.max(dc, dr)).toBe(1);
      cost += dc + dr === 2 ? Math.SQRT2 : 1;
    }
    expect(cost).toBeCloseTo(bruteForceCost(rows, 0, 55), 9);
  });
});

/** Dijkstra on an array, for comparison only. */
function bruteForceCost(rows: string[], from: number, to: number): number {
  const cols = (rows[0] as string).length;
  const total = cols * rows.length;
  const dist = new Array<number>(total).fill(Number.POSITIVE_INFINITY);
  const done = new Array<boolean>(total).fill(false);
  const isOpen = (c: number, r: number) => rows[r]?.[c] === '1';
  dist[from] = 0;
  for (;;) {
    let best = -1;
    for (let i = 0; i < total; i++) {
      if (
        !done[i] &&
        Number.isFinite(dist[i] as number) &&
        (best === -1 || (dist[i] as number) < (dist[best] as number))
      )
        best = i;
    }
    if (best === -1 || best === to) break;
    done[best] = true;
    const c = best % cols;
    const r = Math.floor(best / cols);
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        if (!isOpen(c + dc, r + dr)) continue;
        if (dr !== 0 && dc !== 0 && !(isOpen(c + dc, r) && isOpen(c, r + dr))) continue;
        const next = (r + dr) * cols + c + dc;
        const candidate = (dist[best] as number) + (dr !== 0 && dc !== 0 ? Math.SQRT2 : 1);
        if (candidate < (dist[next] as number)) dist[next] = candidate;
      }
    }
  }
  return dist[to] as number;
}
