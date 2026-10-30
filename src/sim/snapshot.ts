import type { Feel } from '@content/schemas/feel';
import { decodeBase64, encodeBase64 } from '@shared/base64';
import {
  GAUGE_MAX_POINTS,
  MAMA_SCORE_MAX_POINTS,
  MIN_TIME_SCALE,
  PHONE_RINGING_EVERY_MS,
  QUATERNION_LENGTH_TOLERANCE,
  STAR_COUNT_MAX,
} from '@shared/constants';
import { cloneJson } from '@shared/hash';
import { invariant } from '@shared/invariant';
import { DISRUPTION_STATES } from './disruptions/disruptionFsm.ts';
import { feelShapeProblem } from './feel/applyFeelPatch.ts';
import { FLOW_STATES, type FlowState } from './flow/flowFsm.ts';
import { isPapaBusy, PAPA_INTENTS, PAPA_STATES, type PapaState } from './papa/papaFsm.ts';
import { THREAT_STATES } from './threats/threatFsm.ts';
import {
  type PropSlice,
  SLOW_MO_SOURCES,
  type SlowMoSource,
  type ThreatInstance,
  type World,
} from './world.ts';

/**
 * The restorable state: `World` and the Rapier world beside it, plus the identity of the sim it
 * came from (a snapshot of another seed, feel, level geometry or level is refused on restore).
 * Pending commands are rebuilt from the journal, and freeze is a real-time artefact.
 */
export interface SimSnapshot {
  /**
   * 19 since story 4.4: `world.sequence` (the special sequence) and the `sequence` flow state. 18 since story 4.3 (merged after 2.7): `gauges.bladderPct` / `isBladderFull` and the `onToilet` Papa state. 17 since story 2.7: `input.lagMs` (`SetInputLag`). 16 since story 4.2: `world.combo`, `score.comboPoints`, the `comboCashIn` slow-mo. 15 since story 4.1: `world.carry`, `papa.intent`, the `carried` baby state. 14 since story 3.2: `score.final.lostStars`. 13 since story 2.1: `feel`, the effective feel (a `SetFeel` changes it). 12 since story 3.1: `gauges.noisePct` / `propNoiseAt` and `baby.cryStartedAt` / `cryEndsAt`. 11 since story 1.23: `PendingPress.heldAt` (the hold-ring closed). 10 since story 1.22: `score` (Mama's counters and, once the level has ended, her note). 9 since story 1.21: `silence` (the suspicious silence), `mess.mischiefs`, the `hidden` threat
   * state and the `mischiefSilent` baby state. 8 since story 1.20: `disruptions` (one instance per planned disruption) and the `onPhone`
   * state. 7 added `gauges`, `PapaSlice.objectId` / `busyUntil` and the `drink` / `asleep`
   * states. 6 added `director`, `flow` and `ThreatInstance.waveIndex` (story 1.18). 5 added the
   * Rapier world, base64 (4 carried the base scale and the slow-mos in `World.time`, since story
   * 1.14; 3 named the level).
   */
  version: 19;
  seed: number;
  feelHash: string;
  geometryHash: string;
  levelHash: string;
  world: World;
  /** Rapier's own snapshot of the props' bodies, base64 of its bytes: a snapshot stays JSON. */
  physics: string;
}

export function takeSnapshot(
  world: World,
  seed: number,
  feelHash: string,
  geometryHash: string,
  levelHash: string,
  physics: Uint8Array,
): SimSnapshot {
  return {
    version: 19,
    seed,
    feelHash,
    geometryHash,
    levelHash,
    world: cloneJson(world),
    physics: encodeBase64(physics),
  };
}

