import { MS_PER_S, STEP_MS } from '@shared/constants';
import { invariant } from '@shared/invariant';
import type { SimHiddenZone, StepContext } from '../context.ts';
import { advanceAlongPath } from '../nav/followPath.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { gagThreat, telegraphThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';
import { ensureOnOpenCell, gazeAt, planApproach, stopCrawling } from './approach.ts';
import { enterBabyState } from './babyFsm.ts';

function isInZone(zone: SimHiddenZone, xM: number, zM: number): boolean {
  return Math.abs(xM - zone.centerXM) <= zone.halfXM && Math.abs(zM - zone.centerZM) <= zone.halfZM;
}

/** Index of the `hidden` threat the baby has not taken yet, or -1. */
function hiddenThreatIndex(world: World): number {
  for (let i = 0; i < world.threats.length; i++) {
    if ((world.threats[i] as ThreatInstance).state === 'hidden') return i;
  }
  return -1;
}

function indexOfThreat(world: World, threatId: number): number {
  for (let i = 0; i < world.threats.length; i++) {
    if ((world.threats[i] as ThreatInstance).id === threatId) return i;
  }
  return -1;
}

/** Whether a `TapBaby` was applied at this step and Papa can act on it (a busy Papa answers nothing). */
function isBabyTapped(world: World, ctx: StepContext): boolean {
  const { papa } = world;
  if (isPapaBusy(papa) && world.time.sim < papa.busyUntil) return false;
  for (let i = 0; i < ctx.commands.length; i++) {
    if (ctx.commands[i]?.type === 'TapBaby') return true;
  }
  return false;
}

/** Ends the silence: the baby babbles again and the slice is empty. The caller has emitted `SilenceEnded`. */
function clearSilence(world: World): void {
  world.baby.babbling = true;
  world.silence.threatId = null;
  world.silence.zoneEnteredAt = null;
  world.silence.startedAt = null;
}

/**
 * The suspicious silence (story 1.21), run first by `runBaby`, in this order: take a `hidden`
 * threat and set off for its zone; sneak there at `sneakSpeedMps`, going quiet on entering the box
 * (the babble stops: the sound telegraph); announce the silence once the baby has been quiet for
 * `silenceAlertMs`; find the baby (Papa inside the box, or a `TapBaby` this step, Papa not busy)
 * and reveal the threat with a normal telegraph; or, when `findMaxMs` has run out, play the
 * surprise mischief (a `late` gag). A find and the deadline in one step: the find wins. Papa's
 * point is the one at the end of the previous step (`runPapa` runs later). It writes the baby only
 * through `enterBabyState` and its own fields, the threat only through the `threatFsm` helpers.
 */
export function runSilence(world: World, ctx: StepContext): void {
  const { baby, silence } = world;
  const now = world.time.sim;

  if (silence.threatId === null) {
    const hiddenIndex = hiddenThreatIndex(world);
    if (hiddenIndex < 0) return;
    const threat = world.threats[hiddenIndex] as ThreatInstance;
    silence.threatId = threat.id;
    baby.targetThreatId = threat.id;
    stopCrawling(world);
    ensureOnOpenCell(world, ctx);
    invariant(
      planApproach(baby, ctx.nav.baby, threat.xM, threat.zM),
      `the baby has no path to the hidden zone of threat ${threat.defId}`,
    );
    enterBabyState(world, ctx, 'mischiefSilent');
  }

  const index = indexOfThreat(world, silence.threatId as number);
  const planned = ctx.level.threats[index];
  if (index < 0 || planned === undefined || planned.zone === null) return;
  const threat = world.threats[index] as ThreatInstance;
  const { zone } = planned;
  const def = planned.def;

  // Sneak: crawl until inside the box, then sit quiet.
  if (silence.zoneEnteredAt === null) {
    const budgetM = (ctx.feel.baby.sneakSpeedMps * STEP_MS) / MS_PER_S;
    const isArrived = advanceAlongPath(baby, budgetM);
    baby.gazeX = baby.headingX;
    baby.gazeZ = baby.headingZ;
    if (isArrived || isInZone(zone, baby.xM, baby.zM)) {
      stopCrawling(world);
      gazeAt(baby, zone.centerXM, zone.centerZM);
      baby.babbling = false;
      silence.zoneEnteredAt = now;
    }
    return;
  }

  // Alert: the baby has been quiet long enough.
  if (silence.startedAt === null) {
    if (now < silence.zoneEnteredAt + ctx.feel.baby.silenceAlertMs) return;
    silence.startedAt = now;
    ctx.events.push({ type: 'SilenceStarted', t: now, threatId: threat.id });
  }

  // Find: Papa walked in, or the player tapped the baby.
  if (isInZone(zone, world.papa.xM, world.papa.zM) || isBabyTapped(world, ctx)) {
    ctx.events.push({ type: 'SilenceEnded', t: now, threatId: threat.id, reason: 'found' });
    clearSilence(world);
    stopCrawling(world);
    gazeAt(baby, threat.xM, threat.zM);
    enterBabyState(world, ctx, 'targetLocked');
    telegraphThreat(world, ctx, threat, def, threat.waveIndex);
    return;
  }

  // Deadline: nobody came, the surprise mischief.
  if (def.target === 'hiddenZone' && now >= silence.startedAt + def.findMaxMs) {
    ctx.events.push({ type: 'SilenceEnded', t: now, threatId: threat.id, reason: 'timedOut' });
    clearSilence(world);
    gagThreat(world, ctx, threat, def, 'late', null);
  }
}
