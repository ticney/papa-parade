import type { SequenceStep, SequenceStepKind } from '@content/schemas/sequence';
import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import type { World } from '../world.ts';

/** What the sim does with one kind of step: enter it, and step it while it runs. */
interface StepHandler<K extends SequenceStepKind> {
  /** Called when the step is entered, the first step included. */
  enter(world: World, ctx: StepContext, step: StepOfKind<K>): void;
  /** Called every step while the step is the current one. */
  tick(world: World, ctx: StepContext, step: StepOfKind<K>): void;
}

type StepOfKind<K extends SequenceStepKind> = Extract<SequenceStep, { kind: K }>;

/** When the next micro-sleep is due: `gapMinMs…gapMaxMs` from now, with exactly one `nextFloat`. */
function drawMicroSleepAt(world: World, step: StepOfKind<'microSleeps'>) {
  return asSimMs(
    world.time.sim + step.gapMinMs + nextFloat(world.rng) * (step.gapMaxMs - step.gapMinMs),
  );
}

/**
 * `microSleeps`: Papa's micro-sleeps come on a cadence of their own, independent of the fatigue
 * gauge (it neither reads nor touches `gauges.microSleepAt`). The cadence is drawn once, at the
 * sequence's start; entering a later step draws nothing and the gap in force is the current
 * step's, read when a micro-sleep is telegraphed. The instance is the level's own micro-sleep
 * (`ctx.level.microSleepIndex`, D1), telegraphed only when it could be judged before both the
 * sequence's end and the level's.
 */
const MICRO_SLEEPS: StepHandler<'microSleeps'> = {
  enter(world, _ctx, step) {
    if (world.sequence.nextMicroSleepAt !== null) return;
    world.sequence.nextMicroSleepAt = drawMicroSleepAt(world, step);
  },
  tick(world, ctx, step) {
    const { sequence } = world;
    const now = world.time.sim;
    if (sequence.nextMicroSleepAt === null || now < sequence.nextMicroSleepAt) return;
    const index = ctx.level.microSleepIndex;
    const threat = world.threats[index];
    const planned = ctx.level.threats[index];
    if (threat === undefined || planned === undefined) return;
    if (threat.state !== 'idle' || isPapaBusy(world.papa)) return;
    if (!isJudgeableBeforeEnd(ctx, planned.def, now, sequence.endsAt)) return;
    if (!isJudgeableBeforeEnd(ctx, planned.def, now, ctx.level.durationMs)) return;
    telegraphThreat(world, ctx, threat, planned.def, -1);
    sequence.nextMicroSleepAt = drawMicroSleepAt(world, step);
  },
};

/**
 * One handler per `SequenceStepKind`, defined once at module scope: story 4.5's walk and the next
 * ones add a kind and its entry, and a kind with no handler does not compile.
 */
const HANDLERS: { readonly [K in SequenceStepKind]: StepHandler<K> } = {
  microSleeps: MICRO_SLEEPS,
};

/** Every step kind the sim has a handler for (`createSim` refuses a def of another kind). */
export const SEQUENCE_HANDLER_KINDS = Object.keys(HANDLERS) as readonly SequenceStepKind[];

/** Enters `step` (the one at `world.sequence.stepIndex`). */
export function enterSequenceStep(world: World, ctx: StepContext, step: SequenceStep): void {
  if (step.kind === 'microSleeps') HANDLERS.microSleeps.enter(world, ctx, step);
}

/** Steps `step`, the current one. */
export function tickSequenceStep(world: World, ctx: StepContext, step: SequenceStep): void {
  if (step.kind === 'microSleeps') HANDLERS.microSleeps.tick(world, ctx, step);
}
