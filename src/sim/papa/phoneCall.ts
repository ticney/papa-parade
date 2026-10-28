import { asSimMs } from '@shared/time';
import type { SimPlannedDisruption, StepContext } from '../context.ts';
import { addFatigue } from '../gauges/fatigue.ts';
import type { World } from '../world.ts';
import { enterPapaState } from './papaFsm.ts';

/**
 * Papa picked up the phone planned at `index` (story 1.20 D7, D8): he is on it for the def's
 * `answerBusyMs`, counted from the arrival, and answers nothing meanwhile (the busy rule of 1.19 D6).
 * The fatigue the def costs is added **now**, through `addFatigue`, so the gauge shows it while he
 * talks and a nap that cuts the call cannot cancel it. A micro-sleep that was already up when he
 * arrived can still gag during the call: Papa then falls `asleep`, which replaces `onPhone` and ends
 * the call (`putPapaToSleep`), and the fatigue added here stays. `PhoneAnswered` carries the gauge
 * after the add (unchanged in a level without fatigue). Answering can draw from `world.rng`: when the
 * add takes the fatigue above its threshold, `addFatigue` draws when the next micro-sleep is due.
 */
export function startCall(world: World, ctx: StepContext, index: number): void {
  const { papa } = world;
  const planned = ctx.level.disruptions[index] as SimPlannedDisruption;
  const untilAt = asSimMs(world.time.sim + planned.def.answerBusyMs);
  papa.objectId = null;
  papa.busyUntil = untilAt;
  enterPapaState(world, ctx, 'onPhone');
  addFatigue(world, ctx, planned.def.answerFatiguePoints);
  ctx.events.push({
    type: 'PhoneAnswered',
    t: world.time.sim,
    objectId: planned.objectId,
    untilAt,
    fatigue: world.gauges.fatigue,
  });
}
