import type { NavGrid } from '../../src/sim/nav/navGrid.ts';
import { createNavGrid } from '../../src/sim/nav/navGrid.ts';
import { createTestLevelGeometry } from './testLevelGeometry.ts';

/**
 * A navigation grid drawn in text for the nav tests: one string per row of z (`1` walkable,
 * `0` blocked), cell (0, 0) starting at x = z = 0, cells of `NAV_CELL_M` (0.25 m).
 */
export function createTestNavGrid(rows: readonly string[], clearanceM = 0): NavGrid {
  const geometry = createTestLevelGeometry();
  geometry.nav = {
    originM: [0, 0],
    cols: (rows[0] as string).length,
    rowCount: rows.length,
    rows: [...rows],
  };
  return createNavGrid(geometry, clearanceM);
}
