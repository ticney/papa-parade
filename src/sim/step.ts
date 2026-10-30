import { runBaby } from './baby/babySystem.ts';
import { applyCommands } from './commandQueue.ts';
import type { StepContext, System } from './context.ts';
import { runDirector } from './director/directorSystem.ts';
import { runDisruptions } from './disruptions/disruptionsSystem.ts';
import { runFlow } from './flow/flowSystem.ts';
import { runGauges } from './gauges/gaugesSystem.ts';
import { runPapa } from './papa/papaSystem.ts';
import { runPhysics } from './physics/propsSystem.ts';
import { runScoring } from './scoring/combo.ts';
import { runThreats } from './threats/threatSystem.ts';
import { advanceTime } from './time/clock.ts';
import type { World } from './world.ts';

/**
 * Fixed order of the systems of one step (architecture, project-context):
 *
 *   applyCommands, advanceTime, runDirector, runDisruptions, runBaby, runThreats, runPapa,
 *   runPhysics, runGauges, runInstinct, runScoring, runFlow
 *
 * applyCommands, advanceTime, runDirector, runDisruptions, runBaby, runThreats, runPapa, runPhysics,
 * runGauges, runScoring and runFlow exist so far (`runGauges` is the fatigue since story 1.19 and the noise since
 * 3.1; `runDisruptions`, story 1.20, ticks the phone right after the director so that a ring that
 * times out in the step Papa arrives is already over when `runPapa` looks). Each
 * later story inserts its system at its slot, edits the pinned order test and, if behaviour
 * changes, regenerates the golden references and says so.
 * Systems never call each other: they read and write `World` and push to `ctx.events`.
 * Mama's note (story 1.22) needs no system: its counters are written where their events are made,
 * and `runFlow` gives the note (`scoreLevel`) in the step it ends the level. `runScoring` stays
 * holds the combo's carry tick only (story 4.2): the rest of the combo is written where its event is made.
 *
 * Once the level has ended (`world.flow.state === 'ended'`, story 1.18) a step runs only
 * {@link ENDED_SYSTEMS}: commands are drained and ignored, the clock keeps going (every
 * `while (time < until)` loop still ends, and a slow-mo winds down) and nothing else moves.
 */
export const SYSTEMS: readonly System[] = [
  applyCommands,
  advanceTime,
  runDirector,
  runDisruptions,
  runBaby,
  runThreats,
  runPapa,
  runPhysics,
  runGauges,
  runScoring,
  runFlow,
];

/** What a step runs after the level has ended: the queue is drained (and ignored) and the clock advances. */
export const ENDED_SYSTEMS: readonly System[] = [applyCommands, advanceTime];

export function step(world: World, ctx: StepContext, systems: readonly System[] = SYSTEMS): void {
  if (world.flow.state === 'ended') systems = ENDED_SYSTEMS;
  for (let i = 0; i < systems.length; i++) (systems[i] as System)(world, ctx);
}
