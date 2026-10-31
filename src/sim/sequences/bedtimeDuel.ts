import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { PAPA_ASLEEP_GAG_ID } from '../threats/gags.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import type { World } from '../world.ts';
import type { BeatWindowLimits } from './beatClock.ts';
import { failSequence, plannedSequenceOf } from './sequenceEnd.ts';
import type { StepHandler } from './sequenceSteps.ts';

// « Duel du coucher » (story 4.6): the `duel` step. Papa stands still before the bed and leaves at
// the instant the baby closes his eyes. Each step is one round: a rest, then a `wait` threat
// (`bedtime_eyes`) that the sim spawns on Papa. The step does not end on time but on the threat's
// result, which two hooks of `sequenceEnd.ts` read (`advanceSequenceOnResolve`, a win; and
// `failSequenceOnGag`, a retreat). The only draw from `world.rng` is the one the telegraph makes.

/** Whether a `duel` step is the running step: the client turns a finger anywhere into the press while it is. */
export function isDuelStepRunning(world: World): boolean {
  return world.sequence.duel.isRunning;
}

/** The instance the running step spawns, or -1 (no sequence, or the step is not a `duel` step). */
export function duelThreatIndexOf(world: World, ctx: StepContext): number {
  const planned = plannedSequenceOf(ctx, world.sequence.id);
  return planned?.duelThreatIndexes[world.sequence.stepIndex] ?? -1;
}

/** `duel`: one round per step. See the file's header. */
export const DUEL_HANDLER: StepHandler<'duel'> = {
  isTimed: false,
  enter(world, _ctx, step) {
    const { duel } = world.sequence;
    duel.isRunning = true;
    duel.nextRoundAt = asSimMs(world.time.sim + step.restMs);
  },
  tick(world, ctx) {
    const { duel } = world.sequence;
    const now = world.time.sim;
    if (!duel.isRunning || duel.nextRoundAt === null || now < duel.nextRoundAt) return;
    const index = duelThreatIndexOf(world, ctx);
    const threat = world.threats[index];
    const planned = ctx.level.threats[index];
    if (threat === undefined || planned === undefined) return;
    // Judged before the level's end, not the sequence's: the sequence's end is only an estimate here.
    // A round that cannot fit any more loses the duel (`SequenceEnded{failed}`, no `BabyWoke`): left
    // alone, the step would hold Papa and the carried baby, with no threat, until the level ends.
    if (!isJudgeableBeforeEnd(world, ctx, planned.def, now)) {
      failSequence(world, ctx);
      return;
    }
    // The instance may still be in its cooldown after the last round: the round waits for it.
    if (threat.state !== 'idle') return;
    telegraphThreat(world, ctx, threat, planned.def, -1);
    duel.nextRoundAt = null;
  },
  // A duel is won by a result only (`advanceSequenceOnResolve`): waiting past `endsAt` must never win it.
  isSettled() {
    return false;
  },
};

/** What {@link sequenceDuelProblems} reads of a threat def (a `ThreatDef` of the content fits it). */
export interface DuelThreatShape {
  readonly response: string;
  readonly target: string;
  readonly cooldownMs: number;
  readonly telegraphDelayMs: number | null;
  readonly maxDelayMs?: number;
  readonly windowMs: number | null;
  readonly gag?: string;
  readonly surpriseGags?: readonly string[];
}

/** The part of a sequence def {@link sequenceDuelProblems} reads (a `SequenceDef` of the content fits it). */
export interface DuelDefShape {
  readonly failure: { readonly kind: string };
  readonly steps: readonly (
    | { readonly kind: 'microSleeps' }
    | { readonly kind: 'beats' }
    | {
        readonly kind: 'duel';
        readonly durationMs: number;
        readonly threatDef: string;
        readonly restMs: number;
      }
  )[];
}

/** What decides how long a round can take: the beats' limits, and the feel's defaults for a def that sets none. */
export interface DuelLimits extends BeatWindowLimits {
  readonly windowMs: number;
  readonly telegraphDelayDefaultMs: number;
}

