import { AUTO_TARGET_EDGE_EPSILON_M, AUTO_TARGET_ON_PAPA_M } from '@shared/constants';
import { log } from '@shared/log';
import type { ThreatInstance } from '@sim';
import type { FloorDir } from './moveDirection.ts';

// A threat that is active but has no frozen window cannot happen (the window is frozen at the
// telegraph); it is skipped and said once per threat id.
const warnedNoWindow = new Set<number>();

/**
 * The threat Space or A parries (story 1.17, D1 to D4), or null when none is active. Candidates are
 * the threats in `telegraph` or `windowOpen`; the most urgent is the one whose window closes first
 * (`windowOpenAt + responseWindow.windowMs`), ties to the lower id. With an `aim` (a unit floor
 * direction), only the threats inside the cone count (the angle between `aim` and the vector from
 * Papa to the threat is at most `coneDeg / 2`, a threat on Papa counts in every cone); when none is
 * in the cone, the most urgent threat overall wins (D3). With no `aim`, the most urgent overall.
 * The cone test is a dot product against the cosine of the half-angle, computed from `coneDeg` on
 * each call (Geo can change the feel). Allocates nothing: it runs every frame.
 */
export function pickAutoTarget(
  threats: readonly Readonly<ThreatInstance>[],
  papaXM: number,
  papaZM: number,
  aim: Readonly<FloorDir> | null,
  coneDeg: number,
): number | null {
  const cosHalf = coneDeg >= 360 ? -1 : Math.cos((coneDeg * Math.PI) / 360);
  let bestId = -1;
  let bestCloseAt = Number.POSITIVE_INFINITY;
  let anyId = -1;
  let anyCloseAt = Number.POSITIVE_INFINITY;
  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as Readonly<ThreatInstance>;
    if (threat.state !== 'telegraph' && threat.state !== 'windowOpen') continue;
    if (threat.responseWindow === null) {
      if (!warnedNoWindow.has(threat.id)) {
        warnedNoWindow.add(threat.id);
        log.warn('input', 'an active threat has no response window: not auto-targeted', {
          threatId: threat.id,
        });
      }
      continue;
    }
    const closeAt = threat.windowOpenAt + threat.responseWindow.windowMs;
    const isMoreUrgentAnywhere =
      closeAt < anyCloseAt || (closeAt === anyCloseAt && threat.id < anyId);
    if (isMoreUrgentAnywhere) {
      anyId = threat.id;
      anyCloseAt = closeAt;
    }
    if (aim === null) continue;
    const dx = threat.xM - papaXM;
    const dz = threat.zM - papaZM;
    const distance = Math.sqrt(dx * dx + dz * dz);
    const isInCone =
      distance <= AUTO_TARGET_ON_PAPA_M ||
      dx * aim.x + dz * aim.z >= cosHalf * distance - AUTO_TARGET_EDGE_EPSILON_M;
    if (isInCone && (closeAt < bestCloseAt || (closeAt === bestCloseAt && threat.id < bestId))) {
      bestId = threat.id;
      bestCloseAt = closeAt;
    }
  }
  if (aim !== null && bestId >= 0) return bestId;
  return anyId >= 0 ? anyId : null;
}
