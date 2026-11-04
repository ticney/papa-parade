import type { ThreatDef } from '@content/schemas/threat';
import { asSimMs } from '@shared/time';
import { stopCrawling } from '../baby/approach.ts';
import { enterBabyState } from '../baby/babyFsm.ts';
import type { StepContext } from '../context.ts';
import type { AfterEffectKind } from '../events.ts';
import { finishCoffee } from '../papa/coffee.ts';
import { enterPapaState, isAfterEffectState, isPapaBusy } from '../papa/papaFsm.ts';
import { tidyProp } from '../papa/tidyProp.ts';
import { finishToilet } from '../papa/toilet.ts';
import type { PapaSlice, World } from '../world.ts';
import type { GagId } from './gags.ts';

// The séquelles of the gags (story 3.15, FR72, GDD mechanic 13). A gag is a one-shot (`applyGag`);
// what it leaves behind lives here, driven by the `afterEffect` of the threat's def. Three of them
// occupy Papa (`electrified`, `carryingUp`, `asleep`): they never stack, a new one replaces the one
// under way without extending it (D2). The others are décor and always stack: the pénombre
// (`world.afterEffects.dimUntil`), a debris on the floor (`PropSlice.debrisPickUpMs`) and the marks of a
// silence's mischief. `runAfterEffects` is called by `runThreats`: séquelles are inside the threats
// system (architecture L233), not a system of their own.

/** The states `occupyPapa` can put Papa in: the séquelles that need nothing but Papa. */
type OccupyingState = 'electrified' | 'asleep';

/** The event kind of each state that occupies Papa. */
const KIND_OF_STATE: Readonly<Record<'electrified' | 'carryingUp' | 'asleep', AfterEffectKind>> = {
  electrified: 'electrified',
  carryingUp: 'carryUp',
  asleep: 'asleep',
};

/** Papa drops his path, his glide, his direction, the object he walked to and his intent: he is about to be busy. */
function dropPapaMotion(papa: PapaSlice): void {
  papa.path.length = 0;
  papa.pathIndex = 0;
  papa.glide = null;
  papa.dirX = 0;
  papa.dirZ = 0;
  papa.isBlocked = false;
  papa.objectId = null;
  papa.intent = 'none';
}

/** The index in `world.props` of the debris `propId` (marked, and still a mess to pick up), else -1. */
export function debrisIndexOf(world: World, propId: string): number {
  const { props } = world;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (prop !== undefined && prop.id === propId) {
      return prop.debrisPickUpMs > 0 && prop.isMess ? i : -1;
    }
  }
  return -1;
}

/** The `babyDownstairs` def of the level (its `carryUpMs`), else undefined. A level has one stairs. */
function downstairsDefOf(
  ctx: StepContext,
): Extract<ThreatDef['afterEffect'], { kind: 'babyDownstairs' }> | undefined {
  for (let i = 0; i < ctx.level.threats.length; i++) {
    const effect = ctx.level.threats[i]?.def.afterEffect;
    if (effect !== undefined && effect.kind === 'babyDownstairs') return effect;
  }
  return undefined;
}

/** The baby is carried back up: back at the stairs' anchor (where he sat), babbling for the shortest pause, no draw. */
function releaseCarriedUpBaby(world: World, ctx: StepContext): void {
  const { baby } = world;
  baby.babbling = true;
  baby.wanderAt = asSimMs(world.time.sim + ctx.feel.baby.babbleMinMs);
  enterBabyState(world, ctx, 'babble');
}

/** `carryingUp` is over: the baby is back, `AfterEffectEnded{carryUp}`, Papa is idle. */
function finishCarryUp(world: World, ctx: StepContext): void {
  releaseCarriedUpBaby(world, ctx);
  world.papa.busyUntil = asSimMs(0);
  ctx.events.push({ type: 'AfterEffectEnded', t: world.time.sim, kind: 'carryUp', propId: null });
  enterPapaState(world, ctx, 'idle');
}

/** The pick-up is over: the debris is tidied (`PropTidied`, `AfterEffectEnded{debris}`) unless it is gone already; Papa is idle. */
function finishPickUp(world: World, ctx: StepContext): void {
  const { papa } = world;
  const propId = papa.objectId;
  papa.objectId = null;
  papa.busyUntil = asSimMs(0);
  if (propId !== null) {
    const index = debrisIndexOf(world, propId);
    if (index >= 0) tidyProp(world, ctx, index);
  }
  enterPapaState(world, ctx, 'idle');
}

/**
 * The end of Papa's busy time, at the step `busyUntil` is reached (`runPapa`'s branch, and
 * `occupyPapa` for one that ends in the very step a séquelle lands, because `runThreats` runs
 * first): a coffee and a toilet visit have something to finish, so has a carry (the baby goes back
 * up) and a pick-up (the debris is tidied); an `electrified` or `asleep` Papa says his séquelle is
 * over; the others go back to idle.
 */
