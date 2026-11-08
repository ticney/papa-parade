import type { ObjectKind } from '@content/schemas/level';
import { STEP_MS } from '@shared/constants';
import { isBabyCarried } from '../baby/babyFsm.ts';
import { isBabyInReach, isInSafeZone, putDownBaby, takeBaby } from '../baby/carry.ts';
import { isBabyFoundNow } from '../baby/silence.ts';
import { choreIndexOfObject, resumeChoreOfPot, startChore } from '../chores/chores.ts';
import type { SimObjectSpec, StepContext } from '../context.ts';
import { answerPhone, ringingDisruptionAt } from '../disruptions/phone.ts';
import { bladderSpeedFactor } from '../gauges/bladder.ts';
import { advanceAlongPath } from '../nav/followPath.ts';
import { isBabyJustLaid } from '../sequences/layDown.ts';
import { isStealthStepRunning } from '../sequences/stealthExit.ts';
import {
  debrisIndexOf,
  finishPapaBusy,
  startCarryUp,
  startPickUp,
} from '../threats/afterEffects.ts';
import type { ThreatInstance, World } from '../world.ts';
import { startCoffee } from './coffee.ts';
import { startGlide, startGlideTo } from './glide.ts';
import { enterPapaState, isPapaBusy } from './papaFsm.ts';
import { startCall } from './phoneCall.ts';
import { startWalkTo } from './planWalk.ts';
import { messPropIndexOf, tidyProp } from './tidyProp.ts';
import { startToilet } from './toilet.ts';
import { stepInDirection } from './walk.ts';

/**
 * What Papa does on arriving at an object, by kind (story 1.19 D7): true when the action took over
 * his state, false when he is simply idle there. One entry per `ObjectKind`, defined once at module
 * scope: a kind with no action is a type error, and `content:check` refuses it through
 * {@link OBJECT_ACTION_KINDS}.
 */
type ObjectAction = (world: World, ctx: StepContext, object: SimObjectSpec) => boolean;

const OBJECT_ACTIONS: Readonly<Record<ObjectKind, ObjectAction>> = {
  coffee_machine: (world, ctx, object) => {
    startCoffee(world, ctx, object.id);
    return true;
  },
  // A ringing phone is answered (story 1.20 D7: decided on arrival, like the coffee); one that does
  // not ring, yet or any more (`runDisruptions` runs first, so one that timed out this very step is
  // already silent), is only somewhere to walk to.
  phone: (world, ctx, object) => {
    const index = ringingDisruptionAt(world, ctx, object.id);
    if (index < 0) return false;
    answerPhone(world, ctx, index);
    startCall(world, ctx, index);
    return true;
  },
  // The door of the toilet (story 4.3): Papa is out of the room for `toiletDurationMs`.
  toilet: (world, ctx, object) => {
    startToilet(world, ctx, object.id);
    return true;
  },
  // A house chore's station (story 9.4): Papa works there until he leaves, unless the chore is done
  // (then he is only standing at the stove, idle).
  stove: (world, ctx, object) => startChore(world, ctx, object.id),
  // The second station (story 9.6): the dishwasher is emptied the same way, and Papa opens its door.
  dishwasher: (world, ctx, object) => startChore(world, ctx, object.id),
};

/** Every object kind the sim has an action for. */
export const OBJECT_ACTION_KINDS = Object.keys(OBJECT_ACTIONS) as readonly ObjectKind[];

/** Whether Papa can take the baby now: the level carries, he is not carried, not hiding, and within reach. */
function isTakeable(world: World, ctx: StepContext): boolean {
  const { state } = world.baby;
  return (
    ctx.level.hasCarry &&
    state !== 'carried' &&
    state !== 'mischiefSilent' &&
    state !== 'downstairs' &&
    state !== 'carriedUp' &&
    isBabyInReach(world, ctx)
  );
}

/**
 * `TapBaby` (story 4.1 rule 6), in this order. The tap that found a hiding baby is spent (Papa stays
 * for the parry). In a level that does not carry, or for a hiding baby who is not found, Papa just
 * walks to where the baby is (story 1.21). A baby left at the bottom of the stairs (story 3.15) is
 * fetched, before any of the rest: carried up at once if he is within reach, else walked to
 * (`fetchBaby`). A carried baby is put down here. A baby within reach is
 * taken at once; a farther one is walked to, and taken on arrival if he is then within reach. True
 * when the baby was taken or put down, so that `runPapa` can ignore a second `TapBaby` in the same
 * step (a pointer tap and Space together) instead of undoing the first.
 */
