import { describe, expect, it } from 'vitest';
import { createTestNavGrid } from '../../../tests/support/testNav.ts';
import { planRoute } from './planRoute.ts';

// Cell (c, r) covers x from c / 4 to (c + 1) / 4 (same for z).
//   row 0: 1 1 1 1 1 0 1 1   <- column 5 of row 0 is a pillar
//   row 1: 1 1 1 1 1 0 1 1
//   row 2: 1 1 1 1 1 0 1 1
// The columns 6 and 7 are another region (the pillar spans every row).
const GRID = createTestNavGrid(['11111011', '11111011', '11111011']);

describe('planRoute', () => {
  it('ends exactly at the target when it is in an open cell of the region', () => {
    const out: number[] = [];
    const goal = planRoute(GRID, 0.125, 0.125, 1.1, 0.6, out);
    expect(goal).toEqual({ goalXM: 1.1, goalZM: 0.6 });
    expect(out.slice(-2)).toEqual([1.1, 0.6]);
  });

  it('ends at the centre of the nearest open cell of the region for a closed target', () => {
    const out: number[] = [];
    const goal = planRoute(GRID, 0.125, 0.125, 1.375, 0.375, out); // inside the pillar (column 5)
    expect(goal).toEqual({ goalXM: 1.125, goalZM: 0.375 });
    expect(out.slice(-2)).toEqual([1.125, 0.375]);
  });

  it('snaps a target in another region to the nearest cell of the walker’s own', () => {
    const out: number[] = [];
    const goal = planRoute(GRID, 0.125, 0.125, 1.8, 0.375, out); // column 7: the other region
    expect(goal).toEqual({ goalXM: 1.125, goalZM: 0.375 });
  });

  it('snaps a target off the grid too', () => {
    const goal = planRoute(GRID, 0.125, 0.125, -5, -5, []);
    expect(goal).toEqual({ goalXM: 0.125, goalZM: 0.125 });
  });

  it('returns null, leaving out empty, when the walker does not stand on an open cell', () => {
    const out = [9, 9];
    expect(planRoute(GRID, 1.375, 0.375, 0.125, 0.125, out)).toBeNull();
    expect(out).toEqual([]);
  });

  it('returns null when the grid has no open cell at all', () => {
    const closed = createTestNavGrid(['000', '000']);
    expect(planRoute(closed, 0.1, 0.1, 0.4, 0.4, [])).toBeNull();
  });

  it('is a single waypoint to a target in the walker’s own cell', () => {
    const out: number[] = [];
    expect(planRoute(GRID, 0.1, 0.1, 0.2, 0.2, out)).toEqual({ goalXM: 0.2, goalZM: 0.2 });
    expect(out).toEqual([0.2, 0.2]);
  });
});
