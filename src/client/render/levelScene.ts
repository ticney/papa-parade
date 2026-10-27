import { parseNodeName } from '@content/levelNodeNames';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import type { World } from '@sim';
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  type Material,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Scene,
} from 'three';
import type { LevelAssets } from '../assets/loadLevelAssets.ts';
import { addBlobShadows } from './blobShadow.ts';
import type { RoomSize } from './isoCamera.ts';
import { PALETTE } from './materials/palette.ts';
import { createToonMaterialCache } from './materials/toonMaterial.ts';

// Art direction, not GDD numbers: Geo tunes the light here until the final art (E7).
const AMBIENT_INTENSITY = 0.9;
const SUN_INTENSITY = 1.3;
/** Where the sun sits relative to the room centre: the camera side, high, in metres. */
const SUN_OFFSET_M: readonly [number, number, number] = [5, 9, 7];

// Provisional, removed with story 1.7 (papa moves): the probe cube that lets a human or Playwright
// *see* the sim run, pause and resume. A cheap basic mesh, not toon, so it stays distinct.
const PROBE_SIZE_M = 0.5;
const PROBE_PERIOD_MS = 4000;

export interface LevelScene {
  /** The level id (`salon_crawler`). */
  readonly id: string;
  readonly scene: Scene;
  /** The box the camera fits, from the bounds of the visual nodes. */
  readonly room: RoomSize;
  /** Moves the probe to where the continuous sim clock (`world.time.sim + alpha * STEP_MS`) puts it. */
  update(world: Readonly<World>, alpha: number): void;
  /** Frees geometries, materials and textures. Call it when a new level replaces this one. */
  dispose(): void;
}

/** The camera box of a level: width and depth from the bounds, height above the floor (y = 0). */
export function roomOf(geometry: LevelGeometry): RoomSize {
  const [minX, , minZ] = geometry.boundsMinM;
  const [maxX, maxY, maxZ] = geometry.boundsMaxM;
  return {
    widthM: maxX - minX,
    depthM: maxZ - minZ,
    heightM: maxY,
    centerXM: (minX + maxX) / 2,
    centerZM: (minZ + maxZ) / 2,
  };
}

/** Where the probe slides: along x through the centre of the room, on the row of `papa_spawn`. */
export function probePathOf(geometry: LevelGeometry): {
  centerXM: number;
  zM: number;
  halfPathM: number;
} {
  const room = roomOf(geometry);
  const spawn = geometry.anchors.find((anchor) => anchor.id === 'papa_spawn');
  return {
    centerXM: room.centerXM ?? 0,
    zM: spawn?.positionM[2] ?? room.centerZM ?? 0,
    halfPathM: Math.max(0, room.widthM / 2 - PROBE_SIZE_M),
  };
}

/** Nodes the game uses but the player never sees: collision, navigation, zones, anchors (D4). */
function isHiddenInGame(name: string): boolean {
  const parsed = parseNodeName(name);
  return parsed.ok && parsed.value.kind !== 'visual' && parsed.value.kind !== 'prop';
}

function disposeMaterial(material: Material | Material[]): void {
  for (const one of Array.isArray(material) ? material : [material]) one.dispose();
}

function disposeObject(object: Object3D): void {
  object.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function originalColor(material: Material | Material[]): Color {
  const one = Array.isArray(material) ? material[0] : material;
  const color = (one as { color?: unknown } | undefined)?.color;
  return color instanceof Color ? color : new Color(PALETTE.cream);
}

/**
 * The scene of one level: the loaded model with its non-visual nodes removed, every material
 * swapped for a shared toon one (keeping each mesh's colour), lights, blob shadows (no shadow map),
 * and the provisional probe. The model is taken over: it belongs to this scene from now on.
 */
export function createLevelScene(assets: LevelAssets): LevelScene {
  const { geometry, model } = assets;
  const scene = new Scene();
  scene.background = new Color(PALETTE.ink);

  const hidden: Object3D[] = [];
  model.traverse((node) => {
    if (node !== model && isHiddenInGame(node.name)) hidden.push(node);
  });
  for (const node of hidden) {
    disposeObject(node);
    node.removeFromParent();
  }

  const toon = createToonMaterialCache();
  model.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    const original = node.material;
    node.material = toon.get(originalColor(original));
    disposeMaterial(original);
  });
  scene.add(model);

  const room = roomOf(geometry);
  const centerX = room.centerXM ?? 0;
  const centerZ = room.centerZM ?? 0;
  scene.add(new AmbientLight(0xffffff, AMBIENT_INTENSITY));
  const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
  sun.position.set(centerX + SUN_OFFSET_M[0], SUN_OFFSET_M[1], centerZ + SUN_OFFSET_M[2]);
  sun.target.position.set(centerX, 0, centerZ);
  scene.add(sun, sun.target);

  const shadows = addBlobShadows(scene, geometry.colliders);

  const path = probePathOf(geometry);
  const probe = new Mesh(
    new BoxGeometry(PROBE_SIZE_M, PROBE_SIZE_M, PROBE_SIZE_M),
    new MeshBasicMaterial({ color: PALETTE.primary }),
  );
  probe.name = 'probe';
  probe.position.set(path.centerXM, PROBE_SIZE_M / 2, path.zM);
  scene.add(probe);

  return {
    id: assets.id,
    scene,
    room,
    update(world, alpha) {
      const clockMs = world.time.sim + alpha * STEP_MS;
      probe.position.x =
        path.centerXM + path.halfPathM * Math.sin((2 * Math.PI * clockMs) / PROBE_PERIOD_MS);
    },
    dispose() {
      disposeObject(scene);
      toon.dispose();
      shadows.dispose();
      scene.clear();
    },
  };
}