function tapBaby(world: World, ctx: StepContext): boolean {
  if (isBabyFoundNow(world, ctx)) return false;
  const { baby, papa } = world;
  if (baby.state === 'downstairs') {
    if (isBabyInReach(world, ctx)) startCarryUp(world, ctx);
    else if (startWalkTo(world, ctx, baby.xM, baby.zM) !== null) papa.intent = 'fetchBaby';
    return false;
  }
  if (baby.state === 'carriedUp') return false;
  if (!ctx.level.hasCarry || baby.state === 'mischiefSilent') {
    startWalkTo(world, ctx, baby.xM, baby.zM);
  } else if (baby.state === 'carried') {
    putDownBaby(world, ctx);
    return true;
  } else if (isBabyInReach(world, ctx)) {
    takeBaby(world, ctx);
    return true;
  } else if (startWalkTo(world, ctx, baby.xM, baby.zM) !== null) {
    papa.intent = 'takeBaby';
  }
  return false;
}

/**
 * `TapFloor`: a walk to the point; with the baby in his arms, a walk that ends inside a safe zone
 * ends in a put-down. The zone is tested where the path ends, not at the tap: a tap on a closed
 * cell of the playpen (its rim) can end outside it.
 */
function tapFloorCommand(world: World, ctx: StepContext, xM: number, zM: number): void {
  const goal = startWalkTo(world, ctx, xM, zM);
  if (goal !== null && isBabyCarried(world) && isInSafeZone(ctx, goal.goalXM, goal.goalZM)) {
    world.papa.intent = 'putDownBaby';
  }
}

/** The end of a walk to a point: `PapaArrived`, then the action of the object the walk went to, else idle. */
function arrive(world: World, ctx: StepContext): void {
  const { papa } = world;
  papa.path.length = 0;
  papa.pathIndex = 0;
  const glideThreatId = papa.glide?.threatId ?? null;
  papa.glide = null;
  ctx.events.push({ type: 'PapaArrived', t: world.time.sim, xM: papa.xM, zM: papa.zM });
  // A glide to a chore's own pot (story 9.5, review): the heat lowered, Papa goes back to the cooking.
  if (glideThreatId !== null && resumeChoreOfPot(world, ctx, glideThreatId)) return;
  const objectId = papa.objectId;
  papa.objectId = null;
  // The walk was to take the baby (if he is then within reach and free to be taken) or to put him down.
  const { intent } = papa;
  papa.intent = 'none';
  if (intent === 'takeBaby' && isTakeable(world, ctx)) {
    takeBaby(world, ctx);
    return;
  }
  if (intent === 'putDownBaby' && isBabyCarried(world)) {
    putDownBaby(world, ctx);
    return;
  }
  // The walk was to fetch the baby from the stairs (story 3.15): if he climbed back meanwhile, or the
  // walk ended short of him (a blocked path), nothing more.
  if (intent === 'fetchBaby') {
    if (isBabyInReach(world, ctx)) startCarryUp(world, ctx);
    if (world.papa.state !== 'carryingUp') enterPapaState(world, ctx, 'idle');
    return;
  }
  if (objectId !== null) {
    const objects = ctx.level.objects;
    for (let i = 0; i < objects.length; i++) {
      const object = objects[i] as SimObjectSpec;
      if (object.id === objectId && OBJECT_ACTIONS[object.kind](world, ctx, object)) return;
    }
    // The walk was to a prop of the final rush (story 3.5): still a mess on arrival, it is tidied.
    const propIndex = messPropIndexOf(world, objectId);
    if (propIndex >= 0) {
      if (world.flow.state === 'finalRush') {
        tidyProp(world, ctx, propIndex);
        enterPapaState(world, ctx, 'idle');
        return;
      }
      // Outside the rush only a debris is walked to (story 3.15): Papa picks it up, a busy occupation.
      if (debrisIndexOf(world, objectId) >= 0) {
        startPickUp(world, ctx, propIndex);
        return;
      }
    }
  }
  enterPapaState(world, ctx, 'idle');
}

/**
 * Walks to an interactive object of the level exactly as a tap on its anchor does, then says so.
 * The walk remembers the object (`papa.objectId`): arriving runs its action. In the final rush the
 * id of a prop that is a mess is walked to the same way and tidied on arrival (story 3.5); outside it a
 * debris is picked up on arrival (story 3.15). An unknown id does nothing.
 */
