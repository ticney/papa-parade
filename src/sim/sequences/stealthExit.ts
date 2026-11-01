import type { LevelGeometry } from '@content/schemas/levelGeometry';
import type { StealthStep } from '@content/schemas/sequence';
import type { ThreatDef } from '@content/schemas/threat';
import { MS_PER_S, STEP_MS } from '@shared/constants';
import { nextFloat } from '@shared/rng';
import { asSimMs } from '@shared/time';
import { ensureOnOpenCell, stopCrawling } from '../baby/approach.ts';
import { enterBabyState, isBabyCarried } from '../baby/babyFsm.ts';
import { isInSafeZone, putDownBaby } from '../baby/carry.ts';
import { isInZone } from '../baby/zone.ts';
import type { SimStealthStep, StepContext } from '../context.ts';
import type { BreathGaspReason } from '../events.ts';
import { createNavGrid, type NavGrid } from '../nav/navGrid.ts';
import { isPapaBusy } from '../papa/papaFsm.ts';
import { PAPA_ASLEEP_GAG_ID } from '../threats/gags.ts';
import { isJudgeableBeforeEnd } from '../threats/judgeable.ts';
import { telegraphThreat } from '../threats/threatFsm.ts';
import type { ThreatInstance, World } from '../world.ts';
import type { DuelLimits } from './bedtimeDuel.ts';
import { plannedSequenceOf, succeedSequence } from './sequenceEnd.ts';
import type { StepHandler } from './sequenceSteps.ts';

// « Sortie en infiltration » (story 4.9): the `stealth` step. Papa sneaks to the exit of the room
// while the baby sleeps. Every few seconds an alert comes: a false alarm (a `nothing` threat: sit it
// through, holding your breath, never touch him) or a real wake (a `parry`: rock him, from wherever
// you are). A creaking board costs noise; so does a breath let out. The step ends on Papa's exit,
// never on its time, and a gag of either alert ends the sequence (`failSequenceOnGag`). It owns the
// `StealthSlice`; **no code outside this file reads `realWakePct`**, and an alert draws exactly two
// floats from `world.rng` (the kind, then the wait for the next one), whatever the tuning.

/** Whether a `stealth` step is the running step: the client turns a finger held on the floor into the breath while it is. */
export function isStealthStepRunning(world: World): boolean {
  return world.sequence.stealth.isRunning;
}

/** The two instances and the exit of the running step, or null (no sequence, or not a `stealth` step). */
function stealthStepOf(world: World, ctx: StepContext): SimStealthStep | null {
  const planned = plannedSequenceOf(ctx, world.sequence.id);
  return planned?.stealthThreatIndexes[world.sequence.stepIndex] ?? null;
}

/** The index of the first creak zone that holds the point, or -1. Pure. */
function creakZoneIndexAt(ctx: StepContext, xM: number, zM: number): number {
  const { creakZones } = ctx.level;
  for (let i = 0; i < creakZones.length; i++) {
    const zone = creakZones[i];
    if (zone !== undefined && isInZone(zone, xM, zM)) return i;
  }
  return -1;
}

/** When the next alert is due: `alertGapMinMs…alertGapMaxMs` from now, with exactly one `nextFloat`. */
function drawAlertAt(world: World, step: StealthStep) {
  return asSimMs(
    world.time.sim +
      Math.round(
        step.alertGapMinMs + nextFloat(world.rng) * (step.alertGapMaxMs - step.alertGapMinMs),
      ),
  );
}

/**
 * A gasp. Inside a false alarm's window (the critical passage, D8) there is at most one per passage:
 * the first pays, the others are silent. Outside a passage every gasp counts.
 */
function gasp(
  world: World,
  ctx: StepContext,
  reason: BreathGaspReason,
  isInPassage: boolean,
): void {
  const { stealth } = world.sequence;
  if (isInPassage) {
    if (stealth.isPassagePaid) return;
    stealth.isPassagePaid = true;
  }
  ctx.events.push({ type: 'BreathGasped', t: world.time.sim, reason });
}

/** Whether an alert is up: announced or open, either instance. */
function isAlertUp(falseAlarm: ThreatInstance, realWake: ThreatInstance): boolean {
  return (
    falseAlarm.state === 'telegraph' ||
    falseAlarm.state === 'windowOpen' ||
    realWake.state === 'telegraph' ||
    realWake.state === 'windowOpen'
  );
}

