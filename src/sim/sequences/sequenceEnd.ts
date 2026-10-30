import type { SequenceDef } from '@content/schemas/sequence';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import type { SequenceOutcome } from '../events.ts';
import { enterFlowState } from '../flow/flowFsm.ts';
import type { World } from '../world.ts';

// How a special sequence ends (story 4.4). This file imports no threat code: `threatFsm` imports
// it (a gag in a sequence ends the sequence), and `sequenceSystem.ts` imports both.

/** The def of the planned sequence `id`, or undefined. Pure; no allocation. */
export function sequenceDefOf(ctx: StepContext, id: string | null): SequenceDef | undefined {
  if (id === null) return undefined;
  const { sequences } = ctx.level;
  for (let i = 0; i < sequences.length; i++) {
    const planned = sequences[i];
    if (planned?.id === id) return planned.def;
  }
  return undefined;
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
 * A threat was gagged (`gagThreat` calls this last, after the combo reset). No-op outside a
 * sequence, so every existing path keeps its events. In one, with `failure.kind === 'gag'`: the
 * snore (`PapaSnored`, then `BabyWoke`) if the def asks for it, `SequenceEnded{failed}`, back to
 * `playing`, then the resume.
 */
export function failSequenceOnGag(world: World, ctx: StepContext): void {
  if (world.flow.state !== 'sequence') return;
  const def = sequenceDefOf(ctx, world.sequence.id);
  if (def?.failure.hasSnore === true) {
    ctx.events.push({ type: 'PapaSnored', t: world.time.sim });
    ctx.events.push({ type: 'BabyWoke', t: world.time.sim });
  }
  closeSequence(world, ctx, 'failed');
  enterFlowState(world, 'playing');
  resumeAfterSequence(world, ctx);
}

/**
 * The level ends during a sequence (`endLevel`): `SequenceEnded{levelEnded}` first, before the
 * phone and the silence are closed. No resume and no flow change: `endLevel` goes to `ended`. A
 * no-op outside a sequence.
 */
export function endSequenceForLevelEnd(world: World, ctx: StepContext): void {
  closeSequence(world, ctx, 'levelEnded');
}
