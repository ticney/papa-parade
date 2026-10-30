import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { enterPapaState, isPapaBusy } from '../papa/papaFsm.ts';
import { cashInCombo, startCarryTick, stopCarryTick } from '../scoring/combo.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { cancelThreat, telegraphThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';
import { ensureOnOpenCell, stopCrawling } from './approach.ts';
import { enterBabyState } from './babyFsm.ts';
import { drawBabbleMs } from './wander.ts';
import { isInZone } from './zone.ts';

// Carrying the baby (FR22, story 4.1). The baby's state is the single source of truth: `carried`.
// `takeBaby` and `putDownBaby` are called by `runPapa` (the same `TapBaby` does both); `runCarry` is
// the baby system's whole turn while he is in the arms. None of them is a system: the order of
// `SYSTEMS` does not change.

/** Whether the baby is within `feel.carry.reachM` of Papa. Pure; squared distances, no allocation. */
export function isBabyInReach(world: World, ctx: StepContext): boolean {
  const dx = world.baby.xM - world.papa.xM;
  const dz = world.baby.zM - world.papa.zM;
  const { reachM } = ctx.feel.carry;
  return dx * dx + dz * dz <= reachM * reachM;
}

/** Whether the floor point is inside one of the level's `kind: "safe"` zones. Pure. */
export function isInSafeZone(ctx: StepContext, xM: number, zM: number): boolean {
  const { safeZones } = ctx.level;
  for (let i = 0; i < safeZones.length; i++) {
    const zone = safeZones[i];
    if (zone !== undefined && isInZone(zone, xM, zM)) return true;
  }
  return false;
}

/**
 * Papa stops where he is: no path, no glide, no direction, no object and no intent, and he is idle.
 * Taking and putting down the baby are done standing still.
 */
function stopPapa(world: World, ctx: StepContext): void {
  const { papa } = world;
  papa.path.length = 0;
  papa.pathIndex = 0;
  papa.glide = null;
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  papa.objectId = null;
  papa.intent = 'none';
  enterPapaState(world, ctx, 'idle');
}

/** When the next cry in the arms is due: `armsCryMinMs…MaxMs` from now, with exactly one `nextFloat`. */
function drawArmsCryAt(world: World, ctx: StepContext) {
  const { armsCryMinMs, armsCryMaxMs } = ctx.feel.carry;
  return asSimMs(
    world.time.sim + armsCryMinMs + nextFloat(world.rng) * (armsCryMaxMs - armsCryMinMs),
  );
}

/**
 * Papa takes the baby in his arms, at the step of the command: he stops, the baby stops crawling,
 * drops his target and is set at Papa's point looking where Papa looks (`BabyStateChanged`, then
 * `BabyPickedUp`). Every threat of the baby that is announced or open, an anchored one or a found
 * silence's, is cancelled with no gag (`ThreatCancelled{carried}`), in threat order; the ones on Papa stay. With a cry in the arms the
 * level draws when the first one is due: one `nextFloat`, whatever the tuning.
 */
export function takeBaby(world: World, ctx: StepContext): void {
  const { papa, baby } = world;
  stopPapa(world, ctx);
  stopCrawling(world);
  baby.targetThreatId = null;
  baby.xM = papa.xM;
  baby.zM = papa.zM;
  baby.gazeX = papa.headingX;
  baby.gazeZ = papa.headingZ;
  enterBabyState(world, ctx, 'carried');
  ctx.events.push({ type: 'BabyPickedUp', t: world.time.sim });
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as ThreatInstance;
    if (threat.state !== 'telegraph' && threat.state !== 'windowOpen') continue;
    if (ctx.level.threats[i]?.def.target === 'papa') continue;
    cancelThreat(world, ctx, threat, 'carried');
  }
  if (ctx.level.armsCryIndex >= 0) world.carry.armsCryAt = drawArmsCryAt(world, ctx);
  startCarryTick(world, ctx);
}

/**
 * Papa sets the baby down, at the step of the command. The baby goes `putDownOffsetM` in front of
 * Papa along his heading, on the nearest open cell if that point is closed, and babbles again with
 * a fresh draw (his normal FSM resumes). `safe` is about Papa's point (D5). Events: `BabyStateChanged`,
 * `BabyPutDown`, then the cry in the arms, if it is up, is cancelled (`putDown`), then a safe drop
 * cashes the combo in (`ComboCashedIn`, `ComboChanged{cashIn}`, story 4.2). Other threats are left alone.
 */
export function putDownBaby(world: World, ctx: StepContext): void {
  const { papa, baby } = world;
  stopPapa(world, ctx);
  const { putDownOffsetM } = ctx.feel.carry;
  baby.xM = papa.xM + papa.headingX * putDownOffsetM;
  baby.zM = papa.zM + papa.headingZ * putDownOffsetM;
  ensureOnOpenCell(world, ctx);
  baby.babbling = true;
  baby.wanderAt = asSimMs(world.time.sim + drawBabbleMs(world, ctx));
  enterBabyState(world, ctx, 'babble');
  const isSafe = isInSafeZone(ctx, papa.xM, papa.zM);
  ctx.events.push({ type: 'BabyPutDown', t: world.time.sim, safe: isSafe });
  const index = ctx.level.armsCryIndex;
  const armsCry = index < 0 ? undefined : world.threats[index];
  if (armsCry !== undefined && (armsCry.state === 'telegraph' || armsCry.state === 'windowOpen')) {
    cancelThreat(world, ctx, armsCry, 'putDown');
  }
  world.carry.armsCryAt = null;
  // The combo is cashed in last, once the cry in the arms is cancelled (story 4.2).
  stopCarryTick(world);
  cashInCombo(world, ctx, isSafe);
}

/**
 * The baby's turn while he is in Papa's arms (called by `runBaby`, which then stops): the cry in the
 * arms. When it is due (`armsCryAt`) it is telegraphed at the first step where its instance is
 * `idle`, Papa is not busy, the flow is `playing` and it could be judged before the level ends; the
 * next one is then due `armsCryMinMs…MaxMs` later (one draw). A level with no cry in the arms does
 * nothing. The instance stands on Papa and follows him. Allocation-free.
 */
export function runCarry(world: World, ctx: StepContext): void {
  const index = ctx.level.armsCryIndex;
  if (index < 0) return;
  const threat = world.threats[index];
  const planned = ctx.level.threats[index];
  if (threat === undefined || planned === undefined) return;
  const { papa } = world;
  threat.xM = papa.xM;
  threat.zM = papa.zM;
  const { armsCryAt } = world.carry;
  const now = world.time.sim;
  if (armsCryAt === null || now < armsCryAt) return;
  if (threat.state !== 'idle' || isPapaBusy(papa) || world.flow.state !== 'playing') return;
  if (!isJudgeableBeforeEnd(world, ctx, planned.def, now)) return;
  telegraphThreat(world, ctx, threat, planned.def, -1);
  world.carry.armsCryAt = drawArmsCryAt(world, ctx);
}
