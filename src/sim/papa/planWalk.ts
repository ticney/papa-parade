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
  let startXM = papa.xM;
  let startZM = papa.zM;
  const startCell = grid.cellAt(startXM, startZM);
  if (startCell < 0 || grid.open[startCell] !== 1) {
    // Impossible after the spawn snapping, but cheap: stand on the nearest open cell of any region.
    const nearest = grid.nearestOpenCell(startXM, startZM, -1);
    if (nearest < 0) return null;
    startXM = grid.centerXM(nearest);
    startZM = grid.centerZM(nearest);
  }
  const path: number[] = [];
  const goal = planRoute(grid, startXM, startZM, xM, zM, path);
  if (goal === null) return null;
  // Papa is touched only once the plan exists: a failure leaves him where he was.
  papa.xM = startXM;
  papa.zM = startZM;
  papa.path = path;
  papa.pathIndex = 0;
  return goal;
}
