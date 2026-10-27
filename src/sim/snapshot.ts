import { cloneJson } from '@shared/hash';
import { invariant } from '@shared/invariant';
import { THREAT_STATES } from './threats/threatFsm.ts';
import type { World } from './world.ts';

/**
 * The restorable state: `World` only, plus the identity of the sim it came from (a snapshot of
 * another seed, feel, level geometry or level is refused on restore). Pending commands are rebuilt from the journal, and
 * freeze is a real-time artefact. Story 1.15 adds the Rapier blob and bumps `version`.
 */
export interface SimSnapshot {
  /** 3 since story 1.10: the snapshot names the level (its planned threats) it was taken on. */
  version: 3;
  seed: number;
  feelHash: string;
  geometryHash: string;
  levelHash: string;
  world: World;
}

export function takeSnapshot(
  world: World,
  seed: number,
  feelHash: string,
  geometryHash: string,
  levelHash: string,
): SimSnapshot {
  return { version: 3, seed, feelHash, geometryHash, levelHash, world: cloneJson(world) };
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
  // A glide state has a glide, any other does not; the path of a glide is not checked (it is fully
  // walked at the step of the arrival, before the state goes back to idle).
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

function babyProblem(baby: unknown): string | null {
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
  if (needsTarget && slice.targetThreatId === null) return 'world.baby.targetThreatId';
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

function worldProblem(world: unknown): string | null {
  if (typeof world !== 'object' || world === null) return 'world must be an object';
  const { time, rng, nextId, papa, baby, threats } = world as Record<string, unknown>;
  const clock = time as Record<string, unknown> | null | undefined;
  if (typeof clock !== 'object' || clock === null) return 'world.time is missing';
  if (typeof clock.sim !== 'number' || !Number.isFinite(clock.sim)) return 'world.time.sim';
  if (typeof clock.scale !== 'number' || !Number.isFinite(clock.scale)) return 'world.time.scale';
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
  return papaProblem(papa) ?? babyProblem(baby);
}

/** A deep copy of the snapshot's world, ready to become the live one. */
export function worldFromSnapshot(
  snapshot: SimSnapshot,
  seed: number,
  feelHash: string,
  geometryHash: string,
  levelHash: string,
): World {
  invariant(snapshot.version === 3, `unsupported snapshot version ${String(snapshot.version)}`);
  invariant(snapshot.seed === seed, 'the snapshot was taken by a sim with another seed');
  invariant(snapshot.feelHash === feelHash, 'the snapshot was taken by a sim with another feel');
  invariant(
    snapshot.geometryHash === geometryHash,
    'the snapshot was taken by a sim with another level geometry',
  );
  invariant(snapshot.levelHash === levelHash, 'the snapshot was taken by a sim with another level');
  const problem = worldProblem(snapshot.world);
  invariant(problem === null, `invalid snapshot world: ${String(problem)}`);
  return cloneJson(snapshot.world);
}
