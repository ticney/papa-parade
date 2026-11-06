import { runInstinct } from './assist/paternalInstinct.ts';
import { runBaby } from './baby/babySystem.ts';
import { runChores, settleChores } from './chores/choreSystem.ts';
import { applyCommands } from './commandQueue.ts';
import type { StepContext, System } from './context.ts';
import { runDirector } from './director/directorSystem.ts';
import { runDisruptions } from './disruptions/disruptionsSystem.ts';
import { isFlowLive } from './flow/flowFsm.ts';
import { runFlow } from './flow/flowSystem.ts';
import { runGauges } from './gauges/gaugesSystem.ts';
import { runPapa } from './papa/papaSystem.ts';
import { runPhysics } from './physics/propsSystem.ts';
import { runScoring } from './scoring/combo.ts';
import { runSequence } from './sequences/sequenceSystem.ts';
import { runThreats } from './threats/threatSystem.ts';
import { advanceTime } from './time/clock.ts';
import type { World } from './world.ts';

/**
 * Fixed order of the systems of one step (architecture, project-context):
 *
 *   applyCommands, advanceTime, runSequence, runDirector, runDisruptions, runBaby, runThreats,
 *   runChores, runPapa, settleChores, runPhysics, runGauges, runInstinct, runScoring, runFlow
 *
 * `runChores` (story 9.4) comes after the threats, whose windows it gives way to (a chore's beat is
 * held while a threat's window is open), and before Papa, whose step it takes the taps on a station
 * from: a chore is judged on its own commands, and Papa's state says whether he is working.
 * `settleChores` comes right after Papa: a chore he left in this step (a tap elsewhere, the baby
 * taken) is paused in the same step, so that no step ends with a working chore and a Papa who is not
 * in `chore`.
 *
 * All of them exist. `runGauges` is the fatigue since story 1.19, the noise since 3.1 and the need
 * since 4.3. `runInstinct` (story 2.9) is Fatherly Instinct: it reads the misses `gagThreat` wrote
 * in `runThreats`, so it comes after the threats and the gauges. `runDisruptions` (story 1.20) ticks
 * the phone right after the director so that a ring that times out in the step Papa arrives is
 * already over when `runPapa` looks. Each
 * later story inserts its system at its slot, edits the pinned order test and, if behaviour
 * changes, regenerates the golden references and says so.
 * Systems never call each other: they read and write `World` and push to `ctx.events`.
 * `runSequence` (story 4.4) sits right after the clock and before the director, so that on the step a
 * special sequence starts the director already sees it (and returns early). It is a system, not a
 * helper, because later sequences hang their step kinds there.
 * Mama's note (story 1.22) is mostly written where its events are made, and `runFlow` gives it
 * (`scoreLevel`) in the step it ends the level. `runScoring` holds what runs on a clock: the calm
 * tracker (story 3.12, which counts that ending step) and the combo's carry tick (story 4.2); the rest
 * of the combo is written where its event is made.
 *
 * Once the level has ended (`!isFlowLive(world)`: `ended` since story 1.18, `photo` since 3.5) a step runs only
 * {@link ENDED_SYSTEMS}: commands are drained and ignored, the clock keeps going (every
 * `while (time < until)` loop still ends, and a slow-mo winds down) and nothing else moves.
 */
export const SYSTEMS: readonly System[] = [
  applyCommands,
  advanceTime,
  runSequence,
  runDirector,
  runDisruptions,
  runBaby,
  runThreats,
  runChores,
  runPapa,
  settleChores,
  runPhysics,
  runGauges,
  runInstinct,
  runScoring,
  runFlow,
];

/** What a step runs after the level has ended: the queue is drained (and ignored) and the clock advances. */
export const ENDED_SYSTEMS: readonly System[] = [applyCommands, advanceTime];

export function step(world: World, ctx: StepContext, systems: readonly System[] = SYSTEMS): void {
  if (!isFlowLive(world)) systems = ENDED_SYSTEMS;
  for (let i = 0; i < systems.length; i++) (systems[i] as System)(world, ctx);
}
