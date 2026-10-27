import { createRng, type RngState } from '@shared/rng';
import { asSimMs, type SimMs } from '@shared/time';

/**
 * The whole simulated state: plain serializable data (no classes, functions, Map/Set, Three or
 * Rapier handles). Later stories add their slice (papa, baby, threats…).
 */
export interface World {
  time: {
    /** Sim time, in ms. Advances by exactly `STEP_MS` per step, whatever `scale` is. */
    sim: SimMs;
    /** `timeScale`: how fast the client loop feeds steps (1 = real time). Never 0. */
    scale: number;
  };
  rng: RngState;
  /** Next entity id. Ids come from {@link allocateId}, never from a UUID or a global counter. */
  nextId: number;
}

export function createWorld(seed: number): World {
  return { time: { sim: asSimMs(0), scale: 1 }, rng: createRng(seed), nextId: 1 };
}

export function allocateId(world: World): number {
  return world.nextId++;
}
