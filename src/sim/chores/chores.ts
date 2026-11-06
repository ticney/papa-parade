import type { ChoreStationKind } from '@content/schemas/chore';
import type { ObjectKind } from '@content/schemas/level';
import { asSimMs } from '@shared/time';
import { instinctWindowModifier } from '../assist/paternalInstinct.ts';
import { isBabyCarried } from '../baby/babyFsm.ts';
import type { StepContext } from '../context.ts';
import { fatigueWindowModifier } from '../gauges/fatigue.ts';
import { enterPapaState } from '../papa/papaFsm.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import { effectiveWindow } from '../timing/effectiveWindow.ts';
import type { ChoreInstance, ThreatInstance, World } from '../world.ts';
import { enterChoreState } from './choreFsm.ts';

/**
 * The object kinds that are chore stations (story 9.4), as the sim's own data: `createSim` refuses a
 * station nobody names with it (the sim imports no runtime from `@content`). A station kind of the
 * content that is not listed here does not compile.
 */
export const CHORE_STATION_OBJECT_KINDS = [
  'stove',
  'dishwasher',
] as const satisfies readonly ObjectKind[];

type UnlistedStationKind = Exclude<ChoreStationKind, (typeof CHORE_STATION_OBJECT_KINDS)[number]>;

/** Compile-time proof that every `CHORE_STATION_KINDS` of the content is listed above. */
export const CHORE_STATION_OBJECT_KINDS_ARE_COMPLETE: [UnlistedStationKind] extends [never]
  ? true
  : UnlistedStationKind = true;

/**
 * Why a level does not plan a chore's open-door threat the way it must (story 9.6), or null when it
 * does: the level plans that def in one of its waves **exactly once** (`plannedCount`). `simLevelOf` and
 * `content:check` both call it, so they refuse it with the same words. Pure.
 */
export function openThreatPlanProblem(
  choreDefId: string,
  threatDefId: string,
  plannedCount: number,
): string | null {
  if (plannedCount === 1) return null;
  return `the chore "${choreDefId}" names the open threat "${threatDefId}", which the level must plan in one of its waves exactly once, but plans it ${plannedCount} times`;
}

/**
 * Why the wave entry of a chore's open-door threat stands in the wrong place (story 9.6), or null: it is
 * planned at the anchor of the chore's station, or the door would be a target away from the dishwasher.
 */
export function openThreatAnchorProblem(
  choreDefId: string,
  threatDefId: string,
  plannedAnchor: string,
  stationAnchor: string,
): string | null {
  if (plannedAnchor === stationAnchor) return null;
  return `the threat "${threatDefId}" is the open threat of the chore "${choreDefId}": it must be planned at the anchor of the chore's station ("${stationAnchor}"), not at "${plannedAnchor}"`;
}

/**
 * Why a wave plans the open-door threat of a chore that the level does not declare (story 9.6): alone, the
 * door would be a target of the baby that nothing ever opens or shuts. `content:check` only: the sim sees
 * the chores of its own level, not the other chore files.
 */
export function openThreatOrphanProblem(threatDefId: string, choreDefId: string): string {
  return `the threat "${threatDefId}" is the open threat of the chore "${choreDefId}", which the level does not declare`;
}

/** The index, in `world.chores` and `ctx.level.chores`, of the chore whose station is this object, or -1. */
export function choreIndexOfObject(ctx: StepContext, objectId: string): number {
  const { chores } = ctx.level;
  for (let i = 0; i < chores.length; i++) {
    if (chores[i]?.objectId === objectId) return i;
  }
  return -1;
}

/**
 * When the beat's window closes for good, in sim time: its opening, its length and the tolerance. A
 * tap after it (plus `world.input.lagMs`, which the sim waits before concluding that nobody tapped)
 * is a miss. The client and the bots read the end of the beat from this.
 */
export function choreBeatCloseAt(chore: Readonly<ChoreInstance>): number {
  return chore.beatWindowOpenAt + chore.responseWindow.windowMs + chore.responseWindow.toleranceMs;
}

/** Whether any threat's window is open now: a chore's beat gives way to it (story 9.4 D7). */
export function isAnyThreatWindowOpen(world: World): boolean {
  const { threats } = world;
  for (let i = 0; i < threats.length; i++) {
    if (threats[i]?.state === 'windowOpen') return true;
  }
  return false;
}

/**
 * The instance of the pot of the chore at `choreIndex` (story 9.5), or undefined for a chore with no
 * `abandonedThreat`. Its index is `SimPlannedChore.abandoned.threatIndex`.
 */
export function potOf(
  world: World,
  ctx: StepContext,
  choreIndex: number,
): ThreatInstance | undefined {
  const abandoned = ctx.level.chores[choreIndex]?.abandoned;
  return abandoned == null ? undefined : world.threats[abandoned.threatIndex];
}

/** Whether the chore's own pot is on the fire: telegraphed or its window open (story 9.5 D6). */
export function isPotActive(world: World, ctx: StepContext, choreIndex: number): boolean {
  const pot = potOf(world, ctx, choreIndex);
  return pot !== undefined && (pot.state === 'telegraph' || pot.state === 'windowOpen');
}

/**
 * The instance of the open-door threat of the chore at `choreIndex` (story 9.6), or undefined for a chore
 * with no `openThreat`. Its index is `SimPlannedChore.openThreatIndex`.
 */
export function openThreatOf(
  world: World,
  ctx: StepContext,
  choreIndex: number,
): ThreatInstance | undefined {
  const index = ctx.level.chores[choreIndex]?.openThreatIndex ?? null;
  return index === null ? undefined : world.threats[index];
}

