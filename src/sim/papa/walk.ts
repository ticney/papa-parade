import type { NavGrid } from '../nav/navGrid.ts';
import type { PapaSlice } from '../world.ts';

/**
 * Walks Papa along `papa.path` for at most `budgetM` metres, crossing several waypoints in one go
 * if the budget allows, and moves `papa.pathIndex` on. The heading follows the segment walked.
 * Returns true when the last waypoint has been reached (Papa then stands exactly on it). It knows
 * nothing about speed: the caller says how far to go (story 1.10's glide reuses it).
 *
 * Pure maths on plain data, allocation-free. Only `Math.sqrt` (correctly rounded) is used.
 */
export function advanceAlongPath(papa: PapaSlice, budgetM: number): boolean {
  const { path } = papa;
  let remainingM = budgetM;
  while (remainingM > 0 && papa.pathIndex * 2 < path.length) {
    const targetX = path[papa.pathIndex * 2] as number;
    const targetZ = path[papa.pathIndex * 2 + 1] as number;
    const dx = targetX - papa.xM;
    const dz = targetZ - papa.zM;
    const distanceM = Math.sqrt(dx * dx + dz * dz);
    if (distanceM <= remainingM) {
      papa.xM = targetX;
      papa.zM = targetZ;
      papa.pathIndex++;
      remainingM -= distanceM;
      if (distanceM > 0) {
        papa.headingX = dx / distanceM;
        papa.headingZ = dz / distanceM;
      }
    } else {
      papa.xM += (dx / distanceM) * remainingM;
      papa.zM += (dz / distanceM) * remainingM;
      papa.headingX = dx / distanceM;
      papa.headingZ = dz / distanceM;
      remainingM = 0;
    }
  }
  return papa.pathIndex * 2 >= path.length;
}

/**
 * One step of a direction walk: `papa.dirX/dirZ` (a unit vector) times `budgetM`. If the full step
 * ends in a closed cell it tries the x part alone, then the z part alone, so that Papa slides along
 * a wall when pushed diagonally. One step is far smaller than a cell, so testing the end point is
 * enough. Returns false when Papa could not move at all (he stays where he is).
 */
export function stepInDirection(papa: PapaSlice, grid: NavGrid, budgetM: number): boolean {
  const stepX = papa.dirX * budgetM;
  const stepZ = papa.dirZ * budgetM;
  if (grid.isOpenAt(papa.xM + stepX, papa.zM + stepZ)) {
    papa.xM += stepX;
    papa.zM += stepZ;
    return true;
  }
  if (stepX !== 0 && grid.isOpenAt(papa.xM + stepX, papa.zM)) {
    papa.xM += stepX;
    return true;
  }
  if (stepZ !== 0 && grid.isOpenAt(papa.xM, papa.zM + stepZ)) {
    papa.zM += stepZ;
    return true;
  }
  return false;
}