/**
 * The start of a stealth sequence (story 4.9, D6), after Papa has been placed over the mattress and
 * the threats cancelled: the baby sleeps in a safe zone. A carried baby is put down; one who is not in
 * a safe zone is moved to the centre of the nearest, with no path, no draw and no event but his
 * state, his crawl and target cleared, babbling. Whatever is already true is skipped, so a chain
 * (4.10) that starts with the baby in his crib moves nothing. A level with no safe zone (the level
 * checks refuse it) leaves him where he is.
 */
export function placeBabyForStealth(world: World, ctx: StepContext): void {
  const { baby } = world;
  if (isBabyCarried(world)) putDownBaby(world, ctx);
  if (isInSafeZone(ctx, baby.xM, baby.zM)) return;
  const { safeZones } = ctx.level;
  let best = -1;
  let bestSq = Number.POSITIVE_INFINITY;
  for (let i = 0; i < safeZones.length; i++) {
    const zone = safeZones[i];
    if (zone === undefined) continue;
    const dx = zone.centerXM - baby.xM;
    const dz = zone.centerZM - baby.zM;
    const distanceSq = dx * dx + dz * dz;
    if (distanceSq < bestSq) {
      bestSq = distanceSq;
      best = i;
    }
  }
  const target = safeZones[best];
  if (target === undefined) return;
  stopCrawling(world);
  baby.targetThreatId = null;
  baby.xM = target.centerXM;
  baby.zM = target.centerZM;
  ensureOnOpenCell(world, ctx);
  // The jump is not a crawl: the view must not slide him across the room between two steps.
  baby.prevXM = baby.xM;
  baby.prevZM = baby.zM;
  baby.babbling = true;
  enterBabyState(world, ctx, 'babble');
}

