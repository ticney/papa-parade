import { PROVISIONAL_ROOM_DEPTH_M, PROVISIONAL_ROOM_WIDTH_M, STEP_MS } from '@shared/constants';
import type { World } from '@sim';
import {
  BoxGeometry,
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Scene,
} from 'three';
import { PALETTE } from './materials/palette.ts';

// Provisional, removed with story 1.7: visual scaffolding, not game rules.
const GRID_CELL_M = 1;
/** The grid sits this far above the floor so that the two never fight for the depth buffer. */
const GRID_LIFT_M = 0.005;
const PROBE_SIZE_M = 0.5;
const PROBE_HALF_PATH_M = PROVISIONAL_ROOM_WIDTH_M / 2 - PROBE_SIZE_M;
const PROBE_PERIOD_MS = 4000;

export interface ProvisionalScene {
  readonly scene: Scene;
  /** Moves the probe to where the continuous sim clock (`world.time.sim + alpha * STEP_MS`) puts it. */
  update(world: Readonly<World>, alpha: number): void;
}

/** Lines every `GRID_CELL_M` over the room footprint, borders included. */
function createGridGeometry(): BufferGeometry {
  const halfWidth = PROVISIONAL_ROOM_WIDTH_M / 2;
  const halfDepth = PROVISIONAL_ROOM_DEPTH_M / 2;
  const positions: number[] = [];
  for (let x = -halfWidth; x <= halfWidth + 1e-6; x += GRID_CELL_M) {
    positions.push(x, GRID_LIFT_M, -halfDepth, x, GRID_LIFT_M, halfDepth);
  }
  for (let z = -halfDepth; z <= halfDepth + 1e-6; z += GRID_CELL_M) {
    positions.push(-halfWidth, GRID_LIFT_M, z, halfWidth, GRID_LIFT_M, z);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  return geometry;
}

/**
 * A flat floor the size of the provisional room, a grid on it (depth cue and room extents), and a
 * probe cube that slides back and forth as a function of the sim clock. It exists so that a human
 * or Playwright can *see* the sim run, pause and resume. Story 1.6 replaces this file with
 * `levelScene.ts`; story 1.7 deletes the probe. `MeshBasicMaterial` only: no lights, no toon yet.
 */
export function createProvisionalScene(): ProvisionalScene {
  const scene = new Scene();
  scene.background = new Color(PALETTE.ink);

  const floor = new Mesh(
    new PlaneGeometry(PROVISIONAL_ROOM_WIDTH_M, PROVISIONAL_ROOM_DEPTH_M),
    new MeshBasicMaterial({ color: PALETTE.cream }),
  );
  floor.name = 'floor';
  floor.rotation.x = -Math.PI / 2; // a plane is born vertical
  scene.add(floor);

  const grid = new LineSegments(
    createGridGeometry(),
    new LineBasicMaterial({ color: PALETTE.ink }),
  );
  grid.name = 'grid';
  scene.add(grid);

  const probe = new Mesh(
    new BoxGeometry(PROBE_SIZE_M, PROBE_SIZE_M, PROBE_SIZE_M),
    new MeshBasicMaterial({ color: PALETTE.primary }),
  );
  probe.name = 'probe';
  probe.position.y = PROBE_SIZE_M / 2;
  scene.add(probe);

  return {
    scene,
    update(world, alpha) {
      const clockMs = world.time.sim + alpha * STEP_MS;
      probe.position.x = PROBE_HALF_PATH_M * Math.sin((2 * Math.PI * clockMs) / PROBE_PERIOD_MS);
    },
  };
}
