import { MS_PER_S } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { remainingPathLengthM } from '../nav/pathLength.ts';
import type { ThreatInstance, World } from '../world.ts';
import { enterPapaState } from './papaFsm.ts';
import { planWalkTo } from './planWalk.ts';

/**
 * Papa sets off to a pressed threat (D11, P3): the choreography of a response, never part of its
 * judgement. The glide follows an A* path planned like a tap's to the threat's position and lasts
 * `min(glideMaxMs, pathLength / walkSpeedMps)`; Papa moves at `pathLength / duration`, so never
 * slower than he walks. A new press replans it. With no path there is no glide and the judgement is
 * unaffected.
 */
export function startGlide(world: World, ctx: StepContext, threat: ThreatInstance): void {
  const { papa } = world;
  const { glideMaxMs, walkSpeedMps } = ctx.feel.movement;
  const goal = planWalkTo(papa, ctx, threat.xM, threat.zM);
  if (goal === null) return;
  const lengthM = remainingPathLengthM(papa);
  const durationMs = Math.min(glideMaxMs, (lengthM * MS_PER_S) / walkSpeedMps);
  const now = world.time.sim;
  papa.glide = {
    threatId: threat.id,
    toXM: goal.goalXM,
    toZM: goal.goalZM,
    startedAt: now,
    arriveAt: asSimMs(now + durationMs),
    speedMps: durationMs > 0 ? (lengthM * MS_PER_S) / durationMs : walkSpeedMps,
  };
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  // The glide is no walk to an object any more: a coffee on the way is cancelled.
  papa.objectId = null;
  ctx.events.push({
    type: 'PapaGlideStarted',
    t: now,
    threatId: threat.id,
    toXM: goal.goalXM,
    toZM: goal.goalZM,
    arriveAt: papa.glide.arriveAt,
  });
  enterPapaState(world, ctx, 'glide');
}