export function finishPapaBusy(world: World, ctx: StepContext): void {
  const { papa } = world;
  switch (papa.state) {
    case 'drink':
      finishCoffee(world, ctx);
      return;
    case 'onToilet':
      finishToilet(world, ctx);
      return;
    case 'carryingUp':
      finishCarryUp(world, ctx);
      return;
    case 'pickingUp':
      finishPickUp(world, ctx);
      return;
    case 'electrified':
    case 'asleep':
      ctx.events.push({
        type: 'AfterEffectEnded',
        t: world.time.sim,
        kind: KIND_OF_STATE[papa.state],
        propId: null,
      });
      break;
    default:
      break;
  }
  papa.busyUntil = asSimMs(0);
  enterPapaState(world, ctx, 'idle');
}

/**
 * Papa begins a chosen busy occupation that is not a séquelle (`pickingUp`, a pick-up of a debris,
 * and the walk's `carryingUp` below): he drops his path, and answers nothing until `busyUntil`.
 */
function beginBusy(
  world: World,
  ctx: StepContext,
  state: 'pickingUp' | 'carryingUp' | OccupyingState,
  busyMs: number,
): void {
  const { papa } = world;
  dropPapaMotion(papa);
  papa.busyUntil = asSimMs(world.time.sim + busyMs);
  enterPapaState(world, ctx, state);
}

/**
 * A séquelle that occupies Papa lands (D2). Whatever chosen occupation he was in is cancelled
 * (a coffee, a call, a toilet visit, a pick-up) unless it ends this very step, in which case it is
 * finished first (`runThreats` runs before `runPapa`, which has not recorded the end yet). Then:
 * - Papa is under a séquelle of the same state: nothing changes (the ring does not refill);
 * - under another: the new one **replaces** it without extending it, `busyUntil` keeps its value,
 *   `AfterEffectEnded{old}` then `AfterEffectStarted{new, until: busyUntil}` (a replaced carry
 *   puts the baby back up first);
 * - otherwise he is busy for `busyMs`, `AfterEffectStarted`.
 */
export function occupyPapa(
  world: World,
  ctx: StepContext,
  state: OccupyingState,
  busyMs: number,
): void {
  const { papa } = world;
  if (isPapaBusy(papa) && world.time.sim >= papa.busyUntil) finishPapaBusy(world, ctx);
  if (isAfterEffectState(papa.state)) {
    if (papa.state === state) return;
    const old = papa.state as 'electrified' | 'carryingUp' | 'asleep';
    if (old === 'carryingUp') releaseCarriedUpBaby(world, ctx);
    ctx.events.push({
      type: 'AfterEffectEnded',
      t: world.time.sim,
      kind: KIND_OF_STATE[old],
      propId: null,
    });
    enterPapaState(world, ctx, state);
  } else {
    beginBusy(world, ctx, state, busyMs);
  }
  ctx.events.push({
    type: 'AfterEffectStarted',
    t: world.time.sim,
    kind: KIND_OF_STATE[state],
    until: papa.busyUntil,
    propId: null,
  });
}

/**
 * Papa picks the debris `propIndex` up (story 3.15): a chosen occupation of `debrisPickUpMs`, remembered
 * by `papa.objectId` until `finishPickUp` tidies it. Not a séquelle: no event of its own.
 */
export function startPickUp(world: World, ctx: StepContext, propIndex: number): void {
  const prop = world.props[propIndex];
  if (prop === undefined) return;
  const { papa } = world;
  dropPapaMotion(papa);
  papa.busyUntil = asSimMs(world.time.sim + prop.debrisPickUpMs);
  papa.objectId = prop.id;
  enterPapaState(world, ctx, 'pickingUp');
}

/**
 * Papa fetches the baby left at the bottom of the stairs (D4): he carries him up for the def's
 * `carryUpMs`. The baby is `carriedUp`, no longer waiting (`AfterEffectEnded{babyDownstairs}`), and
 * the carry is the second half of the séquelle (`AfterEffectStarted{carryUp}`). Does nothing if the
 * baby is no longer `downstairs` (he climbed back while Papa walked).
 */
export function startCarryUp(world: World, ctx: StepContext): void {
  const { baby } = world;
  const def = downstairsDefOf(ctx);
  if (baby.state !== 'downstairs' || def === undefined) return;
  beginBusy(world, ctx, 'carryingUp', def.carryUpMs);
  baby.downstairsUntil = null;
  enterBabyState(world, ctx, 'carriedUp');
  const now = world.time.sim;
  ctx.events.push(
    { type: 'AfterEffectEnded', t: now, kind: 'babyDownstairs', propId: null },
    {
      type: 'AfterEffectStarted',
      t: now,
      kind: 'carryUp',
      until: world.papa.busyUntil,
      propId: null,
    },
  );
}

/** Marks the props the table's gag pushed as debris (`debrisPickUpMs`), one `AfterEffectStarted{debris}` each. */
export function markDebris(
  world: World,
  ctx: StepContext,
  propIndices: readonly number[],
  pickUpMs: number,
): void {
  for (let i = 0; i < propIndices.length; i++) {
    const prop = world.props[propIndices[i] as number];
    if (prop === undefined) continue;
    prop.debrisPickUpMs = pickUpMs;
    ctx.events.push({
      type: 'AfterEffectStarted',
      t: world.time.sim,
      kind: 'debris',
      until: null,
      propId: prop.id,
    });
  }
}

