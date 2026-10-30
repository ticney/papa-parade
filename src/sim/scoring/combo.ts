import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { ComboChangeReason } from '../events.ts';
import { startSlowMo } from '../time/slowMo.ts';
import type { World } from '../world.ts';

// The combo (FR23, story 4.2). `world.combo` is written only here. Like `world.score.perfects`, it is
// written at the source: `resolveThreat` and `gagThreat` call the helpers below, `takeBaby` and
// `putDownBaby` start and stop the carry tick, and `runScoring` is the one clock-driven part.
// Everything is a no-op in a level with no `carry`: with nowhere to cash in, the combo would only be
// noise in the events (D3). No helper draws from `world.rng`.

/**
 * +1 multiplier and `feel.combo.basePerResponsePoints` base points, for a `perfect` or a `success`.
 * At or above `maxMultiplier` the multiplier stays and emits nothing, but the base points still grow.
 */
export function addResponseToCombo(world: World, ctx: StepContext): void {
  if (!ctx.level.hasCarry) return;
  raiseCombo(world, ctx, ctx.feel.combo.basePerResponsePoints, 'response');
}

/** +1 multiplier and `feel.combo.basePerCarryTickPoints` base points, for one more `carryTickMs` carried. */
export function addCarryTickToCombo(world: World, ctx: StepContext): void {
  if (!ctx.level.hasCarry) return;
  raiseCombo(world, ctx, ctx.feel.combo.basePerCarryTickPoints, 'carryTick');
}

function raiseCombo(
  world: World,
  ctx: StepContext,
  basePoints: number,
  reason: ComboChangeReason,
): void {
  const { combo } = world;
  combo.basePoints += basePoints;
  // `>=`, never a `min`: a `SetFeel` that lowers the maximum must not lower a running multiplier.
  if (combo.multiplier >= ctx.feel.combo.maxMultiplier) return;
  combo.multiplier += 1;
  ctx.events.push({
    type: 'ComboChanged',
    t: world.time.sim,
    multiplier: combo.multiplier,
    reason,
  });
}

/**
 * Back to `minMultiplier` with no base points; `ComboChanged` only if the multiplier moved. With the
 * baby carried, the next tick is `carryTickMs` from now: the ten seconds are « sans incident ».
 */
export function resetCombo(world: World, ctx: StepContext, reason: ComboChangeReason): void {
  if (!ctx.level.hasCarry) return;
  const { combo } = world;
  const { minMultiplier, carryTickMs } = ctx.feel.combo;
  combo.basePoints = 0;
  if (combo.carryTickAt !== null) combo.carryTickAt = asSimMs(world.time.sim + carryTickMs);
  if (combo.multiplier === minMultiplier) return;
  combo.multiplier = minMultiplier;
  ctx.events.push({ type: 'ComboChanged', t: world.time.sim, multiplier: minMultiplier, reason });
}

/**
 * The put-down banks the combo, only on a `safe` drop with a multiplier above the minimum: a drop on
 * bare floor neither cashes in nor resets (the combo stays at risk) and a safe drop at x1 is the
 * plain 4.1 put-down. `points = multiplier * basePoints` go to `world.score.comboPoints`; events
 * `ComboCashedIn` then `ComboChanged{cashIn}`; then the cash-in slow-mo (no hitstop).
 */
export function cashInCombo(world: World, ctx: StepContext, isSafe: boolean): void {
  if (!ctx.level.hasCarry || !isSafe) return;
  const { combo } = world;
  const { minMultiplier, slowMoCashIn } = ctx.feel.combo;
  if (combo.multiplier <= minMultiplier) return;
  const { multiplier, basePoints } = combo;
  const points = multiplier * basePoints;
  world.score.comboPoints += points;
  ctx.events.push({ type: 'ComboCashedIn', t: world.time.sim, multiplier, basePoints, points });
  resetCombo(world, ctx, 'cashIn');
  startSlowMo(world, ctx, 'comboCashIn', slowMoCashIn);
}

/** The baby is in Papa's arms: the first tick is `carryTickMs` from now. */
export function startCarryTick(world: World, ctx: StepContext): void {
  if (!ctx.level.hasCarry) return;
  world.combo.carryTickAt = asSimMs(world.time.sim + ctx.feel.combo.carryTickMs);
}

/** The baby is down: no more ticks until the next take. */
export function stopCarryTick(world: World): void {
  world.combo.carryTickAt = null;
}

/**
 * The scoring system (slot between `runGauges` and `runFlow`): the carry tick, the one part of the
 * combo that fires on a clock. At `carryTickAt` the combo climbs one step and the next tick is due
 * `carryTickMs` after the one that fired (no drift). It runs on while Papa is busy. Allocation-free
 * outside the event, no draw.
 */
export function runScoring(world: World, ctx: StepContext): void {
  const { combo } = world;
  const { carryTickAt } = combo;
  if (carryTickAt === null || world.time.sim < carryTickAt) return;
  addCarryTickToCombo(world, ctx);
  combo.carryTickAt = asSimMs(carryTickAt + ctx.feel.combo.carryTickMs);
}
