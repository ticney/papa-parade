import { endSilence } from '../baby/silence.ts';
import type { StepContext } from '../context.ts';
import { endRingingPhones } from '../disruptions/phone.ts';
import type { World } from '../world.ts';
import { enterFlowState } from './flowFsm.ts';

/**
 * System: the level's flow, last of `SYSTEMS`. At the first step where the sim clock reaches the
 * level's `durationMs` (story 1.18), `playing → ended` and one `LevelEnded{reason: 'timer'}`.
 * After that `step()` no longer runs this system (nor any gameplay one, see `ENDED_SYSTEMS`), so
 * the event comes exactly once. A phone still ringing is closed first (`PhoneRingEnded{levelEnded}`), then an open silence (`SilenceEnded{levelEnded}`). The early end on noise (`MamaWoke`, story 3.x) is a second way in.
 */
export function runFlow(world: World, ctx: StepContext): void {
  if (world.flow.state !== 'playing') return;
  if (world.time.sim < ctx.level.durationMs) return;
  endRingingPhones(world, ctx);
  endSilence(world, ctx);
  enterFlowState(world, 'ended');
  ctx.events.push({ type: 'LevelEnded', t: world.time.sim, reason: 'timer' });
}