/** `stealth`: the crossing. See the file's header. */
export const STEALTH_HANDLER: StepHandler<'stealth'> = {
  isTimed: false,
  enter(world, ctx, step) {
    const { stealth } = world.sequence;
    const exit = stealthStepOf(world, ctx);
    stealth.isRunning = true;
    stealth.exitXM = exit?.exitXM ?? 0;
    stealth.exitZM = exit?.exitZM ?? 0;
    stealth.breathLeftMs = ctx.feel.stealth.breathCapacityMs;
    stealth.breathHeldAt = null;
    stealth.isPassagePaid = false;
    // He never creaks for the board he starts on: only for entering one.
    stealth.creakZoneIndex = creakZoneIndexAt(ctx, world.papa.xM, world.papa.zM);
    stealth.nextAlertAt = drawAlertAt(world, step);
  },
  tick(world, ctx, step) {
    const { stealth } = world.sequence;
    const planned = stealthStepOf(world, ctx);
    if (!stealth.isRunning || planned === null) return;
    const falseAlarm = world.threats[planned.falseAlarmIndex] as ThreatInstance;
    const realWake = world.threats[planned.realWakeIndex] as ThreatInstance;
    const now = world.time.sim;
    const { papa, baby } = world;

    // The critical passage (D8): the false alarm's window, from the step it is seen open to the step it
    // leaves that state. It is read once, before this step's commands and threats.
    const isInPassage = falseAlarm.state === 'windowOpen';
    if (!isInPassage) stealth.isPassagePaid = false;
    const passageEndsAt = isInPassage
      ? falseAlarm.windowOpenAt + (falseAlarm.responseWindow?.windowMs ?? 0)
      : 0;

    // 1. The commands of this step (a pad button, a key or a held finger).
    for (let i = 0; i < ctx.commands.length; i++) {
      const command = ctx.commands[i];
      if (command === undefined) continue;
      if (command.type === 'HoldAnywhere') {
        if (stealth.breathHeldAt !== null || stealth.breathLeftMs <= 0) continue;
        stealth.breathHeldAt = asSimMs(command.t);
        ctx.events.push({ type: 'BreathHeld', t: now });
      } else if (command.type === 'ReleaseHold') {
        if (stealth.breathHeldAt === null) continue;
        stealth.breathHeldAt = null;
        ctx.events.push({ type: 'BreathReleased', t: now });
        // Judged on the release's own `t`: let go before the end of the window, it is heard.
        if (isInPassage && command.t < passageEndsAt) gasp(world, ctx, 'early', true);
      }
    }

    // 2. The gauge: it falls while held, rises while not, and an empty one lets the breath out loudly.
    const { breathCapacityMs, breathRefillPerSecMs } = ctx.feel.stealth;
    if (stealth.breathHeldAt !== null) {
      stealth.breathLeftMs -= STEP_MS;
      if (stealth.breathLeftMs <= 0) {
        // The key stays down and does nothing: a new press is needed (`HoldAnywhere` is ignored on 0).
        stealth.breathLeftMs = 0;
        stealth.breathHeldAt = null;
        ctx.events.push({ type: 'BreathReleased', t: now });
        gasp(world, ctx, 'empty', isInPassage);
      }
    } else {
      stealth.breathLeftMs = Math.min(
        breathCapacityMs,
        stealth.breathLeftMs + (breathRefillPerSecMs * STEP_MS) / MS_PER_S,
      );
      // Not held when the window was first seen. Once the stretch is over a release is free (a press
      // stamped at its end can arrive a little after it, with the input lag).
      if (isInPassage && !stealth.isPassagePaid && now < passageEndsAt) {
        gasp(world, ctx, 'notHeld', true);
      }
    }

    // 3. The creaks: one for each entry into a board, none for standing or walking on it.
    const creakIndex = creakZoneIndexAt(ctx, papa.xM, papa.zM);
    if (creakIndex >= 0 && creakIndex !== stealth.creakZoneIndex) {
      const zone = ctx.level.creakZones[creakIndex];
      if (zone !== undefined) {
        ctx.events.push({
          type: 'FloorCreaked',
          t: now,
          zoneId: zone.id,
          xM: papa.xM,
          zM: papa.zM,
        });
      }
    }
    stealth.creakZoneIndex = creakIndex;

    // 4. The exit. Never over an open alert: a real wake at the door must still be answered.
    const exitDxM = papa.xM - stealth.exitXM;
    const exitDzM = papa.zM - stealth.exitZM;
    if (
      exitDxM * exitDxM + exitDzM * exitDzM <= step.exitRadiusM * step.exitRadiusM &&
      !isAlertUp(falseAlarm, realWake)
    ) {
      succeedSequence(world, ctx);
      return;
    }

    // 5. The alert: both instances rested, Papa free, and room for the longer one to be judged.
    if (stealth.nextAlertAt === null || now < stealth.nextAlertAt) return;
    if (falseAlarm.state !== 'idle' || realWake.state !== 'idle' || isPapaBusy(papa)) return;
    const falseAlarmDef = (ctx.level.threats[planned.falseAlarmIndex] as { def: ThreatDef }).def;
    const realWakeDef = (ctx.level.threats[planned.realWakeIndex] as { def: ThreatDef }).def;
    if (
      !isJudgeableBeforeEnd(world, ctx, falseAlarmDef, now) ||
      !isJudgeableBeforeEnd(world, ctx, realWakeDef, now)
    ) {
      return;
    }
    // The two draws of an alert, in this order: its kind, then the wait for the next one.
    const isRealWake = nextFloat(world.rng) * 100 < step.realWakePct;
    const alert = isRealWake ? realWake : falseAlarm;
    alert.xM = baby.xM;
    alert.zM = baby.zM;
    telegraphThreat(world, ctx, alert, isRealWake ? realWakeDef : falseAlarmDef, -1);
    stealth.nextAlertAt = drawAlertAt(world, step);
  },
  // A stealth step is won by Papa's exit only (`tick`): waiting past `endsAt` must never win it.
  isSettled() {
    return false;
  },
};

/** What {@link sequenceStealthProblems} reads of a threat def (a `ThreatDef` of the content fits it). */
export interface StealthThreatShape {
  readonly response: string;
  readonly target: string;
  readonly cooldownMs: number;
  readonly telegraphDelayMs: number | null;
  readonly nothingMs?: number;
  readonly windowMs: number | null;
  readonly gag?: string;
  readonly surpriseGags?: readonly string[];
}

