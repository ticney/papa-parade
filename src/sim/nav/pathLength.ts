import type { PathFollower } from './followPath.ts';

/**
 * How far a walker still has to go along its path, in metres: from where it stands through the
 * waypoints from `pathIndex` on. Only `Math.sqrt`, allocation-free.
 */
export function remainingPathLengthM(walker: PathFollower): number {
  let lengthM = 0;
  let x = walker.xM;
  let z = walker.zM;
  for (let i = walker.pathIndex; i * 2 < walker.path.length; i++) {
    const nextX = walker.path[i * 2] as number;
    const nextZ = walker.path[i * 2 + 1] as number;
    const dx = nextX - x;
    const dz = nextZ - z;
    lengthM += Math.sqrt(dx * dx + dz * dz);
    x = nextX;
    z = nextZ;
  }
  return lengthM;
}
