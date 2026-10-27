import type { NavGrid } from '../nav/navGrid.ts';
import { planRoute } from '../nav/planRoute.ts';
import type { BabySlice } from '../world.ts';

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
