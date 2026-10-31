import type { SequenceStep, SequenceStepKind } from '@content/schemas/sequence';
import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { isThreatActive } from '../director/waveState.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import type { World } from '../world.ts';
import { DUEL_HANDLER } from './bedtimeDuel.ts';
import { BEATS_HANDLER } from './lullabyWalk.ts';

/** What the sim does with one kind of step: enter it, step it while it runs, say when it is settled. */
export interface StepHandler<K extends SequenceStepKind> {
  /**
   * Whether the step ends when its time is up (`stepEndsAt`). `false` for a step that advances on a
   * result (story 4.6's duel, 4.8's after it): `runSequence` never moves past it on the clock.
   */
  readonly isTimed: boolean;
  /** Called when the step is entered, the first step included. */
  enter(world: World, ctx: StepContext, step: StepOfKind<K>): void;
  /** Called every step while the step is the current one. */
  tick(world: World, ctx: StepContext, step: StepOfKind<K>): void;
  /**
   * Whether nothing of the step is left open, so that the sequence may end well once its time is up
   * (`runSequence`'s end test, which no longer names a kind): a sequence never succeeds over an open
   * window.
   */
  isSettled(world: World, ctx: StepContext, step: StepOfKind<K>): boolean;
}

export type StepOfKind<K extends SequenceStepKind> = Extract<SequenceStep, { kind: K }>;

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
  isTimed: true,
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
    if (!isJudgeableBeforeEnd(world, ctx, planned.def, now, sequence.endsAt)) return;
    if (!isJudgeableBeforeEnd(world, ctx, planned.def, now)) return;
    telegraphThreat(world, ctx, threat, planned.def, -1);
    sequence.nextMicroSleepAt = drawMicroSleepAt(world, step);
  },
  isSettled(world, ctx) {
    // No micro-sleep announced or open: `lagMs` can move a close a little past the time check.
    const microSleep = world.threats[ctx.level.microSleepIndex];
    return microSleep === undefined || !isThreatActive(microSleep);
  },
};

/**
 * One handler per `SequenceStepKind`, defined once at module scope: story 4.5's walk and the next
 * ones add a kind and its entry, and a kind with no handler does not compile.
 */
const HANDLERS: { readonly [K in SequenceStepKind]: StepHandler<K> } = {
  microSleeps: MICRO_SLEEPS,
  beats: BEATS_HANDLER,
  duel: DUEL_HANDLER,
};

/** Every step kind the sim has a handler for (`createSim` refuses a def of another kind). */
export const SEQUENCE_HANDLER_KINDS = Object.keys(HANDLERS) as readonly SequenceStepKind[];

/** Whether `step` ends when its time is up; a step that advances on a result does not (story 4.6). */
export function isSequenceStepTimed(step: SequenceStep): boolean {
  return handlerOf(step).isTimed;
}

/** Enters `step` (the one at `world.sequence.stepIndex`). */
export function enterSequenceStep(world: World, ctx: StepContext, step: SequenceStep): void {
  handlerOf(step).enter(world, ctx, step);
}

/** Steps `step`, the current one. */
export function tickSequenceStep(world: World, ctx: StepContext, step: SequenceStep): void {
  handlerOf(step).tick(world, ctx, step);
}

/** Whether `step`, the current one, has nothing open: the sequence may end well when its time is up. */
export function isSequenceStepSettled(world: World, ctx: StepContext, step: SequenceStep): boolean {
  return handlerOf(step).isSettled(world, ctx, step);
}

/**
 * The handler of `step`'s kind, through the table: a kind added to the union has to be added to
 * `HANDLERS` (the type says so) and is then dispatched here with no other edit. The cast is the one
 * place TypeScript cannot correlate `step.kind` with its own step type.
 */
function handlerOf(step: SequenceStep): StepHandler<SequenceStepKind> {
  return HANDLERS[step.kind] as StepHandler<SequenceStepKind>;
}