/** The part of a sequence def {@link sequenceStealthProblems} reads (a `SequenceDef` of the content fits it). */
export interface StealthDefShape {
  readonly babyCarried: boolean;
  readonly success: { readonly kind: string };
  readonly failure: { readonly kind: string; readonly hasSnore?: boolean };
  readonly framing: { readonly bar: unknown };
  readonly steps: readonly (
    | { readonly kind: 'microSleeps' }
    | { readonly kind: 'beats' }
    | { readonly kind: 'duel' }
    | {
        readonly kind: 'stealth';
        readonly exitAnchor: string;
        readonly exitRadiusM: number;
        readonly alertGapMinMs: number;
        readonly falseAlarmDef: string;
        readonly realWakeDef: string;
      }
  )[];
}

/** What a level offers a stealth step: the carry, the anchors and Papa's grid. */
export interface StealthRoom {
  /** Whether the level lets Papa carry the baby (only then are the safe zones built). */
  readonly hasCarry: boolean;
  /** The floor point of the anchor `id` of the geometry, or undefined. */
  anchorPointOf(id: string): { readonly xM: number; readonly zM: number } | undefined;
  /** Whether the centre of an open cell of Papa's grid lies within `radiusM` of the point. */
  hasOpenCellWithin(xM: number, zM: number, radiusM: number): boolean;
}

/** The {@link StealthRoom} of a geometry (its anchors, as `[x, y, z]` positions) and Papa's grid. */
export function stealthRoomOf(
  anchors: readonly { readonly id: string; readonly positionM: readonly number[] }[],
  grid: Pick<NavGrid, 'nearestOpenCell' | 'centerXM' | 'centerZM'>,
  hasCarry: boolean,
): StealthRoom {
  return {
    hasCarry,
    anchorPointOf(id) {
      const anchor = anchors.find((candidate) => candidate.id === id);
      if (anchor === undefined) return undefined;
      return { xM: anchor.positionM[0] as number, zM: anchor.positionM[2] as number };
    },
    hasOpenCellWithin(xM, zM, radiusM) {
      const cell = grid.nearestOpenCell(xM, zM, -1);
      if (cell < 0) return false;
      const dx = grid.centerXM(cell) - xM;
      const dz = grid.centerZM(cell) - zM;
      return dx * dx + dz * dz <= radiusM * radiusM;
    },
  };
}

/**
 * {@link stealthRoomOf} for a level's geometry, building Papa's grid (`content:check` builds none of its
 * own), as `openSafeCentreCountOf` does for the safe zones.
 */
export function stealthRoomForGeometry(
  geometry: LevelGeometry,
  papaRadiusM: number,
  hasCarry: boolean,
): StealthRoom {
  return stealthRoomOf(geometry.anchors, createNavGrid(geometry, papaRadiusM), hasCarry);
}

/**
 * What is wrong with the stealth steps of a sequence def, each as a sentence that follows « the
 * sequence "<id>" »: `content:check` and `simLevelOf` both call it, so they refuse the same things
 * with the same words. `threatDefs` are the loaded threat defs by id; `limits` is the widest a window
 * gets; `room` is what the level offers (null: skip the rules that need it). Pure: no zod and no
 * `@content` runtime import.
 */
