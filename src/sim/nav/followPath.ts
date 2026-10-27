/**
 * What a walker needs to follow a smoothed path: the position, the heading it keeps, the flat
 * waypoints still ahead and the next one. `PapaSlice` and `BabySlice` both have these fields.
 */
export interface PathFollower {
  xM: number;
  zM: number;
  /** Unit vector of the last direction of travel. */
  headingX: number;
  headingZ: number;
  /** Waypoints still ahead as a flat `[x0, z0, x1, z1, …]`. */
  path: number[];
  /** Next waypoint, counted in points (not in numbers). */
  pathIndex: number;
}

/**
 * Walks `walker` along its path for at most `budgetM` metres, crossing several waypoints in one go
 * if the budget allows, and moves `pathIndex` on. The heading follows the segment walked.
 * Returns true when the last waypoint has been reached (the walker then stands exactly on it). It knows
 * nothing about speed: the caller says how far to go (Papa's walk, the baby's crawl, story 1.10's glide).
 *
 * Pure maths on plain data, allocation-free. Only `Math.sqrt` (correctly rounded) is used.
 */
export function advanceAlongPath(walker: PathFollower, budgetM: number): boolean {
  const { path } = walker;
  let remainingM = budgetM;
  while (remainingM > 0 && walker.pathIndex * 2 < path.length) {
    const targetX = path[walker.pathIndex * 2] as number;
    const targetZ = path[walker.pathIndex * 2 + 1] as number;
    const dx = targetX - walker.xM;
    const dz = targetZ - walker.zM;
    const distanceM = Math.sqrt(dx * dx + dz * dz);
    if (distanceM <= remainingM) {
      walker.xM = targetX;
      walker.zM = targetZ;
      walker.pathIndex++;
      remainingM -= distanceM;
      if (distanceM > 0) {
        walker.headingX = dx / distanceM;
        walker.headingZ = dz / distanceM;
      }
    } else {
      walker.xM += (dx / distanceM) * remainingM;
      walker.zM += (dz / distanceM) * remainingM;
      walker.headingX = dx / distanceM;
      walker.headingZ = dz / distanceM;
      remainingM = 0;
    }
  }
  return walker.pathIndex * 2 >= path.length;
}
