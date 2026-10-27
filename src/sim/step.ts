import { runBaby } from './baby/babySystem.ts';
import { applyCommands } from './commandQueue.ts';
import type { StepContext, System } from './context.ts';
import { runPapa } from './papa/papaSystem.ts';
import { advanceTime } from './time/clock.ts';
import type { World } from './world.ts';

/**
 * Fixed order of the systems of one step (architecture, project-context):
 *
 *   applyCommands, advanceTime, runDirector, runBaby, runThreats, runPapa, runPhysics,
 *   runGauges, runInstinct, runScoring, runFlow
 *
 * Only applyCommands, advanceTime, runBaby and runPapa exist so far: runDirector will go before
 * runBaby, runThreats between runBaby and runPapa. Each later story inserts its system at its
 * slot, edits the pinned order test and, if behaviour changes, regenerates the golden references
 * and says so.
 * Systems never call each other: they read and write `World` and push to `ctx.events`.
 */
export const SYSTEMS: readonly System[] = [applyCommands, advanceTime, runBaby, runPapa];

export function step(world: World, ctx: StepContext, systems: readonly System[] = SYSTEMS): void {
  for (let i = 0; i < systems.length; i++) (systems[i] as System)(world, ctx);
}
