import type { StepContext } from '../context.ts';
import { planRoute } from '../nav/planRoute.ts';
import type { PapaSlice } from '../world.ts';

/**
 * Plans Papa's walk to a point (D7 of story 1.7): a tap on the floor, or the glide to a threat. The
 * path ends exactly at the point when it is in an open cell of Papa's region, else at the centre of
 * the nearest open cell of that region, so a point is never unreachable. Replans from where Papa
 * stands, in any state. Writes `papa.path` (a new array: it becomes part of the world) and returns
 * where it ends; null, leaving Papa untouched, when there is no path (it should not happen).
 */
export function planWalkTo(
  papa: PapaSlice,
  ctx: StepContext,
  xM: number,
  zM: number,
): { goalXM: number; goalZM: number } | null {
  const grid = ctx.nav.papa;
  let startCell = grid.cellAt(papa.xM, papa.zM);
  if (startCell < 0 || grid.open[startCell] !== 1) {
    // Impossible after the spawn snapping, but cheap: stand on the nearest open cell of any region.
    startCell = grid.nearestOpenCell(papa.xM, papa.zM, -1);
    if (startCell < 0) return null;
    papa.xM = grid.centerXM(startCell);
    papa.zM = grid.centerZM(startCell);
  }
  const path: number[] = [];
  const goal = planRoute(grid, papa.xM, papa.zM, xM, zM, path);
  if (goal === null) return null;
  papa.path = path;
  papa.pathIndex = 0;
  return goal;
}