/** The {@link DuelLimits} of a feel (the shape `Feel` fits). */
export function duelLimitsOf(feel: {
  readonly timing: {
    readonly toleranceMs: number;
    readonly windowMs: number;
    readonly telegraphDelayDefaultMs: number;
  };
  readonly difficulty: Readonly<Record<string, { readonly windowMultiplier: number }>>;
}): DuelLimits {
  return {
    maxWindowMultiplier: Math.max(
      ...Object.values(feel.difficulty).map((tier) => tier.windowMultiplier),
    ),
    toleranceMs: feel.timing.toleranceMs,
    windowMs: feel.timing.windowMs,
    telegraphDelayDefaultMs: feel.timing.telegraphDelayDefaultMs,
  };
}

/**
 * What is wrong with the duel steps of a sequence def, each as a sentence that follows « the
 * sequence "<id>" »: `content:check` and `simLevelOf` both call it, so they refuse the same things
 * with the same words. `threatDefs` are the loaded threat defs by id; `limits` is the widest a window
 * gets. Pure: no zod and no `@content` runtime import.
 */
export function sequenceDuelProblems(
  def: DuelDefShape,
  threatDefs: Readonly<Record<string, DuelThreatShape>>,
  limits: DuelLimits,
): string[] {
  const problems: string[] = [];
  // A duel ends on its result and a `retreats` failure steps back into a duel: the two go together.
  // The zod schema says the same; this is for a def that did not go through it (a hand-built bundle).
  const duelCount = def.steps.filter((step) => step.kind === 'duel').length;
  if (duelCount > 0 && def.failure.kind !== 'retreats') {
    problems.push(`has a duel step, so its failure must be "retreats", not "${def.failure.kind}"`);
  }
  if (def.failure.kind === 'retreats') {
    if (duelCount === 0) {
      problems.push('has a "retreats" failure, but no duel step to step back from');
    }
    def.steps.forEach((step, j) => {
      if (step.kind !== 'duel') {
        problems.push(
          `has a "retreats" failure, so every step must be a duel (steps[${j}] is a "${step.kind}" step)`,
        );
      }
    });
  }
  def.steps.forEach((step, j) => {
    if (step.kind !== 'duel') return;
    const where = `has a duel step (steps[${j}])`;
    const threat = Object.hasOwn(threatDefs, step.threatDef)
      ? threatDefs[step.threatDef]
      : undefined;
    if (threat === undefined) {
      problems.push(`${where} whose threatDef "${step.threatDef}" is not loaded`);
      return;
    }
    if (threat.response !== 'wait') {
      problems.push(
        `${where} whose threatDef "${step.threatDef}" has the response "${threat.response}", but a duel asks for "wait"`,
      );
    }
    if (threat.target !== 'papa') {
      problems.push(
        `${where} whose threatDef "${step.threatDef}" has the target "${threat.target}", but a duel threat stands on Papa (target "papa")`,
      );
    }
    const gags = threat.gag === undefined ? (threat.surpriseGags ?? []) : [threat.gag];
    if (gags.includes(PAPA_ASLEEP_GAG_ID)) {
      problems.push(
        `${where} whose threatDef "${step.threatDef}" has the gag "${PAPA_ASLEEP_GAG_ID}", which is the micro-sleep's alone`,
      );
    }
    // The next round waits for the rest and for the threat to be idle again, whichever is longer.
    const neededMs =
      Math.max(step.restMs, threat.cooldownMs) +
      (threat.telegraphDelayMs ?? limits.telegraphDelayDefaultMs) +
      (threat.maxDelayMs ?? 0) +
      (threat.windowMs ?? limits.windowMs) * limits.maxWindowMultiplier +
      limits.toleranceMs;
    if (step.durationMs < neededMs) {
      problems.push(
        `${where} with a durationMs of ${step.durationMs}, below the ${neededMs} ms a round can take (the longer of restMs and the threat's cooldownMs + telegraph + longest wait + window at the widest tier + tolerance)`,
      );
    }
  });
  return problems;
}