/**
 * Applies the séquelle of `def` for the gag that just fired (`gagThreat`, right after `applyGag`).
 * `debris` is placed by the table's gag itself (`markDebris`: only it knows which prop it pushed);
 * `none` leaves nothing.
 */
export function applyAfterEffect(world: World, ctx: StepContext, def: ThreatDef, gag: GagId): void {
  const effect = def.afterEffect;
  const now = world.time.sim;
  switch (effect.kind) {
    case 'none':
    case 'debris':
      return;
    case 'electrified': {
      occupyPapa(world, ctx, 'electrified', effect.busyMs);
      const { afterEffects } = world;
      afterEffects.dimUntil = asSimMs(Math.max(afterEffects.dimUntil, now + effect.dimMs));
      ctx.events.push({
        type: 'AfterEffectStarted',
        t: now,
        kind: 'dim',
        until: afterEffects.dimUntil,
        propId: null,
      });
      return;
    }
    case 'babyDownstairs': {
      const { baby } = world;
      // A baby in Papa's arms or hiding cannot be sent down; one already down stays as he is.
      if (
        baby.state === 'carried' ||
        baby.state === 'mischiefSilent' ||
        baby.state === 'downstairs' ||
        baby.state === 'carriedUp'
      ) {
        return;
      }
      baby.targetThreatId = null;
      stopCrawling(world);
      baby.downstairsUntil = asSimMs(now + effect.selfReturnMs);
      enterBabyState(world, ctx, 'downstairs');
      ctx.events.push({
        type: 'AfterEffectStarted',
        t: now,
        kind: 'babyDownstairs',
        until: baby.downstairsUntil,
        propId: null,
      });
      return;
    }
    case 'mess':
      world.afterEffects.mischiefMarks.push({ gag, xM: world.baby.xM, zM: world.baby.zM });
      ctx.events.push({
        type: 'AfterEffectStarted',
        t: now,
        kind: 'mess',
        until: null,
        propId: null,
      });
      return;
    case 'asleep':
      occupyPapa(world, ctx, 'asleep', effect.busyMs);
      return;
  }
}

/** The débris Papa stands within `debrisStepRadiusM` of (the first, by index), or -1. */
function debrisUnderPapa(world: World, ctx: StepContext): number {
  const { papa, props } = world;
  const radiusM = ctx.feel.gags.debrisStepRadiusM;
  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (prop === undefined || prop.debrisPickUpMs <= 0 || !prop.isMess) continue;
    const dx = prop.xM - papa.xM;
    const dz = prop.zM - papa.zM;
    if (dx * dx + dz * dz <= radiusM * radiusM) return i;
  }
  return -1;
}

/**
 * The séquelles that end or are noticed on their own, once per step at the end of `runThreats`, in
 * this order: the pénombre ends (`AfterEffectEnded{dim}`, `dimUntil` back to 0); the baby left
 * downstairs climbs back by himself at `downstairsUntil`; a debris whose prop broke is no debris any
 * more; Papa coming within `debrisStepRadiusM` of a debris is a step on it, once per entry (not the
 * one he walks to pick up). Allocates only events.
 */
export function runAfterEffects(world: World, ctx: StepContext): void {
  const now = world.time.sim;
  const { afterEffects, baby, papa, props } = world;

  if (afterEffects.dimUntil > 0 && now >= afterEffects.dimUntil) {
    afterEffects.dimUntil = asSimMs(0);
    ctx.events.push({ type: 'AfterEffectEnded', t: now, kind: 'dim', propId: null });
  }

  if (baby.state === 'downstairs' && baby.downstairsUntil !== null && now >= baby.downstairsUntil) {
    baby.downstairsUntil = null;
    releaseCarriedUpBaby(world, ctx);
    ctx.events.push({ type: 'AfterEffectEnded', t: now, kind: 'babyDownstairs', propId: null });
  }

  for (let i = 0; i < props.length; i++) {
    const prop = props[i];
    if (prop === undefined || prop.debrisPickUpMs <= 0 || !prop.isBroken) continue;
    prop.debrisPickUpMs = 0;
    // Papa was walking to it: nothing to pick up any more (a pick-up under way is finished by `finishPickUp`, which tidies nothing).
    if (papa.objectId === prop.id && papa.state === 'walkPath') papa.objectId = null;
    ctx.events.push({ type: 'AfterEffectEnded', t: now, kind: 'debris', propId: prop.id });
  }

  const under = debrisUnderPapa(world, ctx);
  if (under !== afterEffects.steppedDebrisIndex) {
    afterEffects.steppedDebrisIndex = under;
    const prop = under >= 0 ? props[under] : undefined;
    if (prop !== undefined && prop.id !== papa.objectId) {
      ctx.events.push({ type: 'DebrisSteppedOn', t: now, propId: prop.id });
    }
  }
}
