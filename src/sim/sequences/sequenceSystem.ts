import type { SequenceStep } from '@content/schemas/sequence';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { clearBeatSlice, type World } from '../world.ts';
import { sequenceDefOf, succeedSequence } from './sequenceEnd.ts';
import { startSequence } from './sequenceStart.ts';
import {
  enterSequenceStep,
  isSequenceStepSettled,
  isSequenceStepTimed,
  tickSequenceStep,
} from './sequenceSteps.ts';

/**
 * System: the special sequences (story 4.4), right after `advanceTime` and before the director, so
 * that on the step a sequence starts the director already sees it. In order: this step's
 * `StartSequence` commands (`startSequence`: refused ones do nothing), then, if a sequence runs,
 * the step change (`SequenceStepStarted` at each `stepEndsAt` passed, no draw), the current step's
 * handler, and the end test: at or after `endsAt`, with the current step settled (its handler's
 * `isSettled`: no micro-sleep announced or open, no judged beat left), the sequence is won
 * (`SequenceEnded{succeeded}`). A sequence never succeeds over an open window (`lagMs` can move a
 * close a little past the check). A failure is not decided here: `gagThreat` ends the sequence
 * (`failSequenceOnGag`) in the step the gag happens, and the baby waking (`stirBaby`) in its step. Pure: no real time, no log,
 * randomness only through `world.rng`. Allocation-free once started.
 */
export function runSequence(world: World, ctx: StepContext): void {
  for (let i = 0; i < ctx.commands.length; i++) {
    const command = ctx.commands[i];
    if (command?.type === 'StartSequence') startSequence(world, ctx, command.sequenceId);
  }
  if (world.flow.state !== 'sequence') return;
  const { sequence } = world;
  const def = sequenceDefOf(ctx, sequence.id);
  if (def === undefined || sequence.id === null) return;
  const now = world.time.sim;

  // Only a timed step moves on with the clock: a duel step advances on its result (story 4.6).
  while (
    now >= sequence.stepEndsAt &&
    sequence.stepIndex + 1 < def.steps.length &&
    isSequenceStepTimed(def.steps[sequence.stepIndex] as SequenceStep)
  ) {
    sequence.stepIndex += 1;
    const next = def.steps[sequence.stepIndex];
    if (next === undefined) break;
    sequence.stepEndsAt = asSimMs(sequence.stepEndsAt + next.durationMs);
    ctx.events.push({
      type: 'SequenceStepStarted',
      t: now,
      id: sequence.id,
      stepIndex: sequence.stepIndex,
    });
    clearBeatSlice(sequence.beat);
    enterSequenceStep(world, ctx, next);
  }
  const step = def.steps[sequence.stepIndex];
  if (step !== undefined) tickSequenceStep(world, ctx, step);

  if (now < sequence.endsAt) return;
  if (step !== undefined && !isSequenceStepSettled(world, ctx, step)) return;
  succeedSequence(world, ctx);
}
