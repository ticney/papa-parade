import { GAUGE_MAX_POINTS } from '@shared/constants';
import { endInstinct } from '../assist/paternalInstinct.ts';
import { endSilence } from '../baby/silence.ts';
import type { StepContext } from '../context.ts';
import { endRingingPhones } from '../disruptions/phone.ts';
import type { LevelEndReason } from '../events.ts';
import { scoreLevel } from '../scoring/mamaScore.ts';
import { endSequenceForLevelEnd } from '../sequences/sequenceEnd.ts';
import type { World } from '../world.ts';
import { enterFlowState } from './flowFsm.ts';

/**
 * The end of the level, shared by both ways in: a sequence under way is closed first
 * (`SequenceEnded{levelEnded}`, story 4.4), then a phone still ringing
 * (`PhoneRingEnded{levelEnded}`), then an open silence (`SilenceEnded{levelEnded}`), Fatherly
 * Instinct (`InstinctEnded{levelEnded}`, story 2.9), `playing →
 * ended`, `MamaWoke` (a woken Mama only), `LevelEnded{reason}`, and Mama's note in the same step
 * (`scoreLevel`, story 1.22).
 */
function endLevel(world: World, ctx: StepContext, reason: LevelEndReason): void {
  endSequenceForLevelEnd(world, ctx);
  endRingingPhones(world, ctx);
  endSilence(world, ctx);
  endInstinct(world, ctx);
  enterFlowState(world, 'ended');
  if (reason === 'mamaWoke') ctx.events.push({ type: 'MamaWoke', t: world.time.sim });
  ctx.events.push({ type: 'LevelEnded', t: world.time.sim, reason });
  scoreLevel(world, ctx, reason);
}

/**
 * System: the level's flow, last of `SYSTEMS`. It has two ways in. At the first step where the
 * noise gauge of a level with noise is at 100 % (`GAUGE_MAX_POINTS`, read after `runGauges`, story
 * 3.2), Mama wakes: `MamaWoke`, then `LevelEnded{reason: 'mamaWoke'}`. At the first step where the
 * sim clock reaches the level's `durationMs` (story 1.18), `LevelEnded{reason: 'timer'}`. The noise
 * is checked first, so both in one step go to Mama (D2). After that `step()` no longer runs this
 * system (nor any gameplay one, see `ENDED_SYSTEMS`), so the event comes exactly once. Mama's note
 * follows `LevelEnded` in the same step: the world is frozen from then on, so it matches the room
 * left on screen. A level without noise keeps `noisePct` at 0 and can only end on the timer.
 */
export function runFlow(world: World, ctx: StepContext): void {
  // A sequence (story 4.4) does not suspend the level's end: the timer and the noise still end it.
  if (world.flow.state === 'ended') return;
  if (ctx.level.hasNoise && world.gauges.noisePct >= GAUGE_MAX_POINTS) {
    endLevel(world, ctx, 'mamaWoke');
    return;
  }
  if (world.time.sim < ctx.level.durationMs) return;
  endLevel(world, ctx, 'timer');
}
