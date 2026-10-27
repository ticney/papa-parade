import { findPath } from './astar.ts';
import type { NavGrid } from './navGrid.ts';
import { smoothPath } from './smoothPath.ts';

/**
 * Plans a walk from a point standing in an open cell to a target point, for a tap (Papa) or a
 * threat (Papa's glide, the baby's approach). The path ends exactly at the target when it is in an
 * open cell of the walker's region, else at the centre of the nearest open cell of that region, so a
 * target is never unreachable. `out` is replaced by the smoothed flat waypoints. Returns where the
 * path ends, or null, leaving `out` empty, when there is no path. The walker's cell must be open.
 */
export function planRoute(
  grid: NavGrid,
  fromXM: number,
  fromZM: number,
  toXM: number,
  toZM: number,
  out: number[],
): { goalXM: number; goalZM: number } | null {
  out.length = 0;
  const startCell = grid.cellAt(fromXM, fromZM);
  if (startCell < 0 || grid.open[startCell] !== 1) return null;
  const region = grid.region[startCell] as number;

  let goalCell = grid.cellAt(toXM, toZM);
  let goalXM = toXM;
  let goalZM = toZM;
  if (goalCell < 0 || grid.region[goalCell] !== region) {
    goalCell = grid.nearestOpenCell(toXM, toZM, region);
    if (goalCell < 0) return null;
    goalXM = grid.centerXM(goalCell);
    goalZM = grid.centerZM(goalCell);
  }

  const cells = grid.scratch.cells;
  if (!findPath(grid, startCell, goalCell, cells)) return null;
  smoothPath(grid, cells, fromXM, fromZM, goalXM, goalZM, out);
  return { goalXM, goalZM };
}
