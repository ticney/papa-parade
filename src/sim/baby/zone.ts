import type { SimZoneRect } from '../context.ts';

/** Whether the floor point (`xM`, `zM`) is inside the zone's box seen from above (the edge counts). Pure. */
export function isInZone(zone: SimZoneRect, xM: number, zM: number): boolean {
  return Math.abs(xM - zone.centerXM) <= zone.halfXM && Math.abs(zM - zone.centerZM) <= zone.halfZM;
}