function papaProblem(
  papa: unknown,
  objectIds: readonly string[],
  babyState: unknown,
  hasBladder: boolean,
): string | null {
  if (typeof papa !== 'object' || papa === null) return 'world.papa is missing';
  const slice = papa as Record<string, unknown>;
  if (!PAPA_STATES.includes(slice.state as (typeof PAPA_STATES)[number])) {
    return 'world.papa.state';
  }
  for (const key of [
    'enteredAt',
    'xM',
    'zM',
    'prevXM',
    'prevZM',
    'headingX',
    'headingZ',
    'dirX',
    'dirZ',
  ]) {
    if (typeof slice[key] !== 'number' || !Number.isFinite(slice[key])) {
      return `world.papa.${key}`;
    }
  }
  const { path } = slice;
  if (!Array.isArray(path) || path.length % 2 !== 0) return 'world.papa.path';
  if (!path.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return 'world.papa.path';
  }
  if (
    !Number.isInteger(slice.pathIndex) ||
    (slice.pathIndex as number) < 0 ||
    (slice.pathIndex as number) * 2 > path.length
  ) {
    return 'world.papa.pathIndex';
  }
  if (typeof slice.isBlocked !== 'boolean') return 'world.papa.isBlocked';
  // The object of the current walk: only a tapped path goes to one, and the level has it.
  if (slice.objectId !== null) {
    if (typeof slice.objectId !== 'string' || !objectIds.includes(slice.objectId)) {
      return 'world.papa.objectId';
    }
    if (slice.state !== 'walkPath') return 'world.papa.objectId';
  }
  // What the walk does on arrival (story 4.1): only a tapped path has one, never with an object, and
  // it agrees with the baby: a put-down needs him in the arms, a take needs him out of them.
  if (!PAPA_INTENTS.includes(slice.intent as (typeof PAPA_INTENTS)[number])) {
    return 'world.papa.intent';
  }
  if (slice.intent !== 'none') {
    if (slice.state !== 'walkPath' || slice.objectId !== null) return 'world.papa.intent';
    if ((slice.intent === 'putDownBaby') !== (babyState === 'carried')) return 'world.papa.intent';
  }
  // A busy Papa has an end (`busyUntil` > 0); any other state has none. Busy states have no path,
  // no direction and no glide: the checks below hold them to it.
  if (!isFiniteNumber(slice.busyUntil) || (slice.busyUntil as number) < 0) {
    return 'world.papa.busyUntil';
  }
  const isBusy = isPapaBusy({ state: slice.state as PapaState });
  if (isBusy !== (slice.busyUntil !== 0)) return 'world.papa.busyUntil';
  // The toilet is no place for a baby in the arms (story 4.3): `tapObject` refuses, `takeBaby` is
  // ignored while Papa is busy, so the two never meet.
  if (slice.state === 'onToilet' && babyState === 'carried') return 'world.papa.state';
  // And no toilet without the need gauge: the level has no door (`content:check`).
  if (slice.state === 'onToilet' && !hasBladder) return 'world.papa.state';

  // The state and the data it walks on must agree.
  const dirLength = Math.sqrt((slice.dirX as number) ** 2 + (slice.dirZ as number) ** 2);
  if (slice.state === 'walkDir') {
    if (Math.abs(dirLength - 1) > 1e-6) return 'world.papa.dir';
  } else if (dirLength !== 0) {
    return 'world.papa.dir';
  }
  if (slice.state === 'walkPath') {
    if (path.length === 0 || (slice.pathIndex as number) * 2 >= path.length) {
      return 'world.papa.path';
    }
  } else if (slice.state !== 'glide' && path.length !== 0) {
    return 'world.papa.path';
  }
  // A glide state has a glide, any other does not; a glide has a path (it is fully walked at the step
  // of the arrival, before the state goes back to idle).
  const hasGlide = slice.glide !== null;
  if (hasGlide !== (slice.state === 'glide')) return 'world.papa.glide';
  if (hasGlide) {
    const glide = slice.glide as Record<string, unknown> | undefined;
    if (typeof glide !== 'object' || glide === null) return 'world.papa.glide';
    if (!Number.isInteger(glide.threatId)) return 'world.papa.glide.threatId';
    for (const key of ['toXM', 'toZM', 'startedAt', 'arriveAt', 'speedMps']) {
      if (typeof glide[key] !== 'number' || !Number.isFinite(glide[key])) {
        return `world.papa.glide.${key}`;
      }
    }
    // A glide that cannot end would leave Papa stuck in it (`MoveStop` is ignored while it lasts).
    if ((glide.speedMps as number) <= 0) return 'world.papa.glide.speedMps';
    if ((glide.arriveAt as number) < (glide.startedAt as number))
      return 'world.papa.glide.arriveAt';
    if (path.length === 0) return 'world.papa.path';
  }
  const headingLength = Math.sqrt(
    (slice.headingX as number) ** 2 + (slice.headingZ as number) ** 2,
  );
  if (Math.abs(headingLength - 1) > 1e-6) return 'world.papa.heading';
  return null;
}

const BABY_STATES: readonly unknown[] = [
  'wander',
  'babble',
  'targetLocked',
  'approach',
  'act',
  'mischiefSilent',
  'carried',
];

function isUnitVector(x: unknown, z: unknown): boolean {
  if (typeof x !== 'number' || typeof z !== 'number') return false;
  return Math.abs(Math.sqrt(x * x + z * z) - 1) <= 1e-6;
}

function babyProblem(
  baby: unknown,
  papa: unknown,
  threats: readonly { id: number }[],
  nowMs: number,
): string | null {
  if (typeof baby !== 'object' || baby === null) return 'world.baby is missing';
  const slice = baby as Record<string, unknown>;
  if (!BABY_STATES.includes(slice.state)) return 'world.baby.state';
  for (const key of [
    'enteredAt',
    'xM',
    'zM',
    'prevXM',
    'prevZM',
    'headingX',
    'headingZ',
    'gazeX',
    'gazeZ',
    'wanderAt',
  ]) {
    if (typeof slice[key] !== 'number' || !Number.isFinite(slice[key])) {
      return `world.baby.${key}`;
    }
  }
  const { path } = slice;
  if (!Array.isArray(path) || path.length % 2 !== 0) return 'world.baby.path';
  if (!path.every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return 'world.baby.path';
  }
  if (
    !Number.isInteger(slice.pathIndex) ||
    (slice.pathIndex as number) < 0 ||
    (slice.pathIndex as number) * 2 > path.length
  ) {
    return 'world.baby.pathIndex';
  }
  if (typeof slice.babbling !== 'boolean') return 'world.baby.babbling';
  if (slice.targetThreatId !== null && !Number.isInteger(slice.targetThreatId)) {
    return 'world.baby.targetThreatId';
  }
  if (
    typeof slice.approachSpeedMps !== 'number' ||
    !Number.isFinite(slice.approachSpeedMps) ||
    slice.approachSpeedMps < 0
  ) {
    return 'world.baby.approachSpeedMps';
  }

  // The state and the data it crawls on must agree. An approach may have no path (nowhere to go,
  // or already there).
  if (slice.state === 'wander') {
    if (path.length === 0 || (slice.pathIndex as number) * 2 >= path.length) {
      return 'world.baby.path';
    }
  } else if (slice.state === 'mischiefSilent') {
    // Crawling to the zone (a path left to walk) or sitting in it (none).
    if (path.length !== 0 && (slice.pathIndex as number) * 2 >= path.length) {
      return 'world.baby.path';
    }
  } else if (slice.state !== 'approach' && path.length !== 0) {
    return 'world.baby.path';
  }
  // The baby stares at, crawls to or plays out a target: it has one.
  const needsTarget =
    slice.state === 'targetLocked' ||
    slice.state === 'approach' ||
    slice.state === 'act' ||
    slice.state === 'mischiefSilent';
  if (needsTarget !== (slice.targetThreatId !== null)) return 'world.baby.targetThreatId';
  if (slice.targetThreatId !== null && !threats.some((t) => t.id === slice.targetThreatId)) {
    return 'world.baby.targetThreatId';
  }
  // Only an approach crawls to a threat.
  if (slice.state !== 'approach' && slice.approachSpeedMps !== 0) {
    return 'world.baby.approachSpeedMps';
  }
  if (!isUnitVector(slice.headingX, slice.headingZ)) return 'world.baby.heading';
  if (!isUnitVector(slice.gazeX, slice.gazeZ)) return 'world.baby.gaze';
  // In Papa's arms (story 4.1) he is at Papa's point: no path, target or approach was checked above.
  if (slice.state === 'carried') {
    const holder = papa as Record<string, unknown>;
    if (slice.xM !== holder.xM || slice.zM !== holder.zM) return 'world.baby.xM';
  }
  // A cry (story 3.1) has both its instants or neither, started no later than now, and ends no
  // earlier than it started.
  const { cryStartedAt, cryEndsAt } = slice;
  if ((cryStartedAt === null) !== (cryEndsAt === null)) return 'world.baby.cryEndsAt';
  if (cryStartedAt !== null) {
    if (
      !isFiniteNumber(cryStartedAt) ||
      (cryStartedAt as number) < 0 ||
      (cryStartedAt as number) > nowMs
    ) {
      return 'world.baby.cryStartedAt';
    }
    if (!isFiniteNumber(cryEndsAt) || (cryEndsAt as number) < (cryStartedAt as number)) {
      return 'world.baby.cryEndsAt';
    }
  }
  return null;
}

