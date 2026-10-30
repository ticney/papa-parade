import { MS_PER_S, STEP_MS } from '@shared/constants';
import { invariant } from '@shared/invariant';
import type { StepContext } from '../context.ts';
import { advanceAlongPath } from '../nav/followPath.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { gagThreat, telegraphThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';
import { ensureOnOpenCell, gazeAt, planApproach, stopCrawling } from './approach.ts';
import { enterBabyState } from './babyFsm.ts';
import { isInZone } from './zone.ts';

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

/** Whether the baby was found at this very step (`SilenceEnded{found}`): the tap that found him is spent. */
export function isBabyFoundNow(world: World, ctx: StepContext): boolean {
  const now = world.time.sim;
  for (let i = ctx.events.length - 1; i >= 0; i--) {
    const event = ctx.events[i];
    if (event?.type === 'SilenceEnded' && event.t === now && event.reason === 'found') return true;
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
 * surprise mischief (a `late` gag). A find and the deadline in one step: the find wins. The find is
 * never tested in the step that announces the silence, so `SilenceStarted` always precedes its end. Papa's
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
  invariant(
    planned !== undefined && planned.zone !== null,
    `the silence names threat ${silence.threatId}, which the level does not plan as a hidden zone`,
  );
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
    return;
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

/**
 * The level ends while a silence is open: `SilenceEnded{levelEnded}` when it had been announced (so
 * every `SilenceStarted` has its end), and the slice is emptied. A silence not yet announced just
 * stops: nobody heard it. `runFlow` calls it in the step it ends the level, before `LevelEnded`.
 */
export function endSilence(world: World, ctx: StepContext): void {
  const { silence } = world;
  if (silence.threatId === null) return;
  if (silence.startedAt !== null) {
    ctx.events.push({
      type: 'SilenceEnded',
      t: world.time.sim,
      threatId: silence.threatId,
      reason: 'levelEnded',
    });
  }
  clearSilence(world);
}
