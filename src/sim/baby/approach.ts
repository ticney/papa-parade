import type { StepContext } from '../context.ts';
import type { NavGrid } from '../nav/navGrid.ts';
import { planRoute } from '../nav/planRoute.ts';
import type { BabySlice, World } from '../world.ts';

/**
 * Plans the baby's approach to a target point: A* then string pulling into a new `baby.path` (one
 * array per approach, which becomes part of the world). The same snapping rule as Papa's tap: a
 * target in a closed cell (an outlet in a wall) or in another region means the nearest open cell of
 * the baby's region. Returns false, leaving the baby untouched, when there is no path.
 */
export function planApproach(baby: BabySlice, grid: NavGrid, toXM: number, toZM: number): boolean {
  const path: number[] = [];
  if (planRoute(grid, baby.xM, baby.zM, toXM, toZM, path) === null) return false;
  baby.path = path;
  baby.pathIndex = 0;
  return true;
}

/**
 * Turns the baby's gaze towards a point, as a unit vector. Unchanged when the point is where the
 * baby is (there is no direction to look in). Only `Math.sqrt`: no trigonometry in the sim.
 */
export function gazeAt(baby: BabySlice, xM: number, zM: number): void {
  const dx = xM - baby.xM;
  const dz = zM - baby.zM;
  const distanceM = Math.sqrt(dx * dx + dz * dz);
  if (!(distanceM > 0)) return;
  baby.gazeX = dx / distanceM;
  baby.gazeZ = dz / distanceM;
}

/** Moves a baby that stands in a closed cell to the nearest open cell of any region (no event). */
export function ensureOnOpenCell(world: World, ctx: StepContext): void {
  const { baby } = world;
  const grid = ctx.nav.baby;
  if (grid.isOpenAt(baby.xM, baby.zM)) return;
  const cell = grid.nearestOpenCell(baby.xM, baby.zM, -1);
  if (cell < 0) return;
  baby.xM = grid.centerXM(cell);
  baby.zM = grid.centerZM(cell);
}

/** Drops the path and the speed of an approach (or of a wander it interrupts). */
export function stopCrawling(world: World): void {
  const { baby } = world;
  baby.path.length = 0;
  baby.pathIndex = 0;
  baby.approachSpeedMps = 0;
}
