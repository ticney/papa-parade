import { decodeBase64, encodeBase64 } from '@shared/base64';
import {
  GAUGE_MAX_POINTS,
  MIN_TIME_SCALE,
  PHONE_RINGING_EVERY_MS,
  QUATERNION_LENGTH_TOLERANCE,
} from '@shared/constants';
import { cloneJson } from '@shared/hash';
import { invariant } from '@shared/invariant';
import { DISRUPTION_STATES } from './disruptions/disruptionFsm.ts';
import { FLOW_STATES, type FlowState } from './flow/flowFsm.ts';
import { isPapaBusy, PAPA_STATES, type PapaState } from './papa/papaFsm.ts';
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
   * 8 since story 1.20: `disruptions` (one instance per planned disruption) and the `onPhone`
   * state. 7 added `gauges`, `PapaSlice.objectId` / `busyUntil` and the `drink` / `asleep`
   * states. 6 added `director`, `flow` and `ThreatInstance.waveIndex` (story 1.18). 5 added the
   * Rapier world, base64 (4 carried the base scale and the slow-mos in `World.time`, since story
   * 1.14; 3 named the level).
   */
  version: 8;
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
    version: 8,
    seed,
    feelHash,
    geometryHash,
    levelHash,
    world: cloneJson(world),
    physics: encodeBase64(physics),
  };
}

function papaProblem(papa: unknown, objectIds: readonly string[]): string | null {
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
  // A busy Papa has an end (`busyUntil` > 0); any other state has none. Busy states have no path,
  // no direction and no glide: the checks below hold them to it.
  if (!isFiniteNumber(slice.busyUntil) || (slice.busyUntil as number) < 0) {
    return 'world.papa.busyUntil';
  }
  const isBusy = isPapaBusy({ state: slice.state as PapaState });
  if (isBusy !== (slice.busyUntil !== 0)) return 'world.papa.busyUntil';

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

const BABY_STATES: readonly unknown[] = ['wander', 'babble', 'targetLocked', 'approach', 'act'];

function isUnitVector(x: unknown, z: unknown): boolean {
  if (typeof x !== 'number' || typeof z !== 'number') return false;
  return Math.abs(Math.sqrt(x * x + z * z) - 1) <= 1e-6;
}

function babyProblem(baby: unknown, threats: readonly { id: number }[]): string | null {
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
  } else if (slice.state !== 'approach' && path.length !== 0) {
    return 'world.baby.path';
  }
  // The baby stares at, crawls to or plays out a target: it has one.
  const needsTarget =
    slice.state === 'targetLocked' || slice.state === 'approach' || slice.state === 'act';
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

function gaugesProblem(gauges: unknown, hasFatigue: boolean): string | null {
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

function flowProblem(flow: unknown, nowMs: number, durationMs: number): string | null {
  if (typeof flow !== 'object' || flow === null) return 'world.flow is missing';
  const slice = flow as Record<string, unknown>;
  if (!FLOW_STATES.includes(slice.state as FlowState)) return 'world.flow.state';
  if (!isFiniteNumber(slice.enteredAt) || (slice.enteredAt as number) < 0) {
    return 'world.flow.enteredAt';
  }
  // A state is entered in the past, and the level only ends once its time is up.
  if ((slice.enteredAt as number) > nowMs) return 'world.flow.enteredAt';
  if (slice.state === 'ended' && nowMs < durationMs) return 'world.flow.state';
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
  if (instance.state === 'idle' && instance.responseWindow !== null) {
    return `${where}.responseWindow`;
  }
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
  for (const key of ['propsOnFloor', 'propsBroken']) {
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

function worldProblem(world: unknown, planned: PlannedLevel): string | null {
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
    flowProblem(flow, clock.sim as number, planned.durationMs) ??
    gaugesProblem(gauges, planned.microSleepIndex >= 0) ??
    papaProblem(
      papa,
      planned.objects.map((object) => object.id),
    ) ??
    babyProblem(baby, threats as readonly ThreatInstance[]) ??
    propsProblem(props, mess, planned.props)
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
): RestoredSnapshot {
  invariant(snapshot.version === 8, `unsupported snapshot version ${String(snapshot.version)}`);
  invariant(snapshot.seed === seed, 'the snapshot was taken by a sim with another seed');
  invariant(snapshot.feelHash === feelHash, 'the snapshot was taken by a sim with another feel');
  invariant(
    snapshot.geometryHash === geometryHash,
    'the snapshot was taken by a sim with another level geometry',
  );
  invariant(snapshot.levelHash === levelHash, 'the snapshot was taken by a sim with another level');
  const problem = worldProblem(snapshot.world, planned);
  invariant(problem === null, `invalid snapshot world: ${String(problem)}`);
  invariant(typeof snapshot.physics === 'string', 'invalid snapshot physics: not a string');
  const bytes = decodeBase64(snapshot.physics);
  invariant(bytes.ok, `invalid snapshot physics: ${bytes.ok ? '' : bytes.error}`);
  return { world: cloneJson(snapshot.world), physics: bytes.value };
}
