import { MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import { isBabyCarried } from '../baby/babyFsm.ts';
import type { StepContext } from '../context.ts';
import { heldFirmnessClearAt } from '../director/fairness.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import type { World } from '../world.ts';
import { addFatigue, drawMicroSleepMs } from './fatigue.ts';

/**
 * Papa's fatigue for one step (story 1.19; architecture's `runFatigue`). It lives apart from
 * `fatigue.ts` because it telegraphs a threat and the threat FSM reads the fatigue helpers.
 *
 * A level with no fatigue gauge does nothing. Otherwise: add the step's gain (`perSec`, times
 * `carriedMultiplier` while carrying the baby); keep the micro-sleep instance on Papa; and, when
 * a micro-sleep is due, telegraph it at the first step where the instance is `idle`, Papa is not busy
 * (`drink` / `asleep` / `onPhone` / `onToilet`) and the flow is `playing`, and not so late that it could not be judged before
 * the level ends (its delay, window and tolerance). The next one is due `microSleepMinMs…MaxMs` after
 * that **telegraph** (one draw). Allocation-free.
 */
export function runFatigue(world: World, ctx: StepContext): void {
  const index = ctx.level.microSleepIndex;
  if (index < 0) return;
  const { gauges, papa } = world;
  const { perSec, carriedMultiplier } = ctx.feel.fatigue;
  const multiplier = isBabyCarried(world) ? carriedMultiplier : 1;
  addFatigue(world, ctx, (perSec * multiplier * STEP_MS) / MS_PER_S);

  const threat = world.threats[index];
  const planned = ctx.level.threats[index];
  if (threat === undefined || planned === undefined) return;
  // The instance stands on Papa, wherever he walks.
  threat.xM = papa.xM;
  threat.zM = papa.zM;

  const now = world.time.sim;
  if (gauges.microSleepAt === null || now < gauges.microSleepAt) return;
  if (threat.state !== 'idle' || isPapaBusy(papa) || world.flow.state !== 'playing') return;
  // Its window keeps clear of a Firmness Papa holds (story 9.7): his finger cannot be on both. Nothing
  // else moves it, and with no such Firmness in the level the postponement is always 0.
  const naturalAt = now + (planned.def.telegraphDelayMs ?? ctx.feel.timing.telegraphDelayDefaultMs);
  const postponeMs = heldFirmnessClearAt(world, ctx, naturalAt) - naturalAt;
  // One that could not be judged before the end would show a telegraph that never resolves.
  if (!isJudgeableBeforeEnd(world, ctx, planned.def, now + postponeMs)) return;
  telegraphThreat(world, ctx, threat, planned.def, -1, postponeMs);
  gauges.microSleepAt = asSimMs(now + drawMicroSleepMs(world, ctx));
}
