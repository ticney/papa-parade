import { sequenceDurationMs } from '@content/schemas/sequence';
import { asSimMs } from '@shared/time';
import { isBabyCarried, isSilenceUnderway } from '../baby/babyFsm.ts';
import { stopPapa, takeBaby } from '../baby/carry.ts';
import type { StepContext } from '../context.ts';
import { enterFlowState } from '../flow/flowFsm.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { cancelThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';
import { sequenceDefOf } from './sequenceEnd.ts';
import { enterSequenceStep } from './sequenceSteps.ts';

/** Why a sequence cannot start now. */
export type SequenceRefusal = 'running' | 'ended' | 'papaBusy' | 'silence';

/**
 * Why a sequence cannot start now, or null (story 4.4 D6): one is already under way (`running`),
 * the level is over (`ended`), Papa is busy with a coffee, a nap, a call or the toilet
 * (`papaBusy`), or the baby is hiding in a suspicious silence (`silence`: `takeBaby` has no rule
 * for it). Pure and exported: the debug overlay says the reason in plain English.
 */
export function sequenceRefusal(world: World): SequenceRefusal | null {
  if (world.flow.state === 'sequence') return 'running';
  if (world.flow.state === 'ended') return 'ended';
  if (isPapaBusy(world.papa)) return 'papaBusy';
  if (isSilenceUnderway(world)) return 'silence';
  return null;
}

/**
 * Starts the sequence `sequenceId` now (`StartSequence`). Refused with no event, as `ForceThreat`,
 * for an id the level does not plan or when {@link sequenceRefusal} says so. Otherwise, in order:
 * the flow enters `sequence`; Papa stops; every threat that is announced or open is cancelled,
 * the ones on Papa too (`ThreatCancelled{sequence}`: no gag, a clean slate for the sequence's own
 * cadence); a `babyCarried` sequence takes a baby who is not in the arms, wherever he is (D6); the
 * slice is written; `SequenceStarted`, `SequenceStepStarted{0}` and the first step's entry.
 */
export function startSequence(world: World, ctx: StepContext, sequenceId: string): void {
  const def = sequenceDefOf(ctx, sequenceId);
  if (def === undefined || sequenceRefusal(world) !== null) return;
  const now = world.time.sim;

  enterFlowState(world, 'sequence');
  stopPapa(world, ctx);
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as ThreatInstance;
    if (threat.state === 'telegraph' || threat.state === 'windowOpen') {
      cancelThreat(world, ctx, threat, 'sequence');
    }
  }
  if (def.babyCarried && !isBabyCarried(world)) takeBaby(world, ctx);

  const { sequence } = world;
  const first = def.steps[0];
  if (first === undefined) return;
  sequence.id = sequenceId;
  sequence.lastId = sequenceId;
  sequence.startedAt = now;
  sequence.endsAt = asSimMs(now + sequenceDurationMs(def));
  sequence.endedAt = null;
  sequence.stepIndex = 0;
  sequence.stepEndsAt = asSimMs(now + first.durationMs);
  sequence.nextMicroSleepAt = null;
  ctx.events.push({ type: 'SequenceStarted', t: now, id: sequenceId });
  ctx.events.push({ type: 'SequenceStepStarted', t: now, id: sequenceId, stepIndex: 0 });
  enterSequenceStep(world, ctx, first);
}