export function sequenceStealthProblems(
  def: StealthDefShape,
  threatDefs: Readonly<Record<string, StealthThreatShape>>,
  limits: DuelLimits,
  room: StealthRoom | null,
): string[] {
  const stealthCount = def.steps.filter((step) => step.kind === 'stealth').length;
  if (stealthCount === 0) return [];
  const problems: string[] = [];
  if (def.steps.length > 1) {
    problems.push(
      `has a stealth step among ${def.steps.length} steps, but a stealth step must be the only step of its sequence`,
    );
  }
  if (def.failure.kind !== 'gag' || def.failure.hasSnore === true) {
    problems.push(
      'has a stealth step, so its failure must be a "gag" with hasSnore false (Papa is awake: he does not snore)',
    );
  }
  if (def.babyCarried) {
    problems.push(
      'has a stealth step, so `babyCarried` must be false (the baby sleeps in his crib)',
    );
  }
  if (def.success.kind !== 'stepsDone') {
    problems.push(
      `has a stealth step, so its success must be "stepsDone", not "${def.success.kind}"`,
    );
  }
  if (def.framing.bar !== null) {
    problems.push(
      'has a stealth step, so its bar must be null (the end of the crossing is only an estimate: a timeLeft bar would lie)',
    );
  }
  if (room !== null && !room.hasCarry) {
    problems.push(
      'has a stealth step, but the level has no carry (the safe zones the baby sleeps in are only built with one)',
    );
  }
  def.steps.forEach((step, j) => {
    if (step.kind !== 'stealth') return;
    const where = `has a stealth step (steps[${j}])`;
    const falseAlarm = Object.hasOwn(threatDefs, step.falseAlarmDef)
      ? threatDefs[step.falseAlarmDef]
      : undefined;
    const realWake = Object.hasOwn(threatDefs, step.realWakeDef)
      ? threatDefs[step.realWakeDef]
      : undefined;
    if (falseAlarm === undefined) {
      problems.push(`${where} whose falseAlarmDef "${step.falseAlarmDef}" is not loaded`);
    } else {
      if (falseAlarm.response !== 'nothing' || falseAlarm.target !== 'baby') {
        problems.push(
          `${where} whose falseAlarmDef "${step.falseAlarmDef}" has the response "${falseAlarm.response}" and the target "${falseAlarm.target}", but a false alarm is a "nothing" on the baby (target "baby")`,
        );
      }
      if (gagsOf(falseAlarm).includes(PAPA_ASLEEP_GAG_ID)) {
        problems.push(
          `${where} whose falseAlarmDef "${step.falseAlarmDef}" has the gag "${PAPA_ASLEEP_GAG_ID}", which is the micro-sleep's alone`,
        );
      }
    }
    if (realWake === undefined) {
      problems.push(`${where} whose realWakeDef "${step.realWakeDef}" is not loaded`);
    } else {
      if (realWake.response !== 'parry' || realWake.target !== 'baby') {
        problems.push(
          `${where} whose realWakeDef "${step.realWakeDef}" has the response "${realWake.response}" and the target "${realWake.target}", but a real wake is a "parry" on the baby (target "baby")`,
        );
      }
      if (gagsOf(realWake).includes(PAPA_ASLEEP_GAG_ID)) {
        problems.push(
          `${where} whose realWakeDef "${step.realWakeDef}" has the gag "${PAPA_ASLEEP_GAG_ID}", which is the micro-sleep's alone`,
        );
      }
    }
    // An alert never waits on the last one: the gap is longer than the longest of the two cycles.
    if (falseAlarm !== undefined && falseAlarm.nothingMs !== undefined) {
      const falseAlarmMs =
        (falseAlarm.telegraphDelayMs ?? limits.telegraphDelayDefaultMs) +
        falseAlarm.nothingMs +
        falseAlarm.cooldownMs;
      if (step.alertGapMinMs <= falseAlarmMs) {
        problems.push(
          `${where} with an alertGapMinMs of ${step.alertGapMinMs}, which is not above the ${falseAlarmMs} ms a false alarm takes (telegraph + nothingMs + cooldownMs): an alert would wait on the last one`,
        );
      }
    }
    if (realWake !== undefined) {
      const realWakeMs =
        (realWake.telegraphDelayMs ?? limits.telegraphDelayDefaultMs) +
        (realWake.windowMs ?? limits.windowMs) * limits.maxWindowMultiplier +
        limits.toleranceMs +
        realWake.cooldownMs;
      if (step.alertGapMinMs <= realWakeMs) {
        problems.push(
          `${where} with an alertGapMinMs of ${step.alertGapMinMs}, which is not above the ${realWakeMs} ms a real wake can take (telegraph + window at the widest tier + tolerance + cooldownMs): an alert would wait on the last one`,
        );
      }
    }
    if (room !== null) {
      const exit = room.anchorPointOf(step.exitAnchor);
      if (exit === undefined) {
        problems.push(
          `${where} whose exitAnchor "${step.exitAnchor}" is not an anchor of the level`,
        );
      } else if (!room.hasOpenCellWithin(exit.xM, exit.zM, step.exitRadiusM)) {
        problems.push(
          `${where} whose exitAnchor "${step.exitAnchor}" has no open cell within exitRadiusM (${step.exitRadiusM} m): Papa could never leave`,
        );
      }
    }
  });
  return problems;
}

function gagsOf(threat: StealthThreatShape): readonly string[] {
  return threat.gag === undefined ? (threat.surpriseGags ?? []) : [threat.gag];
}