function tapObject(world: World, ctx: StepContext, objectId: string): void {
  const objects = ctx.level.objects;
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i] as SimObjectSpec;
    if (object.id !== objectId) continue;
    // The toilet is no place for a baby in the arms: refused at the tap, Papa goes nowhere (4.3 D4).
    if (object.kind === 'toilet' && isBabyCarried(world)) {
      ctx.events.push({ type: 'ToiletRefused', t: world.time.sim, objectId });
      return;
    }
    // A chore's station (story 9.4): Papa glides to it and works on arrival; the baby in his arms
    // refuses it at the tap (D10). A done chore's station is only somewhere to walk to.
    const choreIndex = choreIndexOfObject(ctx, objectId);
    if (choreIndex >= 0 && world.chores[choreIndex]?.state !== 'done') {
      if (isBabyCarried(world)) {
        ctx.events.push({ type: 'ChoreRefused', t: world.time.sim, objectId, reason: 'carrying' });
        return;
      }
      if (startGlideTo(world, ctx, object.xM, object.zM, null)) {
        world.papa.objectId = objectId;
        ctx.events.push({ type: 'ObjectTapped', t: world.time.sim, objectId });
      }
      return;
    }
    if (startWalkTo(world, ctx, object.xM, object.zM) !== null) {
      world.papa.objectId = objectId;
      ctx.events.push({ type: 'ObjectTapped', t: world.time.sim, objectId });
    }
    return;
  }
  // In the final rush, a prop that is a mess is walked to like an object (story 3.5); outside it,
  // only a debris of the coffee table's gag is (story 3.15, picked up on arrival); any other prop
  // does nothing.
  const propIndex =
    world.flow.state === 'finalRush'
      ? messPropIndexOf(world, objectId)
      : debrisIndexOf(world, objectId);
  const prop = propIndex >= 0 ? world.props[propIndex] : undefined;
  if (prop === undefined) return;
  if (startWalkTo(world, ctx, prop.xM, prop.zM) !== null) {
    world.papa.objectId = objectId;
    ctx.events.push({ type: 'ObjectTapped', t: world.time.sim, objectId });
  }
}

/** A direction cancels a path and a glide. A new direction while already walking one only updates it. */
function move(world: World, ctx: StepContext, dirX: number, dirZ: number): void {
  // Scaled by the larger component first, so that a huge (or tiny) finite vector neither overflows
  // nor underflows when squared.
  const largest = Math.max(Math.abs(dirX), Math.abs(dirZ));
  if (!(largest > 0)) return; // `commandProblem` refuses (0, 0)
  const scaledX = dirX / largest;
  const scaledZ = dirZ / largest;
  const length = Math.sqrt(scaledX * scaledX + scaledZ * scaledZ);
  const { papa } = world;
  // `+ 0` turns a -0 into 0: nothing in the sim may depend on a sign of zero.
  const nextX = scaledX / length + 0;
  const nextZ = scaledZ / length + 0;
  // Turning towards another wall is a new blockage: it must be reported again.
  if (nextX !== papa.dirX || nextZ !== papa.dirZ) papa.isBlocked = false;
  papa.dirX = nextX;
  papa.dirZ = nextZ;
  papa.headingX = papa.dirX;
  papa.headingZ = papa.dirZ;
  if (papa.state === 'walkPath' || papa.state === 'glide') {
    papa.path.length = 0;
    papa.pathIndex = 0;
  }
  papa.glide = null;
  papa.objectId = null;
  papa.intent = 'none';
  enterPapaState(world, ctx, 'walkDir');
}

/**
 * A press on a threat sends Papa gliding to it, whatever the judgement says (D11): the client starts the glide at
 * `pointerdown`, before any judgement, and the two must not contradict. That includes a press this very step gagged
 * (too early or too late), and a later press on a threat that is resolved or gagged and waits out its cooldown (a new
 * press replans the glide: it is where Papa goes, not a judgement). A press on an unknown threat, or on one that is
 * idle (not telegraphed yet, or already re-armed) or hidden (a silence not found yet), does nothing.
 */
function pressThreat(world: World, ctx: StepContext, threatId: number): void {
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as ThreatInstance;
    if (threat.id !== threatId) continue;
    // A threat on Papa himself (the micro-sleep, story 1.19 D9) has nowhere to glide to: he stays
    // where he is, and keeps walking if he was. The response is still judged on the press.
    if (ctx.level.threats[i]?.def.target === 'papa') return;
    // A silence nobody has found yet is hidden: there is nothing to glide to (story 1.21).
    if (threat.state !== 'idle' && threat.state !== 'hidden') startGlide(world, ctx, threat);
    return;
  }
}