function isFiniteNumber(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

function windowProblem(value: unknown, where: string): string | null {
  if (typeof value !== 'object' || value === null) return where;
  const fields = value as Record<string, unknown>;
  for (const key of ['windowMs', 'perfectMs', 'toleranceMs', 'bufferMs']) {
    if (!isFiniteNumber(fields[key])) return `${where}.${key}`;
  }
  return null;
}

function pressProblem(press: unknown, where: string): string | null {
  if (typeof press !== 'object' || press === null) return where;
  const fields = press as Record<string, unknown>;
  if (!isFiniteNumber(fields.t)) return `${where}.t`;
  if (fields.quality !== 'perfect' && fields.quality !== 'success') return `${where}.quality`;
  if (!isFiniteNumber(fields.offsetMs)) return `${where}.offsetMs`;
  if (fields.releasedAt !== null && !isFiniteNumber(fields.releasedAt))
    return `${where}.releasedAt`;
  // The ring closed no earlier than the press (the sim also holds it to `holdMinMs`, which the
  // snapshot does not know: only the feel's hash travels with it).
  const { heldAt } = fields;
  if (heldAt !== null && !(isFiniteNumber(heldAt) && (heldAt as number) >= (fields.t as number)))
    return `${where}.heldAt`;
  return null;
}

/** An integer in `[-1, waveCount − 1]`: -1 is « no wave ». */
function isWaveIndex(value: unknown, waveCount: number): boolean {
  return Number.isInteger(value) && (value as number) >= -1 && (value as number) < waveCount;
}

function directorProblem(director: unknown, waveCount: number): string | null {
  if (typeof director !== 'object' || director === null) return 'world.director is missing';
  const slice = director as Record<string, unknown>;
  if (!isWaveIndex(slice.waveIndex, waveCount)) return 'world.director.waveIndex';
  if (!isFiniteNumber(slice.nextAt) || (slice.nextAt as number) < 0) return 'world.director.nextAt';
  return null;
}

function gaugesProblem(
  gauges: unknown,
  hasFatigue: boolean,
  hasNoise: boolean,
  hasBladder: boolean,
  propCount: number,
  nowMs: number,
): string | null {
  if (typeof gauges !== 'object' || gauges === null) return 'world.gauges is missing';
  const slice = gauges as Record<string, unknown>;
  if (
    !isFiniteNumber(slice.fatigue) ||
    (slice.fatigue as number) < 0 ||
    (slice.fatigue as number) > GAUGE_MAX_POINTS
  ) {
    return 'world.gauges.fatigue';
  }
  if (typeof slice.isFatigueAbove !== 'boolean') return 'world.gauges.isFatigueAbove';
  if (
    slice.microSleepAt !== null &&
    (!isFiniteNumber(slice.microSleepAt) || (slice.microSleepAt as number) < 0)
  ) {
    return 'world.gauges.microSleepAt';
  }
  // A micro-sleep is pending exactly while Papa is above the threshold, and only in a level with fatigue.
  if (!hasFatigue && slice.isFatigueAbove) return 'world.gauges.isFatigueAbove';
  if ((slice.microSleepAt !== null) !== slice.isFatigueAbove) return 'world.gauges.microSleepAt';
  // The noise (story 3.1) is held in [0, 100], and is 0 for good in a level without the gauge.
  if (
    !isFiniteNumber(slice.noisePct) ||
    (slice.noisePct as number) < 0 ||
    (slice.noisePct as number) > GAUGE_MAX_POINTS ||
    (!hasNoise && slice.noisePct !== 0)
  ) {
    return 'world.gauges.noisePct';
  }
  // The need (story 4.3) is held in [0, 100], and is 0 and not full for good in a level without the
  // gauge. `isBladderFull` is not held to `feel.bladder.slowFromPct`: a `SetFeel` can move the
  // threshold, and the flag follows at the next step.
  if (
    !isFiniteNumber(slice.bladderPct) ||
    (slice.bladderPct as number) < 0 ||
    (slice.bladderPct as number) > GAUGE_MAX_POINTS ||
    (!hasBladder && slice.bladderPct !== 0)
  ) {
    return 'world.gauges.bladderPct';
  }
  if (typeof slice.isBladderFull !== 'boolean' || (!hasBladder && slice.isBladderFull)) {
    return 'world.gauges.isBladderFull';
  }
  const noiseAt = slice.propNoiseAt;
  if (!Array.isArray(noiseAt) || noiseAt.length !== propCount) return 'world.gauges.propNoiseAt';
  for (const at of noiseAt) {
    // A noise instant is in the past (or now): a later one would mute the prop until the clock caught up.
    if (at !== null && (!isFiniteNumber(at) || (at as number) < 0 || (at as number) > nowMs))
      return 'world.gauges.propNoiseAt';
  }
  return null;
}

function disruptionProblem(
  disruption: unknown,
  index: number,
  nowMs: number,
  ringMaxMs: number,
): string | null {
  const where = `world.disruptions[${index}]`;
  if (typeof disruption !== 'object' || disruption === null) return where;
  const instance = disruption as Record<string, unknown>;
  if (!DISRUPTION_STATES.includes(instance.state as (typeof DISRUPTION_STATES)[number])) {
    return `${where}.state`;
  }
  for (const key of ['enteredAt', 'untilAt', 'nextRingingAt']) {
    if (!isFiniteNumber(instance[key]) || (instance[key] as number) < 0) return `${where}.${key}`;
  }
  // A state is entered in the past; a disruption that never started was never entered.
  if ((instance.enteredAt as number) > nowMs) return `${where}.enteredAt`;
  if (instance.state === 'pending' && instance.enteredAt !== 0) return `${where}.enteredAt`;
  // The two instants mean something only while it rings, and are then both in the future of its start.
  const isRinging = instance.state === 'ringing';
  if (isRinging !== (instance.untilAt !== 0)) return `${where}.untilAt`;
  if (isRinging !== (instance.nextRingingAt !== 0)) return `${where}.nextRingingAt`;
  if (isRinging) {
    // It rings from `enteredAt` to exactly `ringMaxMs` later, and its ticks fall on whole periods from
    // there: anything else is a world `tickRinging` would loop on (a tiny `nextRingingAt` and a huge
    // `untilAt` is a burst of ticks in one step).
    const enteredAt = instance.enteredAt as number;
    const untilAt = instance.untilAt as number;
    const nextRingingAt = instance.nextRingingAt as number;
    if (untilAt !== enteredAt + ringMaxMs || untilAt <= nowMs) return `${where}.untilAt`;
    const sinceStartMs = nextRingingAt - enteredAt;
    if (
      sinceStartMs < PHONE_RINGING_EVERY_MS ||
      sinceStartMs % PHONE_RINGING_EVERY_MS !== 0 ||
      nextRingingAt > untilAt + PHONE_RINGING_EVERY_MS
    ) {
      return `${where}.nextRingingAt`;
    }
  }
  return null;
}

function disruptionsProblem(
  disruptions: unknown,
  planned: PlannedLevel['disruptions'],
  nowMs: number,
): string | null {
  if (!Array.isArray(disruptions) || disruptions.length !== planned.length) {
    return 'world.disruptions';
  }
  for (let i = 0; i < disruptions.length; i++) {
    const problem = disruptionProblem(
      disruptions[i],
      i,
      nowMs,
      (planned[i] as PlannedLevel['disruptions'][number]).def.ringMaxMs,
    );
    if (problem !== null) return problem;
  }
  return null;
}

/** Papa is on the phone only after a pick-up: some disruption is `answered` (the call's own life). */
function onPhoneProblem(papa: unknown, disruptions: readonly { state: unknown }[]): string | null {
  const isOnPhone = (papa as Record<string, unknown> | null | undefined)?.state === 'onPhone';
  if (isOnPhone && !disruptions.some((disruption) => disruption.state === 'answered')) {
    return 'world.papa.state';
  }
  return null;
}

/**
 * `ended` before the level's time is up is only a woken Mama (story 3.2): the level has the noise
 * gauge and it stands at 100 %, frozen there by the end.
 */
function flowProblem(
  flow: unknown,
  nowMs: number,
  durationMs: number,
  hasNoise: boolean,
  gauges: unknown,
): string | null {
  if (typeof flow !== 'object' || flow === null) return 'world.flow is missing';
  const slice = flow as Record<string, unknown>;
  if (!FLOW_STATES.includes(slice.state as FlowState)) return 'world.flow.state';
  if (!isFiniteNumber(slice.enteredAt) || (slice.enteredAt as number) < 0) {
    return 'world.flow.enteredAt';
  }
  // A state is entered in the past, and the level only ends once its time is up, or the noise is full.
  if ((slice.enteredAt as number) > nowMs) return 'world.flow.enteredAt';
  if (slice.state === 'ended' && nowMs < durationMs) {
    const noisePct = (gauges as Record<string, unknown> | null | undefined)?.noisePct;
    if (!hasNoise || noisePct !== GAUGE_MAX_POINTS) return 'world.flow.state';
  }
  return null;
}

function threatProblem(threat: unknown, index: number, waveCount: number): string | null {
  const where = `world.threats[${index}]`;
  if (typeof threat !== 'object' || threat === null) return where;
  const instance = threat as Record<string, unknown>;
  if (!Number.isInteger(instance.id)) return `${where}.id`;
  for (const key of ['defId', 'anchorId']) {
    if (typeof instance[key] !== 'string') return `${where}.${key}`;
  }
  for (const key of ['xM', 'zM', 'enteredAt', 'windowOpenAt']) {
    if (!isFiniteNumber(instance[key])) return `${where}.${key}`;
  }
  if (!THREAT_STATES.includes(instance.state as (typeof THREAT_STATES)[number])) {
    return `${where}.state`;
  }
  if (instance.responseWindow !== null) {
    const problem = windowProblem(instance.responseWindow, `${where}.responseWindow`);
    if (problem !== null) return problem;
  }
  if (instance.press !== null) {
    const problem = pressProblem(instance.press, `${where}.press`);
    if (problem !== null) return problem;
  }
  // The state and the data it carries must agree.
  const isActive = instance.state === 'telegraph' || instance.state === 'windowOpen';
  if (
    (instance.state === 'idle' || instance.state === 'hidden') &&
    instance.responseWindow !== null
  ) {
    return `${where}.responseWindow`;
  }
  // A hidden silence has no window yet: nothing to open.
  if (instance.state === 'hidden' && instance.windowOpenAt !== 0) return `${where}.windowOpenAt`;
  if (isActive && instance.responseWindow === null) return `${where}.responseWindow`;
  if (!isActive && instance.press !== null) return `${where}.press`;
  // The wave that telegraphed it, or -1 (idle, or no wave planned it); an idle threat has none.
  if (!isWaveIndex(instance.waveIndex, waveCount)) return `${where}.waveIndex`;
  if (instance.state === 'idle' && instance.waveIndex !== -1) return `${where}.waveIndex`;
  return null;
}

/** What `worldProblem` needs of the level: its waves, and the defs it plans and its props, in order (both are index-aligned with the world's). */
export interface PlannedLevel {
  /** Only the count is needed: it bounds the wave indices. */
  readonly waves: readonly unknown[];
  /** How long the level lasts, in sim ms: a level that has ended cannot be earlier than this. */
  readonly durationMs: number;
  readonly threats: readonly { readonly def: { readonly id: string } }[];
  /** The planned disruptions: `world.disruptions` is index-aligned with them (story 1.20). */
  readonly disruptions: readonly { readonly def: { readonly ringMaxMs: number } }[];
  /** The index in `threats` of the micro-sleep, or -1 when the level has no fatigue. */
  readonly microSleepIndex: number;
  /** The index in `threats` of the cry in the arms, or -1 when the level has none (story 4.1). */
  readonly armsCryIndex: number;
  /** Whether the level carries the baby (`SimLevel.hasCarry`, story 4.1): only then can he be `carried`. */
  readonly hasCarry: boolean;
  /** Whether the level has the noise gauge (`SimLevel.hasNoise`, story 3.1). */
  readonly hasNoise: boolean;
  /** Whether the level has the need gauge (`SimLevel.hasBladder`, story 4.3). */
  readonly hasBladder: boolean;
  /** The special sequences the level can run, with the length of each one's steps (story 4.4). */
  readonly sequences: readonly {
    readonly id: string;
    readonly def: { readonly steps: readonly unknown[] };
  }[];
  /** The level's interactive objects: Papa's `objectId` must be one of them. */
  readonly objects: readonly { readonly id: string }[];
  readonly props: readonly {
    readonly id: string;
    readonly kind: string;
    readonly spawnedAboveFloor: boolean;
  }[];
}
type PlannedThreats = PlannedLevel['threats'];

function isTimeScale(value: unknown): boolean {
  return (
    typeof value === 'number' && Number.isFinite(value) && value >= MIN_TIME_SCALE && value <= 1
  );
}

function slowMoProblem(slowMo: unknown, where: string): string | null {
  if (typeof slowMo !== 'object' || slowMo === null) return where;
  const fields = slowMo as Record<string, unknown>;
  if (!SLOW_MO_SOURCES.includes(fields.source as SlowMoSource)) return `${where}.source`;
  if (!isTimeScale(fields.scale)) return `${where}.scale`;
  for (const key of ['startedAt', 'holdUntil', 'endsAt']) {
    if (!isFiniteNumber(fields[key])) return `${where}.${key}`;
  }
  if ((fields.holdUntil as number) < (fields.startedAt as number)) return `${where}.holdUntil`;
  if ((fields.endsAt as number) < (fields.holdUntil as number)) return `${where}.endsAt`;
  return null;
}

function timeProblem(clock: Record<string, unknown>): string | null {
  if (!isFiniteNumber(clock.sim)) return 'world.time.sim';
  if (!isTimeScale(clock.scale)) return 'world.time.scale';
  if (!isTimeScale(clock.baseScale)) return 'world.time.baseScale';
  const { slowMos } = clock;
  if (!Array.isArray(slowMos)) return 'world.time.slowMos';
  const sources = new Set<unknown>();
  for (let i = 0; i < slowMos.length; i++) {
    const problem = slowMoProblem(slowMos[i], `world.time.slowMos[${i}]`);
    if (problem !== null) return problem;
    const { source } = slowMos[i] as { source: unknown };
    // At most one slow-mo per source: `startSlowMo` merges into the running one.
    if (sources.has(source)) return 'world.time.slowMos';
    sources.add(source);
  }
  return null;
}

function isUnitQuaternion(x: unknown, y: unknown, z: unknown, w: unknown): boolean {
  if (![x, y, z, w].every(isFiniteNumber)) return false;
  const length = Math.sqrt(
    (x as number) ** 2 + (y as number) ** 2 + (z as number) ** 2 + (w as number) ** 2,
  );
  return Math.abs(length - 1) <= QUATERNION_LENGTH_TOLERANCE;
}

function propProblem(prop: unknown, index: number, planned: PlannedLevel['props']): string | null {
  const where = `world.props[${index}]`;
  if (typeof prop !== 'object' || prop === null) return where;
  const slice = prop as Record<string, unknown>;
  const spec = planned[index];
  if (slice.id !== spec?.id) return `${where}.id`;
  if (slice.kind !== spec?.kind) return `${where}.kind`;
  for (const key of ['xM', 'yM', 'zM', 'prevXM', 'prevYM', 'prevZM']) {
    if (!isFiniteNumber(slice[key])) return `${where}.${key}`;
  }
  if (!isUnitQuaternion(slice.qx, slice.qy, slice.qz, slice.qw)) return `${where}.q`;
  if (!isUnitQuaternion(slice.prevQx, slice.prevQy, slice.prevQz, slice.prevQw)) {
    return `${where}.prevQ`;
  }
  for (const key of ['isOnFloor', 'isBroken']) {
    if (typeof slice[key] !== 'boolean') return `${where}.${key}`;
  }
  if (slice.lastImpactAt !== null && !isFiniteNumber(slice.lastImpactAt)) {
    return `${where}.lastImpactAt`;
  }
  return null;
}

/**
 * The suspicious silence (story 1.21) and the world agree: it names the one `hidden` threat, its
 * instants come in order and are not in the future, and the baby is `mischiefSilent` on that threat
 * exactly while there is one and babbles exactly until it has entered the zone. A level that has
 * ended closes the silence (`SilenceEnded{levelEnded}`) and leaves the baby and the threat as they
 * were: the coupling is then not checked.
 */
function silenceProblem(
  silence: unknown,
  baby: unknown,
  threats: readonly { id: number; state: unknown }[],
  nowMs: number,
  isEnded: boolean,
): string | null {
  if (typeof silence !== 'object' || silence === null) return 'world.silence is missing';
  const slice = silence as Record<string, unknown>;
  const { threatId, zoneEnteredAt, startedAt } = slice;
  if (threatId !== null) {
    if (!Number.isInteger(threatId)) return 'world.silence.threatId';
    const threat = threats.find((candidate) => candidate.id === threatId);
    if (threat === undefined || threat.state !== 'hidden') return 'world.silence.threatId';
  }
  if (zoneEnteredAt !== null) {
    if (!isFiniteNumber(zoneEnteredAt) || threatId === null || (zoneEnteredAt as number) > nowMs) {
      return 'world.silence.zoneEnteredAt';
    }
  }
  if (startedAt !== null) {
    if (!isFiniteNumber(startedAt) || zoneEnteredAt === null) return 'world.silence.startedAt';
    if ((startedAt as number) < (zoneEnteredAt as number)) return 'world.silence.startedAt';
    if ((startedAt as number) > nowMs) return 'world.silence.startedAt';
  }
  const slept = baby as Record<string, unknown>;
  if (slept.babbling !== (zoneEnteredAt === null)) return 'world.silence.zoneEnteredAt';
  if (threatId !== null && slept.targetThreatId !== threatId) return 'world.silence.threatId';
  if (isEnded && threatId === null) return null;
  if ((slept.state === 'mischiefSilent') !== (threatId !== null)) return 'world.silence.threatId';
  // One threat is hidden exactly while the silence names it.
  let hiddenCount = 0;
  for (const threat of threats) if (threat.state === 'hidden') hiddenCount++;
  if (hiddenCount !== (threatId === null ? 0 : 1)) return 'world.silence.threatId';
  return null;
}

/**
 * Carrying (story 4.1): the baby is carried only in a level that carries; `armsCryAt` is a finite
 * instant exactly while the baby is in the arms in a level with a cry in the arms, and null
 * otherwise (`takeBaby` draws it, `putDownBaby` clears it).
 */
function carryProblem(
  carry: unknown,
  baby: unknown,
  hasCarry: boolean,
  hasArmsCry: boolean,
): string | null {
  if (typeof carry !== 'object' || carry === null) return 'world.carry is missing';
  const { armsCryAt } = carry as Record<string, unknown>;
  const isCarried = (baby as Record<string, unknown>).state === 'carried';
  if (isCarried && !hasCarry) return 'world.baby.state';
  if (armsCryAt === null) return isCarried && hasArmsCry ? 'world.carry.armsCryAt' : null;
  if (!isFiniteNumber(armsCryAt) || (armsCryAt as number) < 0) return 'world.carry.armsCryAt';
  if (!hasArmsCry || !isCarried) return 'world.carry.armsCryAt';
  return null;
}

/**
 * The combo (story 4.2): a whole multiplier of at least 1, finite non-negative base points (not
 * whole: they are not `isCount`), and a tick that is due at a finite instant exactly while the baby
 * is in the arms (`takeBaby` starts it, `putDownBaby` stops it). Not checked against `feel.combo`: a
 * `SetFeel` can move the bounds under a running combo.
 */
function comboProblem(combo: unknown, baby: unknown): string | null {
  if (typeof combo !== 'object' || combo === null) return 'world.combo is missing';
  const { multiplier, basePoints, carryTickAt } = combo as Record<string, unknown>;
  if (!Number.isInteger(multiplier) || (multiplier as number) < 1) return 'world.combo.multiplier';
  if (!isFiniteNumber(basePoints) || (basePoints as number) < 0) return 'world.combo.basePoints';
  const isCarried = (baby as Record<string, unknown>).state === 'carried';
  if (carryTickAt === null) return isCarried ? 'world.combo.carryTickAt' : null;
  if (!isFiniteNumber(carryTickAt) || (carryTickAt as number) < 0 || !isCarried) {
    return 'world.combo.carryTickAt';
  }
  return null;
}

/**
 * The special sequence (story 4.4): `id` and `lastId` are null or a planned sequence's id, the
 * instants are finite and not in the future, `stepIndex` is a step of the sequence's def,
 * `endedAt` is null while one runs, `nextMicroSleepAt` is null or finite, and the flow is in
 * `sequence` exactly when `id` is not null (the level's own end closes the sequence first).
 */
function sequenceProblem(
  sequence: unknown,
  flow: unknown,
  planned: PlannedLevel['sequences'],
  nowMs: number,
): string | null {
  if (typeof sequence !== 'object' || sequence === null) return 'world.sequence is missing';
  const slice = sequence as Record<string, unknown>;
  const isPlanned = (id: unknown): boolean =>
    id === null || (typeof id === 'string' && planned.some((entry) => entry.id === id));
  if (!isPlanned(slice.id)) return 'world.sequence.id';
  if (!isPlanned(slice.lastId)) return 'world.sequence.lastId';
  if (slice.id !== null && slice.lastId !== slice.id) return 'world.sequence.lastId';
  for (const key of ['startedAt', 'endsAt', 'stepEndsAt']) {
    if (!isFiniteNumber(slice[key]) || (slice[key] as number) < 0) return `world.sequence.${key}`;
  }
  if ((slice.startedAt as number) > nowMs) return 'world.sequence.startedAt';
  if (slice.endedAt !== null) {
    if (!isFiniteNumber(slice.endedAt) || (slice.endedAt as number) < 0) {
      return 'world.sequence.endedAt';
    }
    if (slice.id !== null || (slice.endedAt as number) > nowMs) return 'world.sequence.endedAt';
  }
  if (slice.nextMicroSleepAt !== null) {
    if (!isFiniteNumber(slice.nextMicroSleepAt) || (slice.nextMicroSleepAt as number) < 0) {
      return 'world.sequence.nextMicroSleepAt';
    }
  }
  const def = planned.find((entry) => entry.id === (slice.id ?? slice.lastId));
  if (!Number.isInteger(slice.stepIndex) || (slice.stepIndex as number) < 0) {
    return 'world.sequence.stepIndex';
  }
  if ((slice.stepIndex as number) >= Math.max(1, def?.def.steps.length ?? 1)) {
    return 'world.sequence.stepIndex';
  }
  if (((flow as { state: unknown }).state === 'sequence') !== (slice.id !== null)) {
    return 'world.sequence.id';
  }
  return null;
}

function propsProblem(
  props: unknown,
  mess: unknown,
  planned: PlannedLevel['props'],
): string | null {
  if (!Array.isArray(props) || props.length !== planned.length) return 'world.props';
  for (let i = 0; i < props.length; i++) {
    const problem = propProblem(props[i], i, planned);
    if (problem !== null) return problem;
  }
  if (typeof mess !== 'object' || mess === null) return 'world.mess is missing';
  const counts = mess as Record<string, unknown>;
  for (const key of ['propsOnFloor', 'propsBroken', 'mischiefs']) {
    if (!Number.isInteger(counts[key]) || (counts[key] as number) < 0) return `world.mess.${key}`;
  }
  // The counts are a function of the props: a snapshot that disagrees with itself is damaged.
  let onFloor = 0;
  let broken = 0;
  (props as PropSlice[]).forEach((prop, index) => {
    if (prop.isBroken) broken++;
    else if (
      prop.isOnFloor &&
      (planned[index] as PlannedLevel['props'][number]).spawnedAboveFloor
    ) {
      onFloor++;
    }
  });
  if (counts.propsOnFloor !== onFloor) return 'world.mess.propsOnFloor';
  if (counts.propsBroken !== broken) return 'world.mess.propsBroken';
  return null;
}

const isCount = (value: unknown): boolean => Number.isInteger(value) && (value as number) >= 0;

const MAMA_SCORE_KEYS = [
  'laughPoints',
  'babyStatePoints',
  'sighPoints',
  'screamPoints',
  'scorePoints',
  'stars',
  'lostStars',
] as const;

/**
 * Mama's counters are non-negative integers; her note (story 1.22) is `null` while the level plays
 * and a whole `MamaScore` once it has ended (`runFlow` gives it in the ending step), with a score of
 * at most `MAMA_SCORE_MAX_POINTS`, and at most five stars, the lost ones included.
 */
function scoreProblem(score: unknown, isEnded: boolean): string | null {
  if (typeof score !== 'object' || score === null) return 'world.score is missing';
  const slice = score as Record<string, unknown>;
  if (!isCount(slice.perfects)) return 'world.score.perfects';
  if (!isCount(slice.nearMisses)) return 'world.score.nearMisses';
  if (!isFiniteNumber(slice.comboPoints) || (slice.comboPoints as number) < 0) {
    return 'world.score.comboPoints';
  }
  const { final } = slice;
  if (!isEnded) return final === null ? null : 'world.score.final';
  if (typeof final !== 'object' || final === null) return 'world.score.final';
  const note = final as Record<string, unknown>;
  if (Object.keys(note).length !== MAMA_SCORE_KEYS.length) return 'world.score.final';
  for (const key of MAMA_SCORE_KEYS) {
    if (!isCount(note[key])) return `world.score.final.${key}`;
  }
  if ((note.scorePoints as number) > MAMA_SCORE_MAX_POINTS) return 'world.score.final.scorePoints';
  if ((note.stars as number) > STAR_COUNT_MAX) return 'world.score.final.stars';
  if ((note.stars as number) + (note.lostStars as number) > STAR_COUNT_MAX) {
    return 'world.score.final.lostStars';
  }
  return null;
}

/**
 * The effective feel (story 2.1) has the shape of the feel the sim was created with: the same keys,
 * leaf types and array lengths. Ranges are the sender's job (the sim cannot run `FeelSchema`).
 */
function feelProblem(feel: unknown, initial: Feel): string | null {
  if (typeof feel !== 'object' || feel === null) return 'world.feel is missing';
  return feelShapeProblem(initial, feel, 'world.feel');
}

/** The client's input latency: a finite number of ms, never negative (`SetInputLag`). */
function inputProblem(input: unknown): string | null {
  if (typeof input !== 'object' || input === null) return 'world.input is missing';
  const { lagMs } = input as Record<string, unknown>;
  if (!isFiniteNumber(lagMs) || (lagMs as number) < 0) return 'world.input.lagMs';
  return null;
}

function worldProblem(world: unknown, planned: PlannedLevel, initialFeel: Feel): string | null {
  if (typeof world !== 'object' || world === null) return 'world must be an object';
  const {
    time,
    rng,
    nextId,
    papa,
    baby,
    threats,
    props,
    mess,
    director,
    flow,
    gauges,
    disruptions,
    silence,
    carry,
    sequence,
    combo,
    score,
    input,
    feel,
  } = world as Record<string, unknown>;
  const clock = time as Record<string, unknown> | null | undefined;
  if (typeof clock !== 'object' || clock === null) return 'world.time is missing';
  const clockProblem = timeProblem(clock);
  if (clockProblem !== null) return clockProblem;
  const state = rng as Record<string, unknown> | null | undefined;
  if (typeof state !== 'object' || state === null) return 'world.rng is missing';
  for (const key of ['a', 'b', 'c', 'd']) {
    if (!Number.isInteger(state[key])) return `world.rng.${key}`;
  }
  if (!Number.isInteger(nextId)) return 'world.nextId';
  if (!Array.isArray(threats)) return 'world.threats';
  for (let i = 0; i < threats.length; i++) {
    const problem = threatProblem(threats[i], i, planned.waves.length);
    if (problem !== null) return problem;
  }
  // `runThreats` and the director index the level's threats by the instances' index.
  if (threats.length !== planned.threats.length) return 'world.threats';
  const ids = new Set<number>();
  for (let i = 0; i < threats.length; i++) {
    const threat = threats[i] as ThreatInstance;
    if (threat.defId !== (planned.threats[i] as PlannedThreats[number]).def.id) {
      return `world.threats[${i}].defId`;
    }
    if (ids.has(threat.id) || threat.id >= (nextId as number)) return `world.threats[${i}].id`;
    ids.add(threat.id);
  }
  const waveProblem = directorProblem(director, planned.waves.length);
  if (waveProblem !== null) return waveProblem;
  // A threat cannot come from a wave the director has not entered.
  const enteredWave = (director as { waveIndex: number }).waveIndex;
  for (let i = 0; i < threats.length; i++) {
    if ((threats[i] as ThreatInstance).waveIndex > enteredWave)
      return `world.threats[${i}].waveIndex`;
  }
  return (
    disruptionsProblem(disruptions, planned.disruptions, clock.sim as number) ??
    onPhoneProblem(papa, disruptions as readonly { state: unknown }[]) ??
    flowProblem(flow, clock.sim as number, planned.durationMs, planned.hasNoise, gauges) ??
    gaugesProblem(
      gauges,
      planned.microSleepIndex >= 0,
      planned.hasNoise,
      planned.hasBladder,
      planned.props.length,
      clock.sim as number,
    ) ??
    papaProblem(
      papa,
      planned.objects.map((object) => object.id),
      (baby as { state?: unknown } | null)?.state,
      planned.hasBladder,
    ) ??
    babyProblem(baby, papa, threats as readonly ThreatInstance[], clock.sim as number) ??
    carryProblem(carry, baby, planned.hasCarry, planned.armsCryIndex >= 0) ??
    comboProblem(combo, baby) ??
    sequenceProblem(sequence, flow, planned.sequences, clock.sim as number) ??
    silenceProblem(
      silence,
      baby,
      threats as readonly ThreatInstance[],
      clock.sim as number,
      (flow as { state: unknown }).state === 'ended',
    ) ??
    propsProblem(props, mess, planned.props) ??
    scoreProblem(score, (flow as { state: unknown }).state === 'ended') ??
    inputProblem(input) ??
    feelProblem(feel, initialFeel)
  );
}

/** What a valid snapshot hands over: a copy of its world and the decoded Rapier bytes. */
export interface RestoredSnapshot {
  world: World;
  physics: Uint8Array;
}

/**
 * A deep copy of the snapshot's world, ready to become the live one, with the Rapier bytes decoded.
 * Everything is checked here, before the caller changes anything: a refused snapshot leaves the sim as it was.
 */
export function worldFromSnapshot(
  snapshot: SimSnapshot,
  seed: number,
  feelHash: string,
  geometryHash: string,
  levelHash: string,
  planned: PlannedLevel,
  initialFeel: Feel,
): RestoredSnapshot {
  invariant(snapshot.version === 19, `unsupported snapshot version ${String(snapshot.version)}`);
  invariant(snapshot.seed === seed, 'the snapshot was taken by a sim with another seed');
  invariant(snapshot.feelHash === feelHash, 'the snapshot was taken by a sim with another feel');
  invariant(
    snapshot.geometryHash === geometryHash,
    'the snapshot was taken by a sim with another level geometry',
  );
  invariant(snapshot.levelHash === levelHash, 'the snapshot was taken by a sim with another level');
  const problem = worldProblem(snapshot.world, planned, initialFeel);
  invariant(problem === null, `invalid snapshot world: ${String(problem)}`);
  invariant(typeof snapshot.physics === 'string', 'invalid snapshot physics: not a string');
  const bytes = decodeBase64(snapshot.physics);
  invariant(bytes.ok, `invalid snapshot physics: ${bytes.ok ? '' : bytes.error}`);
  return { world: cloneJson(snapshot.world), physics: bytes.value };
}
