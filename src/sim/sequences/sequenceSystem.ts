import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { isThreatActive } from '../director/waveState.ts';
import type { World } from '../world.ts';
import { sequenceDefOf, succeedSequence } from './sequenceEnd.ts';
import { startSequence } from './sequenceStart.ts';
import { enterSequenceStep, tickSequenceStep } from './sequenceSteps.ts';

/**
 * System: the special sequences (story 4.4), right after `advanceTime` and before the director, so
 * that on the step a sequence starts the director already sees it. In order: this step's
 * `StartSequence` commands (`startSequence`: refused ones do nothing), then, if a sequence runs,
 * the step change (`SequenceStepStarted` at each `stepEndsAt` passed, no draw), the current step's
 * handler, and the end test: at or after `endsAt`, with no micro-sleep announced or open, the
 * sequence is won (`SequenceEnded{succeeded}`). A sequence never succeeds over an open window
 * (`lagMs` can move a close a little past the check). A failure is not decided here: `gagThreat`
 * ends the sequence (`failSequenceOnGag`) in the step the gag happens. Pure: no real time, no log,
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

  while (now >= sequence.stepEndsAt && sequence.stepIndex + 1 < def.steps.length) {
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
    enterSequenceStep(world, ctx, next);
  }
  const step = def.steps[sequence.stepIndex];
  if (step !== undefined) tickSequenceStep(world, ctx, step);

  if (now < sequence.endsAt) return;
  const microSleep = world.threats[ctx.level.microSleepIndex];
  if (microSleep !== undefined && isThreatActive(microSleep)) return;
  succeedSequence(world, ctx);
}
