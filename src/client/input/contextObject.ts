import type { ObjectKind } from '@content/schemas/level';

/** An interactive object of the level at its floor point: what `pickContextObject` chooses among (`Sim.objects` fits). */
export interface ContextObject {
  readonly id: string;
  readonly kind: ObjectKind;
  readonly xM: number;
  readonly zM: number;
}

/**
 * The object Space or A walks Papa to when no threat is active (story 1.17, D6): the nearest one to
 * Papa on the floor, at most `reachM` away (inclusive), ties to the earlier entry. Null when none is
 * in reach. An object of the `skippedKind` is not considered (story 4.3: a toilet is no object in
 * reach while the baby is carried, so the action puts him down instead). Allocates nothing.
 */
export function pickContextObject(
  objects: readonly ContextObject[],
  papaXM: number,
  papaZM: number,
  reachM: number,
  skippedKind: ObjectKind | null = null,
): string | null {
  const reachSquared = reachM * reachM;
  let bestId: string | null = null;
  let bestSquared = Number.POSITIVE_INFINITY;
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i] as ContextObject;
    if (object.kind === skippedKind) continue;
    const dx = object.xM - papaXM;
    const dz = object.zM - papaZM;
    const squared = dx * dx + dz * dz;
    if (squared <= reachSquared && squared < bestSquared) {
      bestId = object.id;
      bestSquared = squared;
    }
  }
  return bestId;
}

/** Whether an object of `kind` is at most `reachM` from Papa (inclusive), nearest or not. Allocates nothing. */
export function isKindInReach(
  objects: readonly ContextObject[],
  kind: ObjectKind,
  papaXM: number,
  papaZM: number,
  reachM: number,
): boolean {
  const reachSquared = reachM * reachM;
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i] as ContextObject;
    if (object.kind !== kind) continue;
    const dx = object.xM - papaXM;
    const dz = object.zM - papaZM;
    if (dx * dx + dz * dz <= reachSquared) return true;
  }
  return false;
}
