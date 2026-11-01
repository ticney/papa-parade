import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { isBabyCarried } from '../baby/babyFsm.ts';
import { isBabyInReach, isInSafeZone, takeBaby } from '../baby/carry.ts';
import type { SimCycleEntry, StepContext } from '../context.ts';
import { createNavGrid, type NavGrid } from '../nav/navGrid.ts';
import { startWalkTo } from '../papa/planWalk.ts';
import type { World } from '../world.ts';
import { nearestOpenSafeZoneIndex } from './layDown.ts';
import { sequenceRefusal, startSequence } from './sequenceStart.ts';

// The bedtime cycle (story 4.10, FR40): a level's `cycle` chains its sequences. The sim starts each
// entry on a clock (D2), so the chain runs headless and replays from a journal with no new command.
// The end of an entry is `cycleEnd.ts`, which `sequenceEnd.ts` can import.

/** What {@link cycleProblems} reads of a level's `cycle` (a `Level['cycle']` fits it). */
export interface CycleShape {
  readonly entries: readonly { readonly sequence: string; readonly interludeMs: number }[];
}

/** What {@link cycleProblems} reads of a sequence def (a `SequenceDef` of the content fits it). */
export interface CycleDefShape {
  readonly success: { readonly kind: string };
  readonly steps: readonly {
    readonly kind: string;
    readonly durationMs: number;
    readonly exitAnchor?: string;
    readonly exitRadiusM?: number;
  }[];
}

/** A zone as a floor rectangle, for the checks on the boards. */
interface CycleZoneRect {
  readonly id: string;
  readonly centerXM: number;
  readonly centerZM: number;
  readonly halfXM: number;
  readonly halfZM: number;
}

/** What {@link cycleProblems} reads of the room: `simLevelOf` and `content:check` build it the same way. */
export interface CycleRoom {
  /** The centres of the safe zones that are open on Papa's grid. */
  readonly openSafeCentres: readonly { readonly xM: number; readonly zM: number }[];
  readonly creakZones: readonly CycleZoneRect[];
  /** The floor point of the anchor `id` of the geometry, or undefined. */
  anchorPointOf(id: string): { readonly xM: number; readonly zM: number } | undefined;
}

/** {@link CycleRoom} from a geometry and Papa's grid. Pure. */
export function cycleRoomOf(
  geometry: LevelGeometry,
  papaGrid: Pick<NavGrid, 'isOpenAt'>,
): CycleRoom {
  const rectOf = (zone: LevelGeometry['zones'][number]): CycleZoneRect => ({
    id: zone.id,
    centerXM: zone.centerM[0],
    centerZM: zone.centerM[2],
    halfXM: zone.halfExtentsM[0],
    halfZM: zone.halfExtentsM[2],
  });
  return {
    openSafeCentres: geometry.zones
      .filter((zone) => zone.kind === 'safe' && papaGrid.isOpenAt(zone.centerM[0], zone.centerM[2]))
      .map((zone) => ({ xM: zone.centerM[0], zM: zone.centerM[2] })),
    creakZones: geometry.zones.filter((zone) => zone.kind === 'creak').map(rectOf),
    anchorPointOf(id) {
      const anchor = geometry.anchors.find((candidate) => candidate.id === id);
      return anchor === undefined
        ? undefined
        : { xM: anchor.positionM[0], zM: anchor.positionM[2] };
    },
  };
}

/** {@link cycleRoomOf} building Papa's grid (`content:check` builds none of its own). */
export function cycleRoomForGeometry(geometry: LevelGeometry, papaRadiusM: number): CycleRoom {
  return cycleRoomOf(geometry, createNavGrid(geometry, papaRadiusM));
}

/** Whether the def's success is the baby in the crib, or it leaves from there: both need an open safe centre. */
function needsCrib(def: CycleDefShape): boolean {
  return def.success.kind === 'babyLaid' || def.steps.some((step) => step.kind === 'stealth');
}

/** Whether a board's rectangle reaches into the circle. Pure. */
function isZoneWithin(zone: CycleZoneRect, xM: number, zM: number, radiusM: number): boolean {
  const dx = Math.max(Math.abs(xM - zone.centerXM) - zone.halfXM, 0);
  const dz = Math.max(Math.abs(zM - zone.centerZM) - zone.halfZM, 0);
  return dx * dx + dz * dz < radiusM * radiusM;
}

/** What is wrong with a stealth step in this room: the guards story 4.9 left for this level. */
function stealthRoomProblems(
  id: string,
  step: CycleDefShape['steps'][number],
  room: CycleRoom,
): string[] {
  const { exitAnchor, exitRadiusM } = step;
  if (exitAnchor === undefined || exitRadiusM === undefined) return [];
  const exit = room.anchorPointOf(exitAnchor);
  if (exit === undefined) return []; // `sequenceStealthProblems` refuses it
  const problems: string[] = [];
  const within = (point: { readonly xM: number; readonly zM: number }): boolean => {
    const dx = point.xM - exit.xM;
    const dz = point.zM - exit.zM;
    return dx * dx + dz * dz <= exitRadiusM * exitRadiusM;
  };
  const spawn = room.anchorPointOf('papa_spawn');
  if (spawn !== undefined && within(spawn)) {
    problems.push(
      `the entry "${id}" exits within ${exitRadiusM} m of "${exitAnchor}", but Papa's spawn is already there (the sequence would win on its first step)`,
    );
  }
  if (room.openSafeCentres.some(within)) {
    problems.push(
      `the entry "${id}" exits within ${exitRadiusM} m of "${exitAnchor}", but a safe zone's centre is already there (the sequence would win on its first step)`,
    );
  }
  for (const board of room.creakZones) {
    if (isZoneWithin(board, exit.xM, exit.zM, exitRadiusM)) {
      problems.push(
        `the board "${board.id}" reaches into the exit radius of the entry "${id}" (${exitRadiusM} m of "${exitAnchor}")`,
      );
    }
  }
  return problems;
}

