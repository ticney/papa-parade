import { PROP_ON_FLOOR_TOLERANCE_M, PROP_TIPPED_UP_Y_MAX } from '@shared/constants';
import type { StepContext } from '../context.ts';
import type { PropSlice, World } from '../world.ts';
import type { PropPose } from './physicsPort.ts';

/** Reused by every step: `readPose` writes here, then the slice copies it. */
const pose: PropPose = { xM: 0, yM: 0, zM: 0, qx: 0, qy: 0, qz: 0, qw: 1 };

/** The world and context of the step being run, for `onImpact` (a callback made once, not a closure per step). */
let activeWorld: World | null = null;
let activeCtx: StepContext | null = null;

/**
 * Pushes the prop at `propIndex` with an impulse (N·s, world axes) at its centre of mass and wakes
 * it. A broken prop is left alone. This is what a gag calls (story 1.16); the journaled test and
 * debug command `PushProp` goes through it too. Call it before `runPhysics` steps the engine (any
 * system that runs earlier in the step may), so that the push counts in this step.
 */
export function pushProp(
  world: World,
  ctx: StepContext,
  propIndex: number,
  xNs: number,
  yNs: number,
  zNs: number,
): void {
  const prop = world.props[propIndex];
  if (prop === undefined || prop.isBroken) return;
  ctx.physics.applyImpulse(propIndex, xNs, yNs, zNs);
}

/** A prop that took a hit of `impulseNs` from `otherIndex` (-1: the floor, a wall or furniture). */
function onImpact(propIndex: number, otherIndex: number, impulseNs: number): void {
  const world = activeWorld as World;
  const ctx = activeCtx as StepContext;
  const { physics } = ctx.feel;
  // Rapier filters by force already; this is the sim's own threshold, the one the cooldown and the breakage use.
  if (impulseNs < physics.impactMinImpulseNs) return;
  const prop = world.props[propIndex] as PropSlice;
  const spec = ctx.level.props[propIndex];
  const now = world.time.sim;
  if (prop.lastImpactAt === null || now - prop.lastImpactAt >= physics.impactCooldownMs) {
    prop.lastImpactAt = now;
    ctx.events.push({
      type: 'PropImpact',
      t: now,
      propId: prop.id,
      impulseNs,
      otherPropId: otherIndex >= 0 ? (world.props[otherIndex] as PropSlice).id : null,
    });
  }
  // Breakage is checked on every hit above the threshold, whatever the cooldown says.
  if (
    spec !== undefined &&
    !prop.isBroken &&
    spec.physics.breakable &&
    impulseNs >= spec.physics.breakImpulseNs
  ) {
    prop.isBroken = true;
    ctx.events.push({ type: 'PropBroken', t: now, propId: prop.id, impulseNs });
  }
}

/**
 * Approximate height of the prop's lowest point above the floor, in metres: its centre minus the
 * half height of its box, or minus its largest half extent once it is tipped over (its up axis
 * points less than 45° up). A box that lies on a corner is off by a little; the tolerance absorbs it.
 */
function lowestPointM(prop: Readonly<PropSlice>, halfExtentsM: readonly [number, number, number]) {
  const upY = 1 - 2 * (prop.qx * prop.qx + prop.qz * prop.qz);
  const [hx, hy, hz] = halfExtentsM;
  const halfM = upY < PROP_TIPPED_UP_Y_MAX ? Math.max(hx, hy, hz) : hy;
  return prop.yM - halfM;
}

/**
 * System: the props' physics. In order: (1) this step's `PushProp` commands; (2) every prop's pose
 * becomes its previous pose; (3) one Rapier step; (4) each awake prop's pose is read back into
 * `world.props` (a sleeping body has not moved: reading it would only allocate); (5) impacts, in
 * prop index order: `PropImpact` above `feel.physics.impactMinImpulseNs` (once per cooldown), then
 * `PropBroken` for a breakable prop hit hard enough; (6) `isOnFloor` and `world.mess`, recounted.
 * Allocates only for an event or for the pose of an awake body (Rapier's getters).
 */
export function runPhysics(world: World, ctx: StepContext): void {
  const { props } = world;
  if (props.length === 0) return;

  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command === undefined || command.type !== 'PushProp') continue;
    for (let j = 0; j < props.length; j++) {
      if ((props[j] as PropSlice).id !== command.propId) continue;
      pushProp(world, ctx, j, command.impulseXNs, command.impulseYNs, command.impulseZNs);
      break;
    }
  }

  for (let i = 0; i < props.length; i++) {
    const prop = props[i] as PropSlice;
    prop.prevXM = prop.xM;
    prop.prevYM = prop.yM;
    prop.prevZM = prop.zM;
    prop.prevQx = prop.qx;
    prop.prevQy = prop.qy;
    prop.prevQz = prop.qz;
    prop.prevQw = prop.qw;
  }

  ctx.physics.step();

  for (let i = 0; i < props.length; i++) {
    if (ctx.physics.isSleeping(i)) continue;
    ctx.physics.readPose(i, pose);
    const prop = props[i] as PropSlice;
    prop.xM = pose.xM;
    prop.yM = pose.yM;
    prop.zM = pose.zM;
    prop.qx = pose.qx;
    prop.qy = pose.qy;
    prop.qz = pose.qz;
    prop.qw = pose.qw;
  }

  activeWorld = world;
  activeCtx = ctx;
  ctx.physics.forEachImpact(onImpact);
  activeWorld = null;
  activeCtx = null;

  let onFloor = 0;
  let broken = 0;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i] as PropSlice;
    const spec = ctx.level.props[i];
    if (spec === undefined) continue;
    prop.isOnFloor = lowestPointM(prop, spec.halfExtentsM) <= PROP_ON_FLOOR_TOLERANCE_M;
    if (prop.isBroken) broken++;
    else if (prop.isOnFloor && spec.spawnedAboveFloor) onFloor++;
  }
  world.mess.propsOnFloor = onFloor;
  world.mess.propsBroken = broken;
}
