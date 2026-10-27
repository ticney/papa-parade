import { cloneJson } from '@shared/hash';
import { invariant } from '@shared/invariant';
import type { World } from './world.ts';

/**
 * The restorable state: `World` only, plus the identity of the sim it came from (a snapshot of
 * another seed or feel is refused on restore). Pending commands are rebuilt from the journal, and
 * freeze is a real-time artefact. Story 1.15 adds the Rapier blob and bumps `version`.
 */
export interface SimSnapshot {
  version: 1;
  seed: number;
  feelHash: string;
  world: World;
}

export function takeSnapshot(world: World, seed: number, feelHash: string): SimSnapshot {
  return { version: 1, seed, feelHash, world: cloneJson(world) };
}

function worldProblem(world: unknown): string | null {
  if (typeof world !== 'object' || world === null) return 'world must be an object';
  const { time, rng, nextId } = world as Record<string, unknown>;
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
  return null;
}

/** A deep copy of the snapshot's world, ready to become the live one. */
export function worldFromSnapshot(snapshot: SimSnapshot, seed: number, feelHash: string): World {
  invariant(snapshot.version === 1, `unsupported snapshot version ${String(snapshot.version)}`);
  invariant(snapshot.seed === seed, 'the snapshot was taken by a sim with another seed');
  invariant(snapshot.feelHash === feelHash, 'the snapshot was taken by a sim with another feel');
  const problem = worldProblem(snapshot.world);
  invariant(problem === null, `invalid snapshot world: ${String(problem)}`);
  return cloneJson(snapshot.world);
}