/** Releasing a key only stops a direction walk: it must not cancel a tap made meanwhile (D6). */
function moveStop(world: World, ctx: StepContext): void {
  const { papa } = world;
  if (papa.state !== 'walkDir') return;
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  enterPapaState(world, ctx, 'idle');
}

/**
 * System: Papa. Remembers where he stood (for the view's interpolation), ends a coffee, a nap, a
 * call or a toilet visit whose time is up (`busyUntil`; a coffee and a visit have something to
 * finish, the others go back to idle), handles this step's `TapFloor` / `TapObject` / `TapBaby` (takes or puts down the baby, story 4.1, else a walk to where he is) / `Move` / `MoveStop` /
 * `PressThreat` in order (none while he is busy, D6: he drinks, sleeps, talks or is in the toilet and answers nothing), then
 * moves him once for one step: by `walkSpeedMps`, or by the speed of his glide. The speed is read
 * each step, so a changed feel applies at once.
 */
export function runPapa(world: World, ctx: StepContext): void {
  const { papa } = world;
  papa.prevXM = papa.xM;
  papa.prevZM = papa.zM;

  // A won « Dépose-bombe » (story 4.8) ends with the baby on the mattress and the combo cashed in. It
  // is done here and not by the end of the sequence: `carry.ts` imports the threat code, which
  // imports `sequenceEnd`. `runThreats` ran first, so `ResponseResolved` and `SequenceEnded` are already
  // in this step's events.
  const isJustLaid = isBabyJustLaid(world, ctx);
  if (isJustLaid) putDownBaby(world, ctx);

  if (isPapaBusy(papa) && world.time.sim >= papa.busyUntil) {
    finishPapaBusy(world, ctx);
  }

  let hasToggledCarry = false;
  // Papa stands still in a special sequence (story 4.4 D3): only a press on a threat gets through. The
  // step that lays the baby is the sequence's last: the flow is `playing` already, but a tap queued
  // for it must not take him back from the mattress. A stealth step (story 4.9) is the one sequence
  // that is walked: floor taps, moves and presses work, but he takes no baby and drinks no coffee.
  const isStealth = isStealthStepRunning(world);
  const isHeld = (world.flow.state === 'sequence' && !isStealth) || isJustLaid;
  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command === undefined) continue;
    if (isPapaBusy(papa)) break;
    if (isHeld && command.type !== 'PressThreat') continue;
    if (isStealth && (command.type === 'TapBaby' || command.type === 'TapObject')) continue;
    if (command.type === 'TapFloor') tapFloorCommand(world, ctx, command.xM, command.zM);
    else if (command.type === 'TapObject') tapObject(world, ctx, command.objectId);
    else if (command.type === 'TapBaby') {
      if (!hasToggledCarry) hasToggledCarry = tapBaby(world, ctx);
    } else if (command.type === 'Move') move(world, ctx, command.dirX, command.dirZ);
    else if (command.type === 'MoveStop') moveStop(world, ctx);
    else if (command.type === 'PressThreat') pressThreat(world, ctx, command.threatId);
  }

  // A full need slows the walks, not the glide (story 4.3 D3). The factor is the previous step's. A
  // stealth step (story 4.9) slows them too, to `sneakSpeedPct` of the walk; its glide is not.
  const sneakFactor = isStealth ? ctx.feel.stealth.sneakSpeedPct / 100 : 1;
  const budgetM =
    (ctx.feel.movement.walkSpeedMps * STEP_MS * bladderSpeedFactor(world, ctx) * sneakFactor) /
    1000;
  if (papa.state === 'walkPath') {
    if (advanceAlongPath(papa, budgetM)) arrive(world, ctx);
  } else if (papa.state === 'glide' && papa.glide !== null) {
    if (advanceAlongPath(papa, (papa.glide.speedMps * STEP_MS) / 1000)) arrive(world, ctx);
  } else if (papa.state === 'walkDir') {
    if (stepInDirection(papa, ctx.nav.papa, budgetM)) {
      papa.isBlocked = false;
    } else if (!papa.isBlocked) {
      papa.isBlocked = true;
      ctx.events.push({ type: 'PapaBlocked', t: world.time.sim, xM: papa.xM, zM: papa.zM });
    }
  }

  // A carried baby rides in Papa's arms (story 4.1 D4): at Papa's point, looking where he looks.
  const { baby } = world;
  if (baby.state === 'carried') {
    baby.xM = papa.xM;
    baby.zM = papa.zM;
    baby.gazeX = papa.headingX;
    baby.gazeZ = papa.headingZ;
  }
}
