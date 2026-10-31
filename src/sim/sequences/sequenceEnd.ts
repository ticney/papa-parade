import type { SequenceDef } from '@content/schemas/sequence';
import { asSimMs } from '@shared/time';
import type { SimSequence, StepContext } from '../context.ts';
import type { FailReason, SequenceOutcome } from '../events.ts';
import { enterFlowState } from '../flow/flowFsm.ts';
import { clearBeatSlice, clearDuelSlice, type ThreatInstance, type World } from '../world.ts';

// How a special sequence ends (story 4.4). This file imports no threat code: `threatFsm` imports
// it (a gag in a sequence ends the sequence), and `sequenceSystem.ts` imports both.

/** The planned sequence `id` (its def and what is built from it), or undefined. Pure; no allocation. */
export function plannedSequenceOf(ctx: StepContext, id: string | null): SimSequence | undefined {
  if (id === null) return undefined;
  const { sequences } = ctx.level;
  for (let i = 0; i < sequences.length; i++) {
    const planned = sequences[i];
    if (planned?.id === id) return planned;
  }
  return undefined;
}

/** The def of the planned sequence `id`, or undefined. Pure; no allocation. */
export function sequenceDefOf(ctx: StepContext, id: string | null): SequenceDef | undefined {
  return plannedSequenceOf(ctx, id)?.def;
}

/**
 * Writes the end of the running sequence: `SequenceEnded{outcome}`, `id` back to null, `lastId` and
 * `endedAt` kept for the client's camera. Does not touch the flow. A no-op outside a sequence.
 */
function closeSequence(world: World, ctx: StepContext, outcome: SequenceOutcome): void {
  const { sequence } = world;
  const id = sequence.id;
  if (id === null) return;
  ctx.events.push({ type: 'SequenceEnded', t: world.time.sim, id, outcome });
  sequence.id = null;
  sequence.lastId = id;
  sequence.endedAt = world.time.sim;
  sequence.stepIndex = 0;
  sequence.nextMicroSleepAt = null;
  clearBeatSlice(sequence.beat);
  clearDuelSlice(sequence.duel);
}

/**
 * The breath after a sequence (D5): the director, a due micro-sleep and a due cry in the arms each
 * wait at least `feel.sequences.resumeGapMs` from now. Clocks are only pushed, never redrawn, so
 * the rng does not depend on the tuning. Never pulls a clock earlier.
 */
function resumeAfterSequence(world: World, ctx: StepContext): void {
  const resumeAt = world.time.sim + ctx.feel.sequences.resumeGapMs;
  const { director, gauges, carry } = world;
  if (director.nextAt < resumeAt) director.nextAt = asSimMs(resumeAt);
  if (gauges.microSleepAt !== null && gauges.microSleepAt < resumeAt) {
    gauges.microSleepAt = asSimMs(resumeAt);
  }
  if (carry.armsCryAt !== null && carry.armsCryAt < resumeAt) carry.armsCryAt = asSimMs(resumeAt);
}

/** The sequence was won: `SequenceEnded{succeeded}`, back to `playing`, then the resume. */
export function succeedSequence(world: World, ctx: StepContext): void {
  if (world.flow.state !== 'sequence') return;
  closeSequence(world, ctx, 'succeeded');
  enterFlowState(world, 'playing');
  resumeAfterSequence(world, ctx);
}

/**
 * The sequence was lost: `SequenceEnded{failed}`, back to `playing`, then the resume. The end both
 * kinds of failure share (the gag's and the baby waking); each emits its own events first. A no-op
 * outside a sequence.
 */
export function failSequence(world: World, ctx: StepContext): void {
  if (world.flow.state !== 'sequence') return;
  closeSequence(world, ctx, 'failed');
  enterFlowState(world, 'playing');
  resumeAfterSequence(world, ctx);
}

/**
 * Whether `threat` is the instance the running step of a `retreats` sequence spawned: the only one
 * the two hooks below care about (story 4.6). Pure; no allocation.
 */
function isCurrentDuelThreat(world: World, ctx: StepContext, threat: ThreatInstance): boolean {
  const planned = plannedSequenceOf(ctx, world.sequence.id);
  if (planned === undefined || planned.def.failure.kind !== 'retreats') return false;
  const index = planned.duelThreatIndexes[world.sequence.stepIndex];
  return index !== undefined && index !== null && world.threats[index] === threat;
}

