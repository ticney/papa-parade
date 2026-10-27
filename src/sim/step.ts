import { applyCommands } from './commandQueue.ts';
import type { StepContext, System } from './context.ts';
import { advanceTime } from './time/clock.ts';
import type { World } from './world.ts';

/**
 * Fixed order of the systems of one step (architecture, project-context):
 *
 *   applyCommands, advanceTime, runDirector, runBaby, runThreats, runPapa, runPhysics,
 *   runGauges, runInstinct, runScoring, runFlow
 *
 * Only the first two exist so far. Each later story inserts its system at its slot, edits the
 * pinned order test and, if behaviour changes, regenerates the golden references and says so.
 * Systems never call each other: they read and write `World` and push to `ctx.events`.
 */
export const SYSTEMS: readonly System[] = [applyCommands, advanceTime];

export function step(world: World, ctx: StepContext, systems: readonly System[] = SYSTEMS): void {
  for (let i = 0; i < systems.length; i++) (systems[i] as System)(world, ctx);
}
