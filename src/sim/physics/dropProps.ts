import type { StepContext } from '../context.ts';
import type { World } from '../world.ts';
import { pushProp } from './propsSystem.ts';

/** Which props `dropProps` may knock over. */
export interface DropRule {
  /** How many props, at most. */
  readonly count: number;
  /** A prop farther than this from the origin, in metres (horizontal), is not « on the table ». */
  readonly reachM: number;
  /** The impulse each prop is given, in newton-seconds, along the line from the origin to it. */
  readonly pushImpulseNs: number;
  /** Only the props of a kind that cannot break (the door's spill, story 3.5 D10); a gag may take any. */
  readonly isUnbreakableOnly: boolean;
}

/**
 * Knocks props off a table (story 1.16, shared with the door's spill of story 3.5, `sim/physics`): up to
 * `rule.count` of the unbroken props that are off the floor, the nearest to `(originXM, originZM)` first and
 * within `rule.reachM`, each pushed horizontally away from the origin at `rule.pushImpulseNs`, so that it
 * leaves the table by its nearest edge. A prop exactly on the origin is pushed along the baby's gaze. Ties
 * go to the lower index and nothing is drawn from `world.rng`. Fewer props than `count` means fewer pushes,
 * none means none. The pushes reach the engine through `pushProp`; a call from `runFlow` (after `runPhysics`)
 * moves the props in the next step. Returns how many were pushed; `pushedOut`, when given, receives their indices.
 */
export function dropProps(
  world: World,
  ctx: StepContext,
  originXM: number,
  originZM: number,
  rule: DropRule,
  pushedOut?: number[],
): number {
  // Two choices in one call must differ: a pushed prop is still off the floor until it lands.
  const chosen: number[] = [];
  for (let n = 0; n < rule.count; n++) {
    let nearestIndex = -1;
    let nearestM = Number.POSITIVE_INFINITY;
    for (let index = 0; index < world.props.length; index++) {
      const prop = world.props[index];
      if (prop === undefined || prop.isBroken || prop.isOnFloor || chosen.includes(index)) continue;
      if (rule.isUnbreakableOnly && ctx.level.props[index]?.physics.breakable !== false) continue;
      const dxM = prop.xM - originXM;
      const dzM = prop.zM - originZM;
      // `sqrt` of the squares, as the table gag always did: `hypot` can differ in the last bit and move a golden.
      const distanceM = Math.sqrt(dxM * dxM + dzM * dzM);
      if (distanceM > rule.reachM || distanceM >= nearestM) continue;
      nearestIndex = index;
      nearestM = distanceM;
    }
    if (nearestIndex < 0) break;
    chosen.push(nearestIndex);
  }
  for (let i = 0; i < chosen.length; i++) {
    const index = chosen[i] as number;
    const prop = world.props[index] as World['props'][number];
    const dxM = prop.xM - originXM;
    const dzM = prop.zM - originZM;
    const distanceM = Math.sqrt(dxM * dxM + dzM * dzM);
    const awayX = distanceM > 0 ? dxM / distanceM : world.baby.gazeX;
    const awayZ = distanceM > 0 ? dzM / distanceM : world.baby.gazeZ;
    pushProp(world, ctx, index, awayX * rule.pushImpulseNs, 0, awayZ * rule.pushImpulseNs);
    pushedOut?.push(index);
  }
  return chosen.length;
}