/**
 * Enters the step `index` of a `retreats` sequence without the clock (story 4.6; `sequenceSteps.ts`
 * is not imported here, it would be a cycle through `threatFsm`): `stepIndex`, `stepEndsAt` (now plus
 * the step's `durationMs`), `endsAt` (that plus the later steps), the next round after the step's
 * `restMs`, and `SequenceStepStarted`. `endsAt` is an estimate that nothing reads but the snapshot's
 * `startedAt <= stepEndsAt <= endsAt` check. The duel slice keeps its `retreats`.
 */
export function goToSequenceStep(
  world: World,
  ctx: StepContext,
  def: SequenceDef,
  index: number,
): void {
  const step = def.steps[index];
  const { sequence } = world;
  const { id } = sequence;
  if (step === undefined || step.kind !== 'duel' || id === null) return;
  const now = world.time.sim;
  sequence.stepIndex = index;
  sequence.stepEndsAt = asSimMs(now + step.durationMs);
  let endsAt: number = sequence.stepEndsAt;
  for (let i = index + 1; i < def.steps.length; i++) {
    endsAt += (def.steps[i] as { durationMs: number }).durationMs;
  }
  sequence.endsAt = asSimMs(endsAt);
  sequence.duel.nextRoundAt = asSimMs(now + step.restMs);
  ctx.events.push({ type: 'SequenceStepStarted', t: now, id, stepIndex: index });
}

/**
 * A threat was resolved (`resolveThreat` calls this last, after the combo). A no-op outside a
 * `retreats` sequence and for any threat other than the current step's. Otherwise the duel round is
 * won: the next step, or, after the last one, {@link succeedSequence}. The baby stays carried.
 */
export function advanceSequenceOnResolve(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
): void {
  if (world.flow.state !== 'sequence' || !isCurrentDuelThreat(world, ctx, threat)) return;
  const def = sequenceDefOf(ctx, world.sequence.id);
  if (def === undefined) return;
  const next = world.sequence.stepIndex + 1;
  if (next < def.steps.length) goToSequenceStep(world, ctx, def, next);
  else succeedSequence(world, ctx);
}

/**
 * A threat was gagged (`gagThreat` calls this last, after the combo reset). No-op outside a
 * sequence, so every existing path keeps its events, and in a sequence whose failure is not a
 * `gag` or `retreats` (the lullaby walk: only the baby waking ends it). With `failure.kind ===
 * 'gag'`: the snore (`PapaSnored`, then `BabyWoke`) if the def asks for it, then
 * {@link failSequence}. With `retreats` (story 4.6), for the current duel threat only, every gag
 * (`early`, `late` and `wrongResponse` alike) counts: below `maxRetreats` the sequence steps back
 * (`SequenceStepRetreated`, then the previous step; step 0 stays at step 0); at `maxRetreats` the
 * baby wakes (`BabyWoke`, no `SequenceStepRetreated`) and {@link failSequence} ends it.
 */
export function failSequenceOnGag(
  world: World,
  ctx: StepContext,
  threat: ThreatInstance,
  reason: FailReason,
): void {
  if (world.flow.state !== 'sequence') return;
  const def = sequenceDefOf(ctx, world.sequence.id);
  const failure = def?.failure;
  if (def === undefined || failure === undefined) return;
  if (failure.kind === 'retreats') {
    if (!isCurrentDuelThreat(world, ctx, threat)) return;
    const { sequence } = world;
    const { id } = sequence;
    if (id === null) return;
    sequence.duel.retreats += 1;
    if (sequence.duel.retreats >= failure.maxRetreats) {
      ctx.events.push({ type: 'BabyWoke', t: world.time.sim });
      failSequence(world, ctx);
      return;
    }
    const fromStepIndex = sequence.stepIndex;
    ctx.events.push({
      type: 'SequenceStepRetreated',
      t: world.time.sim,
      id,
      fromStepIndex,
      stepIndex: Math.max(0, fromStepIndex - 1),
      retreats: sequence.duel.retreats,
      reason,
    });
    goToSequenceStep(world, ctx, def, Math.max(0, fromStepIndex - 1));
    return;
  }
  if (failure.kind !== 'gag') return;
  if (failure.hasSnore) {
    ctx.events.push({ type: 'PapaSnored', t: world.time.sim });
    ctx.events.push({ type: 'BabyWoke', t: world.time.sim });
  }
  failSequence(world, ctx);
}

/**
 * The level ends during a sequence (`endLevel`): `SequenceEnded{levelEnded}` first, before the
 * phone and the silence are closed. No resume and no flow change: `endLevel` goes to `ended`. A
 * no-op outside a sequence.
 */
export function endSequenceForLevelEnd(world: World, ctx: StepContext): void {
  closeSequence(world, ctx, 'levelEnded');
}
