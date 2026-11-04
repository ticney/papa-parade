import type { LevelGeometry } from '@content/schemas/levelGeometry';
import { ISO_PITCH_DEG, ISO_YAW_DEG } from '@shared/constants';
import type { MischiefMark } from '@sim';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  type MeshToonMaterial,
  type Object3D,
} from 'three';
import type { ToonMaterialCache } from '../materials/toonMaterial.ts';

// The mess a silence's mischief leaves (story 3.15, FR72): one floor decal per mark of
// `world.afterEffects.mischiefMarks`, drawn until the level ends and, since the photo renders the frozen
// `World` through the same scene, on the end photo. Provisional art (E7 draws the final one): a handful of
// paper scraps for the tissues, a crayon scribble for the crayons. One mesh, one draw call, per mark.

/** The decals float this far above the floor so that they never fight it for the depth buffer, in metres. */
export const DECAL_LIFT_M = 0.012;
/** Size of a scrap of tissue, in metres. */
const SCRAP_M = 0.14;
/** The scraps lie within this radius of the mark, in metres. */
const SCATTER_M = 0.24;
/** Width of a crayon line, in metres. */
const LINE_M = 0.028;
/** The crayon scribble spans this much, in metres. */
const SCRIBBLE_M = 0.5;

const TISSUE_COLOR = 0xffffff;
/** One crayon colour per mark, in turn. */
const CRAYON_COLORS = [0xe0573b, 0x3b86e0, 0x43b05c] as const;

/**
 * The camera pitch the decals must be visible from, the lowest of the game camera (35°) and the end photo's
 * (`feel.fx.photoCamera`, 30° at the time of writing): a lower camera sees less behind furniture.
 */
export const DECAL_VIEW_PITCH_DEG = 30;
/** A decal that had to move is put this far past the edge of what hid it, in metres. */
const CLEAR_MARGIN_M = 0.2;
/** The search for a visible point moves by this much at a time, in metres... */
const SEARCH_STEP_M = 0.05;
/** ...and gives up after this far, in metres (the mark then stays where the baby was). */
const SEARCH_MAX_M = 3.5;

type Collider = LevelGeometry['colliders'][number];

/** Whether a point on the floor is hidden from a camera looking from `(sin yaw, cos yaw)` at `pitch` by a collider. */
function isHidden(
  xM: number,
  zM: number,
  colliders: readonly Collider[],
  towardX: number,
  towardZ: number,
  tanPitch: number,
): boolean {
  for (const collider of colliders) {
    const [cx, cy, cz] = collider.centerM;
    const [hx, hy, hz] = collider.halfExtentsM;
    const topM = cy + hy;
    // A wall is no cover for a floor point: it is the room's edge, and the point is in front of it.
    if (topM > 2) continue;
    // March from the point towards the camera until the ray is above the collider's top.
    const maxS = topM / tanPitch;
    for (let s = 0; s <= maxS; s += SEARCH_STEP_M) {
      const x = xM + towardX * s;
      const z = zM + towardZ * s;
      if (Math.abs(x - cx) <= hx && Math.abs(z - cz) <= hz && s * tanPitch <= topM) return true;
    }
  }
  return false;
}

/**
 * Where a mark's decal is drawn. At the mark itself when it can be seen from a camera at `yawDeg` / `pitchDeg`;
 * else (the baby hid behind the sofa, the whole point of a silence), moved towards the camera, along the line
 * of sight, to the first floor point that is not hidden by a collider, plus a margin. If none is found within
 * `SEARCH_MAX_M` it stays where it is. Pure; writes into `out`.
 */
export function visibleDecalPoint(
  xM: number,
  zM: number,
  colliders: readonly Collider[],
  out: { xM: number; zM: number },
  yawDeg = ISO_YAW_DEG,
  pitchDeg = DECAL_VIEW_PITCH_DEG,
): void {
  out.xM = xM;
  out.zM = zM;
  const yaw = (yawDeg * Math.PI) / 180;
  const towardX = Math.sin(yaw);
  const towardZ = Math.cos(yaw);
  const tanPitch = Math.tan((Math.min(pitchDeg, ISO_PITCH_DEG) * Math.PI) / 180);
  if (!isHidden(xM, zM, colliders, towardX, towardZ, tanPitch)) return;
  for (let s = SEARCH_STEP_M; s <= SEARCH_MAX_M; s += SEARCH_STEP_M) {
    const x = xM + towardX * s;
    const z = zM + towardZ * s;
    if (!isHidden(x, z, colliders, towardX, towardZ, tanPitch)) {
      out.xM = x + towardX * CLEAR_MARGIN_M;
      out.zM = z + towardZ * CLEAR_MARGIN_M;
      return;
    }
  }
}

