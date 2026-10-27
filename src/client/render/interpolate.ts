/** Linear interpolation: `a` at `alpha` = 0, `b` at `alpha` = 1. */
export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

/** A point of the floor plane, in metres. */
export interface PointXZ {
  xM: number;
  zM: number;
}

/**
 * Where an entity that moved from (`prevXM`, `prevZM`) to (`xM`, `zM`) during the last step is drawn
 * when the next step is `alpha` of the way (`0..1`). The view only ever sees the world after whole
 * steps, so the sim keeps the previous position for it (D11). Allocation-free: it writes `out`.
 */
export function interpolateXZ(
  prevXM: number,
  prevZM: number,
  xM: number,
  zM: number,
  alpha: number,
  out: PointXZ,
): void {
  out.xM = lerp(prevXM, xM, alpha);
  out.zM = lerp(prevZM, zM, alpha);
}