/** Whether the baby is heading for the chore's open door: its threat is telegraphed or its window open (story 9.6 AC 9). */
export function isOpenThreatActive(world: World, ctx: StepContext, choreIndex: number): boolean {
  const threat = openThreatOf(world, ctx, choreIndex);
  return threat !== undefined && (threat.state === 'telegraph' || threat.state === 'windowOpen');
}

/**
 * Whether a threat of the chore's own holds its beat: the pot on the fire (story 9.5) or the baby on his
 * way to the open door (story 9.6). The dishwasher cannot be emptied, nor its door closed by the last
 * beat, with the baby heading for it.
 */
export function isChoreThreatActive(world: World, ctx: StepContext, choreIndex: number): boolean {
  return isPotActive(world, ctx, choreIndex) || isOpenThreatActive(world, ctx, choreIndex);
}

/**
 * Papa's glide to the threat `threatId` has ended (story 9.5, review): if it was a chore's own pot and
 * that chore is `paused`, he has lowered the heat at its station, so he goes back to it (`startChore`;
 * the beat stays held while the pot is still on). Not with the baby in his arms (the station refuses
 * him, 9.4 D10) nor in a sequence. True when he works there now.
 */
export function resumeChoreOfPot(world: World, ctx: StepContext, threatId: number): boolean {
  if (world.flow.state === 'sequence' || isBabyCarried(world)) return false;
  const { chores } = ctx.level;
  for (let i = 0; i < chores.length; i++) {
    const planned = chores[i] as StepContext['level']['chores'][number];
    if (planned.abandoned === null || potOf(world, ctx, i)?.id !== threatId) continue;
    const state = world.chores[i]?.state;
    if (state === 'working') {
      // A press from the stove itself: the glide was empty and ended in the step that started it,
      // before `settleChores` could pause the chore. Papa simply keeps working.
      enterPapaState(world, ctx, 'chore');
      return true;
    }
    if (state !== 'paused') return false;
    return startChore(world, ctx, planned.objectId);
  }
  return false;
}

/** The chore stops: its beats done are kept, the announced beat is dropped without a judgement. */
export function pauseChore(world: World, chore: ChoreInstance): void {
  enterChoreState(world, chore, 'paused');
  clearBeat(chore);
}

/** The beat is no more: nothing announced, nothing to draw. */
export function clearBeat(chore: ChoreInstance): void {
  chore.beatState = 'none';
  chore.beatTelegraphAt = asSimMs(0);
  chore.beatWindowOpenAt = asSimMs(0);
  chore.responseWindow.windowMs = 0;
  chore.responseWindow.perfectMs = 0;
  chore.responseWindow.toleranceMs = 0;
  chore.responseWindow.bufferMs = 0;
}

/**
 * Announces the chore's next beat (`beatsDone`): `telegraph` now, its window `telegraphDelayMs`
 * later. The window is frozen here, with the tier, the fatigue and the instinct of the moment (the
 * threats' rule, `telegraphThreat`): a window that moves while it is read would be unfair.
 */
export function announceBeat(world: World, ctx: StepContext, choreIndex: number): void {
  const chore = world.chores[choreIndex] as ChoreInstance;
  const { def } = ctx.level.chores[choreIndex] as StepContext['level']['chores'][number];
  const beat = def.beats[chore.beatsDone];
  if (beat === undefined) return;
  const { timing } = ctx.feel;
  const now = world.time.sim;
  chore.responseWindow = effectiveWindow(timing, def.windowMs ?? timing.windowMs, {
    tier: activeDifficulty(world, ctx).windowMultiplier,
    fatigue: fatigueWindowModifier(world, ctx),
    instinct: instinctWindowModifier(world, ctx),
  });
  chore.beatTelegraphAt = now;
  chore.beatWindowOpenAt = asSimMs(now + beat.telegraphDelayMs);
  chore.beatState = 'telegraph';
  ctx.events.push({
    type: 'ChoreBeatTelegraphed',
    t: now,
    choreIndex,
    beatIndex: chore.beatsDone,
    windowOpenAt: chore.beatWindowOpenAt,
  });
}

/**
 * Papa arrived at a chore's station (`OBJECT_ACTIONS`): he works there. Returns true when he
 * did, false when the chore is done (he is only standing at the stove, idle). A `paused` chore
 * resumes at the first beat not done. The beat is announced, or `held` when a threat's window is open or
 * a threat of the chore's own is on (the pot, story 9.5; the baby heading for the open door, story 9.6).
 *
 * Any other chore Papa was working at is paused first (story 9.6, 9.4's deferred « two chores `working`
 * at once »): a glide from one station to the next can end in the step it starts, before `settleChores`
 * has paused the first. A chore with an `openThreat` opens its door here: Papa opens the dishwasher, or
 * reopens it to resume.
 */
export function startChore(world: World, ctx: StepContext, objectId: string): boolean {
  const index = choreIndexOfObject(ctx, objectId);
  const chore = world.chores[index];
  if (chore === undefined || chore.state === 'done') return false;
  for (let i = 0; i < world.chores.length; i++) {
    const other = world.chores[i] as ChoreInstance;
    if (i !== index && other.state === 'working') pauseChore(world, other);
  }
  enterChoreState(world, chore, 'working');
  clearBeat(chore);
  const planned = ctx.level.chores[index] as StepContext['level']['chores'][number];
  if (planned.openThreatIndex !== null) chore.isOpen = true;
  enterPapaState(world, ctx, 'chore');
  if (isAnyThreatWindowOpen(world) || isChoreThreatActive(world, ctx, index)) {
    chore.beatState = 'held';
  } else {
    announceBeat(world, ctx, index);
  }
  return true;
}
