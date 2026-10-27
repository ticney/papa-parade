import type { NavGrid } from '../nav/navGrid.ts';
import type { PapaSlice } from '../world.ts';

/**
 * One step of a direction walk: `papa.dirX/dirZ` (a unit vector) times `budgetM`. If the full step
 * ends in a closed cell it tries the x part alone, then the z part alone, so that Papa slides along
 * a wall when pushed diagonally. One step is at most half a cell (`MAX_WALK_SPEED_MPS`, enforced by
 * the feel schema), so testing the end point is enough. Returns false when Papa could not move at all (he stays where he is).
 */
export function stepInDirection(papa: PapaSlice, grid: NavGrid, budgetM: number): boolean {
  const stepX = papa.dirX * budgetM;
  const stepZ = papa.dirZ * budgetM;
  // A diagonal step needs one of the two cells beside it open, as the A* does: it keeps Papa in the
  // region he started in instead of squeezing through a corner.
  const isDiagonalAllowed =
    stepX === 0 ||
    stepZ === 0 ||
    grid.isOpenAt(papa.xM + stepX, papa.zM) ||
    grid.isOpenAt(papa.xM, papa.zM + stepZ);
  if (isDiagonalAllowed && grid.isOpenAt(papa.xM + stepX, papa.zM + stepZ)) {
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
