import type { ChoreStationKind } from '@content/schemas/chore';
import type { ObjectKind } from '@content/schemas/level';
import { asSimMs } from '@shared/time';
import { instinctWindowModifier } from '../assist/paternalInstinct.ts';
import type { StepContext } from '../context.ts';
import { fatigueWindowModifier } from '../gauges/fatigue.ts';
import { enterPapaState } from '../papa/papaFsm.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import { effectiveWindow } from '../timing/effectiveWindow.ts';
import type { ChoreInstance, World } from '../world.ts';
import { enterChoreState } from './choreFsm.ts';

/**
 * The object kinds that are chore stations (story 9.4), as the sim's own data: `createSim` refuses a
 * station nobody names with it (the sim imports no runtime from `@content`). A station kind of the
 * content that is not listed here does not compile.
 */
export const CHORE_STATION_OBJECT_KINDS = ['stove'] as const satisfies readonly ObjectKind[];

type UnlistedStationKind = Exclude<ChoreStationKind, (typeof CHORE_STATION_OBJECT_KINDS)[number]>;

/** Compile-time proof that every `CHORE_STATION_KINDS` of the content is listed above. */
export const CHORE_STATION_OBJECT_KINDS_ARE_COMPLETE: [UnlistedStationKind] extends [never]
  ? true
  : UnlistedStationKind = true;

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
 * resumes at the first beat not done. The beat is announced, or `held` when a threat's window is open.
 */
export function startChore(world: World, ctx: StepContext, objectId: string): boolean {
  const index = choreIndexOfObject(ctx, objectId);
  const chore = world.chores[index];
  if (chore === undefined || chore.state === 'done') return false;
  enterChoreState(world, chore, 'working');
  clearBeat(chore);
  enterPapaState(world, ctx, 'chore');
  if (isAnyThreatWindowOpen(world)) chore.beatState = 'held';
  else announceBeat(world, ctx, index);
  return true;
}