/** A fraction in [0, 1) from two integers: the same decal every time, with no `Math.random` (the scene is replayable). */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (h >>> 0) / 4294967296;
}

/** Adds a flat quad of `widthM` x `lengthM` centred on `(xM, zM)`, turned by `angleRad`, to the buffers. */
function pushQuad(
  positions: number[],
  indices: number[],
  xM: number,
  zM: number,
  widthM: number,
  lengthM: number,
  angleRad: number,
): void {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const base = positions.length / 3;
  for (const [u, v] of [
    [-widthM / 2, -lengthM / 2],
    [widthM / 2, -lengthM / 2],
    [widthM / 2, lengthM / 2],
    [-widthM / 2, lengthM / 2],
  ] as const) {
    positions.push(xM + u * cos - v * sin, 0, zM + u * sin + v * cos);
  }
  indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
}

/**
 * The geometry of one decal, around its own origin, lying flat: a few scraps for the tissues, a zigzag of
 * thin quads for the crayons. `index` (the mark's) varies the pattern from one mark to the next.
 */
export function createDecalGeometry(gag: string, index: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  if (gag === 'crayon_scribbles') {
    const turns = 6;
    let previousX = -SCRIBBLE_M / 2;
    let previousZ = 0;
    for (let i = 1; i <= turns; i++) {
      const x = -SCRIBBLE_M / 2 + (SCRIBBLE_M * i) / turns;
      const z = (i % 2 === 0 ? -1 : 1) * (0.1 + 0.08 * hash01(index, i));
      const dx = x - previousX;
      const dz = z - previousZ;
      const length = Math.hypot(dx, dz);
      pushQuad(
        positions,
        indices,
        (x + previousX) / 2,
        (z + previousZ) / 2,
        LINE_M,
        length,
        Math.atan2(-dx, dz),
      );
      previousX = x;
      previousZ = z;
    }
  } else {
    for (let i = 0; i < 5; i++) {
      const angle = hash01(index, i) * Math.PI * 2;
      const radius = SCATTER_M * Math.sqrt(hash01(index, i + 10));
      pushQuad(
        positions,
        indices,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        SCRAP_M * (0.7 + 0.5 * hash01(index, i + 20)),
        SCRAP_M * (0.7 + 0.5 * hash01(index, i + 30)),
        hash01(index, i + 40) * Math.PI,
      );
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  const normals: number[] = [];
  for (let i = 0; i < positions.length / 3; i++) normals.push(0, 1, 0);
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(indices);
  return geometry;
}

export interface MischiefDecals {
  /**
   * Draws one decal per mark: the new ones are made, the ones the world no longer lists are removed (a
   * restart). Marks are never removed during a level, so this does nothing on most frames.
   */
  sync(marks: readonly MischiefMark[]): void;
  /** How many decals are drawn. */
  readonly count: number;
  /** Removes every decal (a restart). */
  clear(): void;
  dispose(): void;
}

/**
 * The decals of a level, under `parent` (the content root: a shake moves them with the room). Lit by the
 * scene's lights through the toon materials, so the pénombre darkens them like the floor they lie on.
 */
export function createMischiefDecals(
  parent: Object3D,
  colliders: readonly Collider[],
  toon: ToonMaterialCache,
): MischiefDecals {
  const meshes: Mesh[] = [];
  const point = { xM: 0, zM: 0 };
  const materialOf = (gag: string, index: number): MeshToonMaterial =>
    toon.get(
      new Color(
        gag === 'crayon_scribbles'
          ? (CRAYON_COLORS[index % CRAYON_COLORS.length] as number)
          : TISSUE_COLOR,
      ),
    );
  const clear = (): void => {
    for (const mesh of meshes) {
      parent.remove(mesh);
      mesh.geometry.dispose();
    }
    meshes.length = 0;
  };
  return {
    sync(marks) {
      if (marks.length < meshes.length) clear();
      for (let i = meshes.length; i < marks.length; i++) {
        const mark = marks[i] as MischiefMark;
        const mesh = new Mesh(createDecalGeometry(mark.gag, i), materialOf(mark.gag, i));
        mesh.name = `mischief_decal_${i}`;
        visibleDecalPoint(mark.xM, mark.zM, colliders, point);
        mesh.position.set(point.xM, DECAL_LIFT_M, point.zM);
        mesh.receiveShadow = false;
        mesh.castShadow = false;
        parent.add(mesh);
        meshes.push(mesh);
      }
    },
    get count() {
      return meshes.length;
    },
    clear,
    dispose: clear,
  };
}
