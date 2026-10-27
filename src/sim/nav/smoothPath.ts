import type { NavGrid } from './navGrid.ts';

/**
 * Two crossings of the segment this close (in the segment's own 0..1 parameter) count as one
 * crossing of a grid corner. Float noise, not a game value; erring this way is conservative.
 */
const CORNER_TOLERANCE = 1e-9;

/**
 * Whether the straight segment from A to B stays inside open cells (grid traversal of
 * Amanatides and Woo). A segment through a grid corner needs the two cells beside the corner open
 * as well as the one it leaves and the one it enters: the corner case is conservative, so a path
 * never squeezes between two blocked cells that touch at a corner. A point off the grid, or in a
 * closed cell, is not visible.
 */
export function hasLineOfSight(
  grid: NavGrid,
  ax: number,
  az: number,
  bx: number,
  bz: number,
): boolean {
  let col = grid.columnAt(ax);
  let row = grid.rowAt(az);
  if (!grid.isOpenCell(col, row)) return false;
  const endCol = grid.columnAt(bx);
  const endRow = grid.rowAt(bz);
  if (!grid.isOpenCell(endCol, endRow)) return false;

  const dx = bx - ax;
  const dz = bz - az;
  const stepCol = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepRow = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const deltaX = stepCol === 0 ? Number.POSITIVE_INFINITY : grid.cellM / Math.abs(dx);
  const deltaZ = stepRow === 0 ? Number.POSITIVE_INFINITY : grid.cellM / Math.abs(dz);
  let nextX = Number.POSITIVE_INFINITY;
  if (stepCol > 0) nextX = (grid.originXM + (col + 1) * grid.cellM - ax) / dx;
  else if (stepCol < 0) nextX = (grid.originXM + col * grid.cellM - ax) / dx;
  let nextZ = Number.POSITIVE_INFINITY;
  if (stepRow > 0) nextZ = (grid.originZM + (row + 1) * grid.cellM - az) / dz;
  else if (stepRow < 0) nextZ = (grid.originZM + row * grid.cellM - az) / dz;

  // A segment crosses at most this many cell borders; more means float trouble: refuse.
  let budget = grid.cols + grid.rows + 4;
  while (Math.min(nextX, nextZ) < 1) {
    if (budget-- === 0) return false;
    if (Math.abs(nextX - nextZ) <= CORNER_TOLERANCE) {
      if (
        !grid.isOpenCell(col + stepCol, row) ||
        !grid.isOpenCell(col, row + stepRow) ||
        !grid.isOpenCell(col + stepCol, row + stepRow)
      ) {
        return false;
      }
      col += stepCol;
      row += stepRow;
      nextX += deltaX;
      nextZ += deltaZ;
    } else if (nextX < nextZ) {
      col += stepCol;
      nextX += deltaX;
      if (!grid.isOpenCell(col, row)) return false;
    } else {
      row += stepRow;
      nextZ += deltaZ;
      if (!grid.isOpenCell(col, row)) return false;
    }
  }
  return true;
}

/**
 * Turns the cells of an A* path into the few waypoints a straight walk needs: greedy string
 * pulling, each waypoint being the farthest cell centre still in line of sight from the previous
 * one. The walk starts at the exact point (`startXM`, `startZM`) and ends at the exact point
 * (`goalXM`, `goalZM`), which must be inside the last cell. `out` is replaced by the flat list
 * `[x0, z0, x1, z1, …]` of the waypoints after the start (the goal is the last one).
 */
export function smoothPath(
  grid: NavGrid,
  cells: readonly number[],
  startXM: number,
  startZM: number,
  goalXM: number,
  goalZM: number,
  out: number[],
): void {
  out.length = 0;
  let fromX = startXM;
  let fromZ = startZM;
  // `cells[0]` holds the start and the last cell holds the goal: the waypoints in between are
  // the centres of `cells[1 .. n-2]`, then the exact goal.
  let reached = 0; // index of the farthest candidate seen from (fromX, fromZ)
  const last = cells.length - 1;
  for (let i = 1; i <= last; i++) {
    const isGoal = i === last;
    const x = isGoal ? goalXM : grid.centerXM(cells[i] as number);
    const z = isGoal ? goalZM : grid.centerZM(cells[i] as number);
    if (i > reached + 1 && !hasLineOfSight(grid, fromX, fromZ, x, z)) {
      // `cells[i - 1]` was the last one in sight: it becomes a waypoint.
      const keep = cells[i - 1] as number;
      fromX = grid.centerXM(keep);
      fromZ = grid.centerZM(keep);
      out.push(fromX, fromZ);
      reached = i - 1;
    }
    if (isGoal) out.push(x, z);
  }
  if (last === 0) out.push(goalXM, goalZM);
}
