/** An interactive object of the level at its floor point: what `pickContextObject` chooses among (`Sim.objects` fits). */
export interface ContextObject {
  readonly id: string;
  readonly xM: number;
  readonly zM: number;
}

/**
 * The object Space or A walks Papa to when no threat is active (story 1.17, D6): the nearest one to
 * Papa on the floor, at most `reachM` away (inclusive), ties to the earlier entry. Null when none is
 * in reach. Allocates nothing.
 */
export function pickContextObject(
  objects: readonly ContextObject[],
  papaXM: number,
  papaZM: number,
  reachM: number,
): string | null {
  const reachSquared = reachM * reachM;
  let bestId: string | null = null;
  let bestSquared = Number.POSITIVE_INFINITY;
  for (let i = 0; i < objects.length; i++) {
    const object = objects[i] as ContextObject;
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
