import { MAX_CRAWL_SPEED_MPS, MS_PER_S, STEP_MS } from '@shared/constants';
import { asSimMs } from '@shared/time';
import type { StepContext } from '../context.ts';
import { isThreatActive } from '../director/waveState.ts';
import { advanceAlongPath } from '../nav/followPath.ts';
import { remainingPathLengthM } from '../nav/pathLength.ts';
import type { ThreatInstance, World } from '../world.ts';
import { ensureOnOpenCell, gazeAt, planApproach, stopCrawling } from './approach.ts';
import { enterBabyState } from './babyFsm.ts';
import { runCarry } from './carry.ts';
import { runBabyCry } from './cry.ts';
import { runSilence } from './silence.ts';
import { drawBabbleMs, pickWanderCell, planWander } from './wander.ts';

function findThreat(world: World, id: number): ThreatInstance | undefined {
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as ThreatInstance;
    if (threat.id === id) return threat;
  }
  return undefined;
}

/**
 * How fast the baby crawls to a threat (D14): `approachSpeedMps` at least, faster when it must be
 * at the target by the opening of the window, never faster than the cap. The arrival is
 * choreography only: nothing is judged on it.
 */
function approachSpeedMps(world: World, ctx: StepContext, threat: ThreatInstance): number {
  const remainingMs = threat.windowOpenAt - world.time.sim;
  if (remainingMs <= 0) return MAX_CRAWL_SPEED_MPS;
  const neededMps = remainingPathLengthM(world.baby) / (remainingMs / MS_PER_S);
  return Math.min(Math.max(ctx.feel.baby.approachSpeedMps, neededMps), MAX_CRAWL_SPEED_MPS);
}

/** Rule 1: the threat the baby locked on is over; the baby plays its gag or goes back to babbling. */
function releaseTarget(world: World, ctx: StepContext): void {
  const { baby } = world;
  if (baby.targetThreatId === null) return;
  const threat = findThreat(world, baby.targetThreatId);
  if (threat !== undefined && isThreatActive(threat)) return;
  // A mischief is played out to its end (rule 5), even if a short cooldown has rearmed the threat.
  if (baby.state === 'act') return;
  if (threat !== undefined && threat.state === 'gag') {
    stopCrawling(world);
    enterBabyState(world, ctx, 'act');
    return;
  }
  baby.targetThreatId = null;
  stopCrawling(world);
  baby.wanderAt = asSimMs(world.time.sim + drawBabbleMs(world, ctx));
  enterBabyState(world, ctx, 'babble');
}

/** Rule 2: a free baby stares at the first active threat (the telegraph). */
function lockOnThreat(world: World, ctx: StepContext): void {
  const { baby } = world;
  if (baby.targetThreatId !== null) return;
  if (baby.state !== 'wander' && baby.state !== 'babble') return;
  for (let i = 0; i < world.threats.length; i++) {
    const threat = world.threats[i] as ThreatInstance;
    if (!isThreatActive(threat) || threat.state === 'hidden') continue;
    // A threat on Papa (the micro-sleep, story 1.19) is not the baby's business, and a silence is
    // taken by `runSilence`, not locked on (story 1.21).
    const target = ctx.level.threats[i]?.def.target;
    if (target === 'papa' || target === 'hiddenZone') continue;
    baby.targetThreatId = threat.id;
    stopCrawling(world);
    gazeAt(baby, threat.xM, threat.zM);
    enterBabyState(world, ctx, 'targetLocked');
    return;
  }
}

/**
 * System: the baby. Remembers where it sat (for the view's interpolation), then, in this order:
 * ticks its cry (`runBabyCry`, story 3.1), runs the suspicious silence (`runSilence`, story 1.21), does nothing but the cry in the arms while carried (`runCarry`, story 4.1), lets go of a target that is over, locks on a newly active threat, sets off to its target once it
 * has stared for `lockMs`, crawls to it, ends its mischief after `actMs`; and, when it is free,
 * does what it did before threats existed: when its babble is over (`wanderAt`) draws a
 * destination and sets off, or, if none can be planned, babbles on for another draw; while
 * wandering crawls `crawlSpeedMps` for one step, its gaze following its heading, and babbles again
 * on arrival. The feel is read each step, so a changed one applies at once.
 */
export function runBaby(world: World, ctx: StepContext): void {
  const { baby } = world;
  const { baby: feel } = ctx.feel;
  baby.prevXM = baby.xM;
  baby.prevZM = baby.zM;

  runBabyCry(world, ctx);
  runSilence(world, ctx);
  // A carried baby is inert (story 4.1 D4): he never wanders, locks on a threat or lets go of Papa.
  if (baby.state === 'carried') {
    runCarry(world, ctx);
    return;
  }
  releaseTarget(world, ctx);
  lockOnThreat(world, ctx);

  if (baby.targetThreatId !== null) {
    const threat = findThreat(world, baby.targetThreatId);
    if (threat !== undefined) {
      if (baby.state === 'targetLocked' && world.time.sim >= baby.enteredAt + feel.lockMs) {
        ensureOnOpenCell(world, ctx);
        // No path (another region): the baby stays where it is, staring, in `approach`.
        if (planApproach(baby, ctx.nav.baby, threat.xM, threat.zM)) {
          baby.approachSpeedMps = approachSpeedMps(world, ctx, threat);
        }
        enterBabyState(world, ctx, 'approach');
      }
      if (baby.state === 'approach' && baby.path.length > 0) {
        const budgetM = (baby.approachSpeedMps * STEP_MS) / MS_PER_S;
        if (advanceAlongPath(baby, budgetM)) stopCrawling(world);
      }
      if (baby.state === 'targetLocked' || baby.state === 'approach') {
        gazeAt(baby, threat.xM, threat.zM);
      }
    }
  }

  if (baby.state === 'act' && world.time.sim >= baby.enteredAt + feel.actMs) {
    baby.targetThreatId = null;
    baby.wanderAt = asSimMs(world.time.sim + drawBabbleMs(world, ctx));
    enterBabyState(world, ctx, 'babble');
  }

  if (baby.state === 'babble' && world.time.sim >= baby.wanderAt) {
    ensureOnOpenCell(world, ctx);
    const cell = pickWanderCell(
      ctx.nav.baby,
      baby.xM,
      baby.zM,
      feel.wanderMinDistM,
      feel.wanderMaxDistM,
      world.rng,
    );
    if (cell >= 0 && planWander(baby, ctx.nav.baby, cell)) {
      enterBabyState(world, ctx, 'wander');
    } else {
      baby.wanderAt = asSimMs(world.time.sim + drawBabbleMs(world, ctx));
    }
  }

  if (baby.state === 'wander') {
    const isArrived = advanceAlongPath(baby, (feel.crawlSpeedMps * STEP_MS) / 1000);
    baby.gazeX = baby.headingX;
    baby.gazeZ = baby.headingZ;
    if (isArrived) {
      baby.path.length = 0;
      baby.pathIndex = 0;
      baby.wanderAt = asSimMs(world.time.sim + drawBabbleMs(world, ctx));
      enterBabyState(world, ctx, 'babble');
    }
  }
}
