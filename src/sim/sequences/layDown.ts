import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { isBabyCarried } from '../baby/babyFsm.ts';
import { isInSafeZone } from '../baby/carry.ts';
import type { StepContext } from '../context.ts';
import { createNavGrid, type NavGrid } from '../nav/navGrid.ts';
import type { World } from '../world.ts';
import { sequenceDefOf } from './sequenceEnd.ts';

// « Dépose-bombe » (story 4.8): a sequence whose success is `babyLaid` starts with Papa standing over
// the mattress and ends with the baby put down. This file owns the start (the placement) and the
// words of the level checks that `simLevelOf` and `content:check` share.

/** What {@link sequenceLayProblems} reads of a sequence def (a `SequenceDef` of the content fits it). */
export interface LayDefShape {
  readonly success: { readonly kind: string };
}

/**
 * What is wrong with a `babyLaid` sequence on a level, each as a sentence that follows « the
 * sequence "<id>" »: `simLevelOf` and `content:check` both call it, so they refuse the same things
 * with the same words. `hasCarry` is whether the level lets Papa carry the baby; `openCentreCount`
 * is how many of its safe zones have their centre on an open cell of Papa's grid (the placement goes
 * to the nearest of those). Pure: no zod and no `@content` runtime import.
 */
export function sequenceLayProblems(
  def: LayDefShape,
  hasCarry: boolean,
  openCentreCount: number,
): string[] {
  if (def.success.kind !== 'babyLaid') return [];
  const problems: string[] = [];
  if (!hasCarry) {
    problems.push('has a "babyLaid" success, but the level has no carry (no baby to lay down)');
  } else if (openCentreCount === 0) {
    problems.push(
      'has a "babyLaid" success, but every safe zone of the level has its centre on a closed cell (nowhere to place Papa over the mattress)',
    );
  }
  return problems;
}

/** How many of `zones` have their centre on an open cell of `grid` (Papa's). Pure. */
export function openCentreCountOf(
  zones: readonly { readonly centerXM: number; readonly centerZM: number }[],
  grid: Pick<NavGrid, 'isOpenAt'>,
): number {
  let count = 0;
  for (const zone of zones) if (grid.isOpenAt(zone.centerXM, zone.centerZM)) count += 1;
  return count;
}

/**
 * {@link openCentreCountOf} for a level's geometry, building Papa's grid (`content:check` builds none
 * of its own): the `safe` zones of `geometry` against a grid eroded by `papaRadiusM`.
 */
export function openSafeCentreCountOf(geometry: LevelGeometry, papaRadiusM: number): number {
  const zones = geometry.zones
    .filter((zone) => zone.kind === 'safe')
    .map((zone) => ({ centerXM: zone.centerM[0], centerZM: zone.centerM[2] }));
  return openCentreCountOf(zones, createNavGrid(geometry, papaRadiusM));
}

/**
 * The index, in `ctx.level.safeZones`, of the safe zone nearest Papa whose centre is open on his grid
 * (squared distances, a tie goes to the first listed), or -1 when none is. Pure; no allocation.
 */
export function nearestOpenSafeZoneIndex(world: World, ctx: StepContext): number {
  const { papa } = world;
  const { safeZones } = ctx.level;
  const grid = ctx.nav.papa;
  let best = -1;
  let bestSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < safeZones.length; i++) {
    const zone = safeZones[i];
    if (zone === undefined || !grid.isOpenAt(zone.centerXM, zone.centerZM)) continue;
    const dx = zone.centerXM - papa.xM;
    const dz = zone.centerZM - papa.zM;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestSq) {
      bestSq = distanceSq;
      best = i;
    }
  }
  return best;
}

/**
 * Puts Papa's point at the centre of the nearest safe zone whose centre is open on his grid. A no-op
 * when he already stands in a safe zone, or when no zone has an open centre (the level checks refuse
 * that level). No event, no draw, no allocation. `startSequence` calls it after `stopPapa` and before
 * `takeBaby`, so the baby is taken at the mattress.
 */
export function placePapaOverMattress(world: World, ctx: StepContext): void {
  const { papa } = world;
  if (isInSafeZone(ctx, papa.xM, papa.zM)) return;
  const target = ctx.level.safeZones[nearestOpenSafeZoneIndex(world, ctx)];
  if (target === undefined) return;
  papa.xM = target.centerXM;
  papa.zM = target.centerZM;
  // The jump is not a walk: the view must not slide Papa across the room between two steps.
  papa.prevXM = papa.xM;
  papa.prevZM = papa.zM;
}

/**
 * Whether a `babyLaid` sequence was won in this very step, so that the baby is to be put down
 * (`runPapa` calls `putDownBaby` then, story 4.8). `carry.ts` imports `threatFsm`, which imports
 * `sequenceEnd`, so the end of the sequence cannot call `putDownBaby` itself (a cycle): it leaves
 * the mark that this reads. The sequence ended now, its success is `babyLaid`, the baby is still in
 * the arms, and this step's `SequenceEnded` says `succeeded` (scanned from the end of `ctx.events`
 * while `t === now`, as `runNoise` does: `ctx.events` is drained by the caller, not per step). A
 * failed sequence never puts him down. Allocation-free.
 */
export function isBabyJustLaid(world: World, ctx: StepContext): boolean {
  const { sequence } = world;
  const now = world.time.sim;
  if (sequence.endedAt !== now || !isBabyCarried(world)) return false;
  if (sequenceDefOf(ctx, sequence.lastId)?.success.kind !== 'babyLaid') return false;
  for (let i = ctx.events.length - 1; i >= 0; i--) {
    const event = ctx.events[i];
    if (event === undefined || event.t !== now) break;
    if (event.type === 'SequenceEnded') return event.outcome === 'succeeded';
  }
  return false;
}
