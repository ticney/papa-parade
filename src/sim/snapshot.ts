import { decodeBase64, encodeBase64 } from '@shared/base64';
import { MIN_TIME_SCALE } from '@shared/constants';
import { cloneJson } from '@shared/hash';
import { invariant } from '@shared/invariant';
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
   * 5 since story 1.15: the Rapier world, base64 (4 carried the base scale and the slow-mos in
   * `World.time`, since story 1.14; 3 named the level).
   */
  version: 5;
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
    version: 5,
    seed,
    feelHash,
    geometryHash,
    levelHash,
    world: cloneJson(world),
    physics: encodeBase64(physics),
  };
}

const PAPA_STATES: readonly unknown[] = ['idle', 'walkPath', 'walkDir', 'glide'];

function papaProblem(papa: unknown): string | null {
  if (typeof papa !== 'object' || papa === null) return 'world.papa is missing';
  const slice = papa as Record<string, unknown>;
  if (!PAPA_STATES.includes(slice.state)) return 'world.papa.state';
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

function threatProblem(threat: unknown, index: number): string | null {
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
  return null;
}

/** What `worldProblem` needs of the level: the defs it plans and its props, in order (both are index-aligned with the world's). */
export interface PlannedLevel {
  readonly threats: readonly { readonly def: { readonly id: string } }[];
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

/** A rotation of this length (squared) is a unit quaternion, within the tolerance of a float32 read. */
const QUATERNION_TOLERANCE = 1e-4;

function isUnitQuaternion(x: unknown, y: unknown, z: unknown, w: unknown): boolean {
  if (![x, y, z, w].every(isFiniteNumber)) return false;
  const length = Math.sqrt(
    (x as number) ** 2 + (y as number) ** 2 + (z as number) ** 2 + (w as number) ** 2,
  );
  return Math.abs(length - 1) <= QUATERNION_TOLERANCE;
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
  const { time, rng, nextId, papa, baby, threats, props, mess } = world as Record<string, unknown>;
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
    const problem = threatProblem(threats[i], i);
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
  return (
    papaProblem(papa) ??
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
  invariant(snapshot.version === 5, `unsupported snapshot version ${String(snapshot.version)}`);
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
