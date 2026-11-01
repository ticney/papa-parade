import type { StepContext } from '../context.ts';
import { planRoute } from '../nav/planRoute.ts';
import type { PapaSlice, World } from '../world.ts';
import { enterPapaState } from './papaFsm.ts';

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

/**
 * Walks to a tapped point (D7): see {@link planWalkTo} for where the path ends. A tap cancels a
 * glide. A* failing anyway (it should not) leaves Papa where he is. Returns where the path ends, or
 * null when no path was planned.
 */
export function startWalkTo(
  world: World,
  ctx: StepContext,
  tapXM: number,
  tapZM: number,
): { goalXM: number; goalZM: number } | null {
  const { papa } = world;
  const goal = planWalkTo(papa, ctx, tapXM, tapZM);
  if (goal === null) return null;
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  papa.glide = null;
  // A walk to the floor is not a walk to an object; `tapObject` sets it again after a successful plan.
  papa.objectId = null;
  // Nor does it take or put down the baby; `tapBaby` and the safe-zone tap set `intent` after the plan.
  papa.intent = 'none';
  ctx.events.push({
    type: 'PapaPathPlanned',
    t: world.time.sim,
    targetXM: goal.goalXM,
    targetZM: goal.goalZM,
    waypointCount: papa.path.length / 2,
  });
  enterPapaState(world, ctx, 'walkPath');
  return goal;
}
