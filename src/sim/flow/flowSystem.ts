import { GAUGE_MAX_POINTS } from '@shared/constants';
import { endInstinct } from '../assist/paternalInstinct.ts';
import { endSilence } from '../baby/silence.ts';
import type { StepContext } from '../context.ts';
import { endRingingPhones } from '../disruptions/phone.ts';
import type { LevelEndReason } from '../events.ts';
import { scoreLevel } from '../scoring/mamaScore.ts';
import { endSequenceForLevelEnd } from '../sequences/sequenceEnd.ts';
import type { World } from '../world.ts';
import { enterFlowState, isFlowLive } from './flowFsm.ts';

/**
 * The end of the level, shared by every way in: a sequence under way is closed first
 * (`SequenceEnded{levelEnded}`, story 4.4), then a phone still ringing
 * (`PhoneRingEnded{levelEnded}`), then an open silence (`SilenceEnded{levelEnded}`), Fatherly
 * Instinct (`InstinctEnded{levelEnded}`, story 2.9), the flow goes to `ended` (to `photo` when the
 * timer ends a level with a final rush, story 3.5, D2), `MamaWoke` (a woken Mama only),
 * `LevelEnded{reason}`, and Mama's note in the same step (`scoreLevel`, story 1.22).
 */
function endLevel(world: World, ctx: StepContext, reason: LevelEndReason): void {
  endSequenceForLevelEnd(world, ctx);
  endRingingPhones(world, ctx);
  endSilence(world, ctx);
  endInstinct(world, ctx);
  enterFlowState(world, reason === 'timer' && ctx.level.hasFinalRush ? 'photo' : 'ended');
  if (reason === 'mamaWoke') ctx.events.push({ type: 'MamaWoke', t: world.time.sim });
  ctx.events.push({ type: 'LevelEnded', t: world.time.sim, reason });
  scoreLevel(world, ctx, reason);
}

/**
 * The door opens (story 3.5): a sequence under way is closed first (`SequenceEnded{levelEnded}`, no
 * resume and no cycle move), the flow enters `finalRush`, `flow.finalRushAt` is written beside it
 * and `FinalRushStarted` is emitted. A phone already ringing keeps ringing. Once per level.
 */
function startFinalRush(world: World, ctx: StepContext): void {
  endSequenceForLevelEnd(world, ctx);
  enterFlowState(world, 'finalRush');
  world.flow.finalRushAt = world.time.sim;
  ctx.events.push({ type: 'FinalRushStarted', t: world.time.sim });
}

/**
 * System: the level's flow, last of `SYSTEMS`. It has three ways in. At the first step where the
 * noise gauge of a level with noise is at 100 % (`GAUGE_MAX_POINTS`, read after `runGauges`, story
 * 3.2), Mama wakes: `MamaWoke`, then `LevelEnded{reason: 'mamaWoke'}`. In the step the bedtime cycle
 * is completed (story 4.10), `LevelEnded{reason: 'cycleDone'}`. At the first step where the sim clock
 * reaches the level's `durationMs` (story 1.18), `LevelEnded{reason: 'timer'}`. In that order: on a
 * tie the noise goes first (D2), then the cycle. After that `step()` no longer runs this
 * system (nor any gameplay one, see `ENDED_SYSTEMS`), so the event comes exactly once. Mama's note
 * follows `LevelEnded` in the same step: the world is frozen from then on, so it matches the room
 * left on screen. A level without noise keeps `noisePct` at 0 and never ends on Mama.
 *
 * A level with a `finalRush` (story 3.5) has a fourth thing, last (D3): at the first step where the
 * sim clock reaches `durationMs - feel.endOfLevel.finalRushMs` the rush starts ({@link startFinalRush});
 * the timer then ends the level on `photo`. A sequence that ends in the very step has already ended on
 * its own terms.
 */
export function runFlow(world: World, ctx: StepContext): void {
  // A sequence (story 4.4) and the rush (story 3.5) do not suspend the level's end: the timer and the noise still end it.
  if (!isFlowLive(world)) return;
  if (ctx.level.hasNoise && world.gauges.noisePct >= GAUGE_MAX_POINTS) {
    endLevel(world, ctx, 'mamaWoke');
    return;
  }
  if (world.cycle.completedAt !== null) {
    endLevel(world, ctx, 'cycleDone');
    return;
  }
  if (world.time.sim >= ctx.level.durationMs) {
    // A `SetFeel` can leave no step between the rush's start and the end: `photo` always follows a rush.
    if (ctx.level.hasFinalRush && world.flow.finalRushAt === null) startFinalRush(world, ctx);
    endLevel(world, ctx, 'timer');
    return;
  }
  if (
    ctx.level.hasFinalRush &&
    world.flow.finalRushAt === null &&
    world.time.sim >= ctx.level.durationMs - ctx.feel.endOfLevel.finalRushMs
  ) {
    startFinalRush(world, ctx);
  }
}
