import { NEUTRAL_WINDOW_MODIFIER } from '@shared/constants';
import { asSimMs, type SimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { isThreatActive } from '../director/waveState.ts';
import type { InstinctEndReason } from '../events.ts';
import { startSlowMo } from '../time/slowMo.ts';
import { activeDifficulty } from '../timing/difficulty.ts';
import type { InstinctState, ThreatInstance, World } from '../world.ts';

/**
 * The only writer of `world.instinct.state`, `enteredAt` and `untilAt`. It emits nothing: the
 * helpers below do, each with the data its transition owns.
 */
export function enterInstinctState(world: World, next: InstinctState, untilAt: SimMs): void {
  const { instinct } = world;
  instinct.state = next;
  instinct.enteredAt = world.time.sim;
  instinct.untilAt = untilAt;
}

/**
 * Notes a miss, i.e. a `ResponseResolved{fail}`: called by `gagThreat`, the single exit of every
 * failure (a timed-out silence and a failed micro-sleep included), beside `resetCombo`. Written at
 * the source like `world.score.perfects`, so `runInstinct` never scans `ctx.events`. It keeps the
 * last `feel.instinct.missesCount` of them, in every state and at every tier (a player who
 * switches tier, or an instinct that recharges, loses nothing); the list grows in place. The ones
 * made during the instinct do not outlive it: {@link finishInstinct} empties the list.
 */
export function recordMiss(world: World, ctx: StepContext): void {
  const { missAts } = world.instinct;
  missAts.push(world.time.sim);
  while (missAts.length > ctx.feel.instinct.missesCount) missAts.shift();
}

/**
 * The instinct factor of {@link effectiveWindow}: `1 + windowBonusPct / 100` while the instinct is
 * active, nothing otherwise. Read by `telegraphThreat` (the window is frozen there, so one
 * already up keeps its length when the instinct starts or ends) and by `isJudgeableBeforeEnd`.
 * The director and the threats run before `runInstinct`, so the state is still `active` in the step
 * that ends it: the end instant (`untilAt`) is already outside, as `InstinctEnded` says.
 */
export function instinctWindowModifier(world: World, ctx: StepContext): number {
  return world.instinct.state === 'active' && world.time.sim < world.instinct.untilAt
    ? 1 + ctx.feel.instinct.windowBonusPct / 100
    : NEUTRAL_WINDOW_MODIFIER;
}

/** How many threats are announced, open for a response or hidden: a counting loop, no `filter`. */
function activeThreatCount(threats: readonly ThreatInstance[]): number {
  let count = 0;
  for (let i = 0; i < threats.length; i++) {
    if (isThreatActive(threats[i] as ThreatInstance)) count++;
  }
  return count;
}

/**
 * Whether the trigger holds now: enough active threats, and the last `missesCount` misses all fall
 * within `missesWithinMs` (strictly: « en moins de 10 s »). The tier is read by the caller.
 */
function isTriggerMet(world: World, ctx: StepContext): boolean {
  const feel = ctx.feel.instinct;
  const { missAts } = world.instinct;
  if (missAts.length < feel.missesCount) return false;
  const oldest = missAts[missAts.length - feel.missesCount] as SimMs;
  if (world.time.sim - oldest >= feel.missesWithinMs) return false;
  return activeThreatCount(world.threats) >= feel.minActiveThreatsCount;
}

/**
 * `ready → active` (or from `cooldown`, for the debug command): empties the misses (a trigger
 * consumes them; the end of the instinct empties them again, so a short `cooldownMs` cannot fire
 * twice on the same two misses nor on the ones made during it), freezes the end
 * (`durationMs` is read once, so a live `SetFeel` cannot split the instinct from its slow-mo's
 * hold), `InstinctTriggered`, then the slow-mo.
 */
function startInstinct(world: World, ctx: StepContext): void {
  const feel = ctx.feel.instinct;
  const untilAt = asSimMs(world.time.sim + feel.durationMs);
  world.instinct.missAts.length = 0;
  enterInstinctState(world, 'active', untilAt);
  ctx.events.push({ type: 'InstinctTriggered', t: world.time.sim, untilAt });
  startSlowMo(world, ctx, 'instinct', feel);
}

/**
 * `active → cooldown`: `InstinctEnded{reason}`, then the recharge runs from here (`cooldownMs` frozen
 * in `untilAt`). The misses made during the instinct are dropped: the next one never starts from
 * them, whatever `cooldownMs` is (0 included).
 */
function finishInstinct(world: World, ctx: StepContext, reason: InstinctEndReason): void {
  world.instinct.missAts.length = 0;
  ctx.events.push({ type: 'InstinctEnded', t: world.time.sim, reason });
  enterInstinctState(world, 'cooldown', asSimMs(world.time.sim + ctx.feel.instinct.cooldownMs));
}

/**
 * The level ended while the instinct was on: close it (`InstinctEnded{levelEnded}`, state
 * `cooldown`) so that every `InstinctTriggered` has exactly one end. Called by `endLevel`; the
 * slow-mo winds down by itself (`ENDED_SYSTEMS` still runs `advanceTime`).
 */
export function endInstinct(world: World, ctx: StepContext): void {
  if (world.instinct.state !== 'active') return;
  finishInstinct(world, ctx, 'levelEnded');
}

/**
 * System: Fatherly Instinct (FR20, story 2.9), between `runGauges` and `runScoring`. A pure state
 * machine on the sim clock, no `world.rng`:
 *
 * - this step's debug `ForceInstinct`: starts it now from `ready` or `cooldown` (the tier must have
 *   an instinct); ignored while `active`;
 * - `active` at `untilAt`: `InstinctEnded{timer}`, then `cooldown` for `cooldownMs` (counted from
 *   the end: trigger to trigger is `durationMs + cooldownMs`);
 * - `cooldown` at `untilAt`: `ready`, silently, and the trigger below is looked at in the same step;
 * - `ready`: the tier has an instinct (`activeDifficulty(…).hasInstinct`, read here only: a
 *   running instinct ends normally), `minActiveThreatsCount` threats are active and the last
 *   `missesCount` misses (written by `recordMiss`) fit in `missesWithinMs`. The condition is read
 *   every step, not only on a miss.
 *
 * The +30 % windows are not applied here: `telegraphThreat` freezes them from
 * {@link instinctWindowModifier}, so a window already up keeps its length.
 */
export function runInstinct(world: World, ctx: StepContext): void {
  const { instinct } = world;
  const hasInstinct = activeDifficulty(world, ctx).hasInstinct;
  for (let i = 0; i < ctx.commands.length; i++) {
    if (ctx.commands[i]?.type === 'ForceInstinct' && hasInstinct && instinct.state !== 'active') {
      startInstinct(world, ctx);
    }
  }
  if (instinct.state === 'active' && world.time.sim >= instinct.untilAt) {
    finishInstinct(world, ctx, 'timer');
  }
  if (instinct.state === 'cooldown' && world.time.sim >= instinct.untilAt) {
    enterInstinctState(world, 'ready', asSimMs(0));
  }
  if (instinct.state === 'ready' && hasInstinct && isTriggerMet(world, ctx)) {
    startInstinct(world, ctx);
  }
}
