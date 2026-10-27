import { nextInt, type RngState } from '@shared/rng';
import { findPath } from '../nav/astar.ts';
import type { NavGrid } from '../nav/navGrid.ts';
import { smoothPath } from '../nav/smoothPath.ts';
import type { BabySlice } from '../world.ts';

/**
 * Picks where the baby crawls next: an open cell of its region whose centre is between
 * `minDistM` and `maxDistM` from (`xM`, `zM`), uniformly among those, in index order. With none in
 * that ring it falls back to every other open cell of the region. Returns -1, having drawn
 * nothing, when the baby's own cell is closed or the region holds no other cell. At most one draw
 * from `rng`, whatever the grid. Distances are compared squared: no `sqrt`, no allocation.
 */
export function pickWanderCell(
  grid: NavGrid,
  xM: number,
  zM: number,
  minDistM: number,
  maxDistM: number,
  rng: RngState,
): number {
  const own = grid.cellAt(xM, zM);
  if (own < 0 || grid.open[own] !== 1) return -1;
  const region = grid.region[own] as number;
  const total = grid.cols * grid.rows;
  const minSq = minDistM * minDistM;
  const maxSq = maxDistM * maxDistM;

  // Counted twice rather than collected: it allocates nothing, and the k-th is the same cell
  // whatever the machine.
  let count = 0;
  for (let cell = 0; cell < total; cell++) {
    if (cell === own || grid.region[cell] !== region) continue;
    const dx = grid.centerXM(cell) - xM;
    const dz = grid.centerZM(cell) - zM;
    const distSq = dx * dx + dz * dz;
    if (distSq >= minSq && distSq <= maxSq) count++;
  }
  const isRing = count > 0;
  if (!isRing) {
    for (let cell = 0; cell < total; cell++) {
      if (cell !== own && grid.region[cell] === region) count++;
    }
    if (count === 0) return -1;
  }

  let remaining = nextInt(rng, 0, count);
  for (let cell = 0; cell < total; cell++) {
    if (cell === own || grid.region[cell] !== region) continue;
    if (isRing) {
      const dx = grid.centerXM(cell) - xM;
      const dz = grid.centerZM(cell) - zM;
      const distSq = dx * dx + dz * dz;
      if (distSq < minSq || distSq > maxSq) continue;
    }
    if (remaining === 0) return cell;
    remaining--;
  }
  return -1; // unreachable: `count` cells matched above
}

/**
 * Plans the crawl from where the baby sits to the centre of `cell`: A* then string pulling into a
 * new `baby.path` (one array per wander, which becomes part of the world). Returns false, leaving
 * the baby untouched, when there is no path.
 */
export function planWander(baby: BabySlice, grid: NavGrid, cell: number): boolean {
  const startCell = grid.cellAt(baby.xM, baby.zM);
  if (startCell < 0 || grid.open[startCell] !== 1) return false;
  const cells = grid.scratch.cells;
  if (!findPath(grid, startCell, cell, cells)) return false;
  const path: number[] = [];
  smoothPath(grid, cells, baby.xM, baby.zM, grid.centerXM(cell), grid.centerZM(cell), path);
  baby.path = path;
  baby.pathIndex = 0;
  return true;
}