/**
 * What is wrong with a level's `cycle`, each as a sentence that follows « cycle: »: `simLevelOf` and
 * `content:check` both call it, so they refuse the same things with the same words. `listed` is the
 * level's `sequences`, `defs` the loaded defs by id, `room` what the room offers. Pure: no zod and no
 * `@content` runtime import.
 */
export function cycleProblems(
  cycle: CycleShape,
  listed: readonly string[],
  defs: Readonly<Record<string, CycleDefShape>>,
  durationMs: number,
  room: CycleRoom,
): string[] {
  const problems: string[] = [];
  if (cycle.entries.length === 0) problems.push('it has no entry');
  let neededMs = 0;
  const seen = new Set<string>();
  for (const { sequence: id, interludeMs } of cycle.entries) {
    neededMs += interludeMs;
    if (!listed.includes(id)) {
      problems.push(`the entry "${id}" is not listed in the level's sequences`);
    }
    if (seen.has(id)) problems.push(`the entry "${id}" is listed twice`);
    seen.add(id);
    const def = Object.hasOwn(defs, id) ? defs[id] : undefined;
    if (def === undefined) continue;
    for (const step of def.steps) neededMs += step.durationMs;
    if (needsCrib(def) && room.openSafeCentres.length === 0) {
      problems.push(
        `the entry "${id}" needs the crib, but the level has no safe zone with an open centre`,
      );
    }
    for (const step of def.steps) {
      if (step.kind === 'stealth') problems.push(...stealthRoomProblems(id, step, room));
    }
  }
  if (durationMs < neededMs) {
    problems.push(
      `the level lasts ${durationMs} ms, below the ${neededMs} ms of one clean cycle (every interlude and step)`,
    );
  }
  room.creakZones.forEach((board, i) => {
    for (const other of room.creakZones.slice(i + 1)) {
      if (
        Math.abs(board.centerXM - other.centerXM) < board.halfXM + other.halfXM &&
        Math.abs(board.centerZM - other.centerZM) < board.halfZM + other.halfZM
      ) {
        problems.push(`the boards "${board.id}" and "${other.id}" overlap`);
      }
    }
  });
  return problems;
}

/**
 * The gather (D3): true when something is left to do before `entry` can start, with what can be done
 * this step done. The baby first (taken within reach, else walked to), then the crib (walked to,
 * `intent: 'none'`, or the walk would put the baby down). `startWalkTo` failing (it should not) falls
 * through to the start: nothing may hold the cycle up.
 */
function gather(world: World, ctx: StepContext, entry: SimCycleEntry): boolean {
  const { baby, papa } = world;
  if (entry.def.babyCarried && !isBabyCarried(world)) {
    if (isBabyInReach(world, ctx)) {
      takeBaby(world, ctx);
      return true;
    }
    if (startWalkTo(world, ctx, baby.xM, baby.zM) === null) return false;
    papa.intent = 'takeBaby';
    return true;
  }
  if (needsCrib(entry.def) && !isInSafeZone(ctx, papa.xM, papa.zM)) {
    const zone = ctx.level.safeZones[nearestOpenSafeZoneIndex(world, ctx)];
    if (zone === undefined) return false;
    return startWalkTo(world, ctx, zone.centerXM, zone.centerZM) !== null;
  }
  return false;
}

/**
 * The bedtime cycle's clock (`runSequence` calls it right after the `StartSequence` loop). A no-op with
 * no cycle, outside `playing`, once the cycle is done, and until the entry is due. Then it waits while
 * {@link sequenceRefusal} says no, and leaves a walking or gliding Papa alone until he is idle: the sim
 * never cuts across a command of the player. An idle Papa is gathered (D3), and the sequence starts in
 * the step after there is nothing left to gather. At `nextAt + gatherMaxMs` the sequence starts at once,
 * with its own placements, so that nothing can hold the cycle up. No draw but `takeBaby`'s.
 */
export function runCycle(world: World, ctx: StepContext): void {
  const planned = ctx.level.cycle;
  if (planned === null || world.flow.state !== 'playing') return;
  const { nextAt, index } = world.cycle;
  const now = world.time.sim;
  if (nextAt === null || now < nextAt) return;
  const entry = planned.entries[index];
  if (entry === undefined || sequenceRefusal(world) !== null) return;
  if (now < nextAt + planned.gatherMaxMs) {
    if (world.papa.state !== 'idle') return;
    if (gather(world, ctx, entry)) return;
  }
  startSequence(world, ctx, entry.sequenceId);
}
