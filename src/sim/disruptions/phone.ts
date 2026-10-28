import { PHONE_RINGING_EVERY_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { SimPlannedDisruption, StepContext } from '../context.ts';
import type { DisruptionInstance, World } from '../world.ts';
import { enterDisruptionState } from './disruptionFsm.ts';

/**
 * The phone (story 1.20): the helpers `runDisruptions` and `runPapa` share. They emit the phone's
 * events and never call a system; this file imports no Papa code (`papa/` imports it, not the other
 * way round), so the two folders have no cycle. Allocation-free, and nothing here draws from `world.rng`.
 */

/** The planned disruption and its instance at `index` (index-aligned; the caller keeps `index` in range). */
function disruptionAt(
  world: World,
  ctx: StepContext,
  index: number,
): { planned: SimPlannedDisruption; instance: DisruptionInstance } {
  return {
    planned: ctx.level.disruptions[index] as SimPlannedDisruption,
    instance: world.disruptions[index] as DisruptionInstance,
  };
}

/**
 * The phone starts to ring now: `pending → ringing`, `PhoneRingStarted{untilAt}` where `untilAt` is
 * `ringMaxMs` later, and the first `PhoneRinging` is due one `PHONE_RINGING_EVERY_MS` after now.
 */
export function startRinging(world: World, ctx: StepContext, index: number): void {
  const { planned, instance } = disruptionAt(world, ctx, index);
  const now = world.time.sim;
  enterDisruptionState(world, instance, 'ringing');
  instance.untilAt = asSimMs(now + planned.def.ringMaxMs);
  instance.nextRingingAt = asSimMs(now + PHONE_RINGING_EVERY_MS);
  ctx.events.push({
    type: 'PhoneRingStarted',
    t: now,
    objectId: planned.objectId,
    untilAt: instance.untilAt,
  });
}

/**
 * One step of a ringing phone: first the `PhoneRinging` ticks that are due (each at the first step
 * at or after `start + k × PHONE_RINGING_EVERY_MS`, k ≥ 1, up to the instant it gives up, so the
 * ticks of a phone nobody answers number `floor(ringMaxMs / PHONE_RINGING_EVERY_MS)`), then, once
 * `now ≥ untilAt`, the timeout: `ringing → timedOut` and `PhoneRingEnded{timedOut}`. A tick and the
 * timeout due in the same step come in that order. The next tick is due from the previous **due**
 * instant, not from the step that emitted it.
 */
export function tickRinging(world: World, ctx: StepContext, index: number): void {
  const { planned, instance } = disruptionAt(world, ctx, index);
  const now = world.time.sim;
  while (instance.nextRingingAt <= now && instance.nextRingingAt <= instance.untilAt) {
    ctx.events.push({ type: 'PhoneRinging', t: now, objectId: planned.objectId });
    instance.nextRingingAt = asSimMs(instance.nextRingingAt + PHONE_RINGING_EVERY_MS);
  }
  if (now < instance.untilAt) return;
  enterDisruptionState(world, instance, 'timedOut');
  instance.untilAt = asSimMs(0);
  instance.nextRingingAt = asSimMs(0);
  ctx.events.push({
    type: 'PhoneRingEnded',
    t: now,
    objectId: planned.objectId,
    reason: 'timedOut',
  });
}

/** The index, in `ctx.level.disruptions`, of the disruption ringing at `objectId` right now, or -1. */
export function ringingDisruptionAt(world: World, ctx: StepContext, objectId: string): number {
  const planned = ctx.level.disruptions;
  for (let i = 0; i < planned.length; i++) {
    if ((planned[i] as SimPlannedDisruption).objectId !== objectId) continue;
    if ((world.disruptions[i] as DisruptionInstance).state === 'ringing') return i;
  }
  return -1;
}

/** Papa picks up: `ringing → answered`, and `PhoneRingEnded{answered}`. The call itself is `startCall`'s. */
export function answerPhone(world: World, ctx: StepContext, index: number): void {
  const { planned, instance } = disruptionAt(world, ctx, index);
  enterDisruptionState(world, instance, 'answered');
  instance.untilAt = asSimMs(0);
  instance.nextRingingAt = asSimMs(0);
  ctx.events.push({
    type: 'PhoneRingEnded',
    t: world.time.sim,
    objectId: planned.objectId,
    reason: 'answered',
  });
}

/**
 * The level ends while phones still ring: each goes `ringing → timedOut` (a missed call) and gets its
 * `PhoneRingEnded{levelEnded}`, so every `PhoneRingStarted` has its end and a ringing instance never
 * outlives the level. `runFlow` calls it in the step it ends the level, before `LevelEnded`.
 */
export function endRingingPhones(world: World, ctx: StepContext): void {
  const planned = ctx.level.disruptions;
  for (let i = 0; i < planned.length; i++) {
    const instance = world.disruptions[i] as DisruptionInstance;
    if (instance.state !== 'ringing') continue;
    enterDisruptionState(world, instance, 'timedOut');
    instance.untilAt = asSimMs(0);
    instance.nextRingingAt = asSimMs(0);
    ctx.events.push({
      type: 'PhoneRingEnded',
      t: world.time.sim,
      objectId: (planned[i] as SimPlannedDisruption).objectId,
      reason: 'levelEnded',
    });
  }
}
