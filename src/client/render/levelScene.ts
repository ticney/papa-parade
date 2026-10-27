import { looksLikeGameplayNode, parseNodeName } from '@content/levelNodeNames';
import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { STEP_MS } from '@shared/constants';
import { log } from '@shared/log';
import type { SimMs } from '@shared/time';
import type { World } from '@sim';
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Group,
  type Material,
  Mesh,
  type Object3D,
  Scene,
} from 'three';
import type { LevelAssets } from '../assets/loadLevelAssets.ts';
import { addBlobShadows } from './blobShadow.ts';
import type { RoomSize } from './isoCamera.ts';
import { PALETTE } from './materials/palette.ts';
import { createToonMaterialCache } from './materials/toonMaterial.ts';
import { createShake } from './vfx/shake.ts';
import { createSoundWaves } from './vfx/soundWaves.ts';
import { createBabyView } from './views/babyView.ts';
import { createPapaView } from './views/papaView.ts';

// Art direction, not GDD numbers: Geo tunes the light here until the final art (E7).
const AMBIENT_INTENSITY = 0.9;
const SUN_INTENSITY = 1.3;
/** Where the sun sits relative to the room centre: the camera side, high, in metres. */
const SUN_OFFSET_M: readonly [number, number, number] = [5, 9, 7];

/** The sizes of the agents the scene draws, in metres (the feel's, passed by the session). */
export interface SceneBodies {
  papaRadiusM: number;
  babyRadiusM: number;
}

/**
 * What the feedback director plays in the 3D world, on the sim clock: a pause freezes it, a
 * slow-mo slows it and a restart frees it. Times are sim ms.
 */
export interface LevelFx {
  /** An ink ring on the floor at (`xM`, `zM`) that grows to `maxRadiusM` and fades over `durationMs`. */
  soundWave(xM: number, zM: number, maxRadiusM: number, durationMs: number, startAt: SimMs): void;
  /** Shakes the room (not the camera) by up to `amplitudeM` for `durationMs`. */
  shake(amplitudeM: number, durationMs: number, startAt: SimMs): void;
}

export interface LevelScene {
  /** The level id (`salon_crawler`). */
  readonly id: string;
  readonly scene: Scene;
  /** The box the camera fits, from the bounds of the visual nodes. */
  readonly room: RoomSize;
  /** The effects of the level; they die with it. */
  readonly fx: LevelFx;
  /**
   * Moves what the world moves: today Papa and the baby, drawn `alpha` of the way from the last
   * step to the next; then the effects, on the interpolated sim clock.
   */
  update(world: Readonly<World>, alpha: number): void;
  /** Frees geometries, materials and textures. Call it when a new level replaces this one. */
  dispose(): void;
}

/**
 * The camera box of a level: its bounds, down to the lowest point below the floor (y = 0) if
 * something such as a stairwell goes there.
 */
export function roomOf(geometry: LevelGeometry): RoomSize {
  const [minX, minY, minZ] = geometry.boundsMinM;
  const [maxX, maxY, maxZ] = geometry.boundsMaxM;
  const floorYM = Math.min(0, minY);
  return {
    widthM: maxX - minX,
    depthM: maxZ - minZ,
    heightM: maxY - floorYM,
    floorYM,
    centerXM: (minX + maxX) / 2,
    centerZM: (minZ + maxZ) / 2,
  };
}

/** Nodes the game uses but the player never sees: collision, navigation, zones, anchors (D4). */
function isHiddenInGame(name: string): boolean {
  const parsed = parseNodeName(name);
  if (parsed.ok) return parsed.value.kind !== 'visual' && parsed.value.kind !== 'prop';
  // A mistyped gameplay node (`COL_Sofa`) must not show as a grey box in the room: the extractor
  // and the Blender gate refuse it, so reaching here means a stale or hand-made `.glb`.
  if (looksLikeGameplayNode(name)) {
    log.warn('assets', `hiding a malformed gameplay node: ${parsed.error}`, { name });
    return true;
  }
  return false;
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
 * Papa and the baby. The model is taken over: it belongs to this scene from now on. The bodies'
 * radii are the feel's, read once when the level starts (a `SetFeel` takes effect at the next level).
 */
export function createLevelScene(assets: LevelAssets, bodies: SceneBodies): LevelScene {
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
  // The room, its shadows, Papa, the baby and the waves live under one root: a shake moves the
  // root, not the camera, so the framing and the world UI layer stay put. The lights stay outside.
  const content = new Group();
  content.name = 'content_root';
  scene.add(content);
  content.add(model);

  const room = roomOf(geometry);
  const centerX = room.centerXM ?? 0;
  const centerZ = room.centerZM ?? 0;
  scene.add(new AmbientLight(0xffffff, AMBIENT_INTENSITY));
  const sun = new DirectionalLight(0xffffff, SUN_INTENSITY);
  sun.position.set(centerX + SUN_OFFSET_M[0], SUN_OFFSET_M[1], centerZ + SUN_OFFSET_M[2]);
  sun.target.position.set(centerX, 0, centerZ);
  scene.add(sun, sun.target);

  const shadows = addBlobShadows(content, geometry.colliders);

  const papa = createPapaView(content, toon, shadows.kit, bodies.papaRadiusM);
  const baby = createBabyView(content, toon, shadows.kit, bodies.babyRadiusM);
  const waves = createSoundWaves(content, PALETTE.ink);
  const shake = createShake(content);
  const fx: LevelFx = {
    soundWave: (xM, zM, maxRadiusM, durationMs, startAt) =>
      waves.play(xM, zM, maxRadiusM, durationMs, startAt),
    shake: (amplitudeM, durationMs, startAt) => shake.start(amplitudeM, durationMs, startAt),
  };

  return {
    id: assets.id,
    scene,
    room,
    fx,
    update(world, alpha) {
      papa.update(world.papa, alpha);
      baby.update(world.baby, alpha);
      const clockMs = world.time.sim + alpha * STEP_MS;
      waves.update(clockMs);
      shake.update(clockMs);
    },
    dispose() {
      waves.dispose();
      disposeObject(scene);
      toon.dispose();
      shadows.dispose();
      scene.clear();
    },
  };
}
