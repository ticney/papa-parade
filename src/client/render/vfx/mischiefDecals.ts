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
// paper scraps for the tissues, a crayon scribble for the crayons, a pale puddle of purée with a few
// splashes around it for the pot that boiled over (story 9.5), forks and spoons strewn on the floor for the baby
// who got into the dishwasher (story 9.6), and, for the five mischiefs of the big salon (story 9.7), white shards
// (the dishes), grey discs (the pans and their lids), beige and green scraps (the peelings), a dark patch with
// crumbs (the soil) and a brown puddle (the coffee). One mesh, one draw call, per mark.

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
/** The purée of the pot that boiled over: a pale yellow. */
const PUREE_COLOR = 0xf0d878;
/** The puddle's mean radius, in metres, and how far its edge wanders from it (a share of the radius). */
const PUDDLE_RADIUS_M = 0.28;
const PUDDLE_WOBBLE_PCT = 30;
/** The rim of the puddle is this many points. */
const PUDDLE_POINTS = 14;
/** The splashes around the puddle: how many, how big (a quad's side) and how far from the centre, in metres. */
const SPLASH_COUNT = 4;
const SPLASH_M = 0.07;
const SPLASH_REACH_M = 0.46;
/** One crayon colour per mark, in turn. */
const CRAYON_COLORS = [0xe0573b, 0x3b86e0, 0x43b05c] as const;
/** The cutlery the baby threw out of the dishwasher (story 9.6): a steel grey that shows on the pale floor. */
const CUTLERY_COLOR = 0x7f8b97;
/** A fork or a knife on the floor: its length and width, in metres, and the spoons' bowl (a square's side). */
const CUTLERY_LENGTH_M = 0.45;
const CUTLERY_WIDTH_M = 0.07;
const CUTLERY_BOWL_M = 0.13;
/** How many pieces lie around the mark, and how far from it (a radius), in metres. */
const CUTLERY_COUNT = 6;
const CUTLERY_SCATTER_M = 0.45;

// The five mischiefs of the big salon (story 9.7). Provisional art, like the others.
/** The broken dishes: a pale china white-blue (not the tissues' pure white), in sharp shards. */
const SHARD_COLOR = 0xdfe9f2;
/** How many shards, the length of their sides (a share of `SHARD_SIZE_M`, varied) and how far they fly, in metres. */
const SHARD_COUNT = 9;
const SHARD_SIZE_M = 0.16;
const SHARD_SCATTER_M = 0.5;
/** The pans and lids that crashed: a dark metal grey. */
const PAN_COLOR = 0x59606b;
/** A pan's and a lid's radius, in metres; the discs are this many points round, and lie within the scatter radius. */
const PAN_RADIUS_M = 0.15;
const LID_RADIUS_M = 0.1;
const DISC_POINTS = 10;
const PAN_COUNT = 4;
const PAN_SCATTER_M = 0.4;
/** The peelings, one colour per mark in turn (beige, green): thin scraps, this many, of this size (length, width) in metres. */
const PEELING_COLORS = [0xd9c59a, 0x8fb85a] as const;
const PEELING_COUNT = 9;
const PEELING_LENGTH_M = 0.17;
const PEELING_WIDTH_M = 0.05;
const PEELING_SCATTER_M = 0.45;
/** The soil on the rug: a dark brown patch with crumbs. */
const SOIL_COLOR = 0x4a3223;
const SOIL_RADIUS_M = 0.26;
const SOIL_CRUMB_COUNT = 6;
const SOIL_CRUMB_M = 0.05;
const SOIL_CRUMB_REACH_M = 0.42;
/** The spilled coffee: a warm brown puddle. */
const COFFEE_COLOR = 0x7a4a2b;
const COFFEE_RADIUS_M = 0.27;

/**
 * The colour of each gag's decal, by gag id. A list is one colour per mark of that gag, in turn. A gag with no row has
 * the tissues' white: a new gag is one line here (and one branch in `createDecalGeometry`).
 */
const DECAL_COLORS: Readonly<Record<string, number | readonly number[]>> = {
  crayon_scribbles: CRAYON_COLORS,
  pot_boiled_over: PUREE_COLOR,
  baby_in_dishwasher: CUTLERY_COLOR,
  dishes_on_floor: SHARD_COLOR,
  pan_concert: PAN_COLOR,
  peelings_everywhere: PEELING_COLORS,
  soil_on_rug: SOIL_COLOR,
  coffee_spilled: COFFEE_COLOR,
};

/** The colour of the decal of the mark number `index` of `gag` (`index` counts the marks of that gag only). */
export function decalColorOf(gag: string, index: number): number {
  const color = DECAL_COLORS[gag] ?? TISSUE_COLOR;
  return typeof color === 'number' ? color : (color[index % color.length] as number);
}

/** A decal that had to move is put this far past the edge of what hid it, in metres. */
const CLEAR_MARGIN_M = 0.2;
/** The search for a visible point moves by this much at a time, in metres... */
const SEARCH_STEP_M = 0.05;
/** ...and gives up after this far, in metres (the mark then stays where the baby was). */
const SEARCH_MAX_M = 3.5;

type Collider = LevelGeometry['colliders'][number];

/** A camera the decals must be seen from: where it looks from around the vertical, and how high. */
export interface DecalView {
  readonly yawDeg: number;
  readonly pitchDeg: number;
}

/** What can hide a decal, and where it may be put. */
export interface DecalCover {
  readonly colliders: readonly Collider[];
  /** Colliders taller than this are the room's walls, no cover for a floor point (`feedback.json › render.decalWallHeightM`). */
  readonly wallHeightM: number;
  /** The box the room fits (`LevelGeometry`): a decal is never moved out of it. */
  readonly boundsMinM: readonly number[];
  readonly boundsMaxM: readonly number[];
}

/** The game camera, one of the views a decal must be seen from. */
export const GAME_VIEW: DecalView = { yawDeg: ISO_YAW_DEG, pitchDeg: ISO_PITCH_DEG };

/** Whether a floor point is hidden from a camera looking from `(sin yaw, cos yaw)` at `pitch` by a collider. */
function isHiddenFrom(xM: number, zM: number, cover: DecalCover, view: DecalView): boolean {
  const yaw = (view.yawDeg * Math.PI) / 180;
  const towardX = Math.sin(yaw);
  const towardZ = Math.cos(yaw);
  const tanPitch = Math.tan((view.pitchDeg * Math.PI) / 180);
  for (const collider of cover.colliders) {
    const [cx, cy, cz] = collider.centerM;
    const [hx, hy, hz] = collider.halfExtentsM;
    const topM = cy + hy;
    // A wall is no cover for a floor point: it is the room's edge, and the point is in front of it.
    if (topM > cover.wallHeightM) continue;
    // March from the point towards the camera until the ray is above the collider's top.
    const maxS = topM / tanPitch;
    for (let s = 0; s <= maxS; s += SEARCH_STEP_M) {
      const x = xM + towardX * s;
      const z = zM + towardZ * s;
      if (Math.abs(x - cx) <= hx && Math.abs(z - cz) <= hz) return true;
    }
  }
  return false;
}

function isHidden(xM: number, zM: number, cover: DecalCover, views: readonly DecalView[]): boolean {
  for (const view of views) if (isHiddenFrom(xM, zM, cover, view)) return true;
  return false;
}

function isInRoom(xM: number, zM: number, cover: DecalCover): boolean {
  return (
    xM >= (cover.boundsMinM[0] as number) &&
    xM <= (cover.boundsMaxM[0] as number) &&
    zM >= (cover.boundsMinM[2] as number) &&
    zM <= (cover.boundsMaxM[2] as number)
  );
}

/**
 * Where a mark's decal is drawn. At the mark itself when every one of `views` (the game camera, the end
 * photo's) can see it; else (the baby hid behind the sofa, the whole point of a silence), moved towards the
 * first view's camera, along the line of sight, to the first floor point inside the room that no collider
 * hides from any view, plus a margin. If none is found within `SEARCH_MAX_M` it stays where it is. Pure;
 * writes into `out`.
 */
export function visibleDecalPoint(
  xM: number,
  zM: number,
  cover: DecalCover,
  views: readonly DecalView[],
  out: { xM: number; zM: number },
): void {
  out.xM = xM;
  out.zM = zM;
  const first = views[0];
  if (first === undefined || !isHidden(xM, zM, cover, views)) return;
  const yaw = (first.yawDeg * Math.PI) / 180;
  const towardX = Math.sin(yaw);
  const towardZ = Math.cos(yaw);
  for (let s = SEARCH_STEP_M; s <= SEARCH_MAX_M; s += SEARCH_STEP_M) {
    const x = xM + towardX * s;
    const z = zM + towardZ * s;
    if (!isHidden(x, z, cover, views)) {
      const clearX = x + towardX * CLEAR_MARGIN_M;
      const clearZ = z + towardZ * CLEAR_MARGIN_M;
      // Past the wall there is no floor: stay where the baby was rather than draw out of the room.
      if (!isInRoom(clearX, clearZ, cover)) return;
      out.xM = clearX;
      out.zM = clearZ;
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

/** Adds a flat triangle with its corners at `corners` (x, z pairs, relative to the origin) to the buffers. */
function pushTriangle(
  positions: number[],
  indices: number[],
  corners: readonly [number, number, number, number, number, number],
): void {
  const base = positions.length / 3;
  positions.push(corners[0], 0, corners[1], corners[2], 0, corners[3], corners[4], 0, corners[5]);
  indices.push(base, base + 2, base + 1);
}

/**
 * Adds a flat fan round `(xM, zM)`: a disc of `radiusM` that is `points` round, its rim wandering from the
 * radius by up to `wobblePct` (a share of the radius; 0 is a round disc). `seed` varies the wobble.
 */
function pushDisc(
  positions: number[],
  indices: number[],
  xM: number,
  zM: number,
  radiusM: number,
  points: number,
  wobblePct: number,
  seed: number,
): void {
  const base = positions.length / 3;
  positions.push(xM, 0, zM);
  for (let i = 0; i < points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const radius = radiusM * (1 + ((hash01(seed, i) - 0.5) * 2 * wobblePct) / 100);
    positions.push(xM + Math.cos(angle) * radius, 0, zM + Math.sin(angle) * radius);
  }
  for (let i = 0; i < points; i++) indices.push(base, base + 1 + ((i + 1) % points), base + 1 + i);
}

/**
 * The geometry of one decal, around its own origin, lying flat: a few scraps for the tissues, a zigzag of
 * thin quads for the crayons, and so on for each gag. `index` (the mark's) varies the pattern from one mark
 * to the next.
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
  } else if (gag === 'pot_boiled_over') {
    // A fan of triangles round the centre: an irregular puddle, then a few splashes beyond it.
    positions.push(0, 0, 0);
    for (let i = 0; i < PUDDLE_POINTS; i++) {
      const angle = (i / PUDDLE_POINTS) * Math.PI * 2;
      const radius =
        PUDDLE_RADIUS_M * (1 + ((hash01(index, i) - 0.5) * 2 * PUDDLE_WOBBLE_PCT) / 100);
      positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    }
    for (let i = 0; i < PUDDLE_POINTS; i++) {
      indices.push(0, 1 + ((i + 1) % PUDDLE_POINTS), 1 + i);
    }
    for (let i = 0; i < SPLASH_COUNT; i++) {
      const angle = hash01(index, i + 50) * Math.PI * 2;
      const reach = SPLASH_REACH_M * (0.7 + 0.3 * hash01(index, i + 60));
      pushQuad(
        positions,
        indices,
        Math.cos(angle) * reach,
        Math.sin(angle) * reach,
        SPLASH_M,
        SPLASH_M,
        hash01(index, i + 70) * Math.PI,
      );
    }
  } else if (gag === 'baby_in_dishwasher') {
    // Cutlery on the floor (story 9.6): a long thin quad for each piece, with a small bowl at one end, strewn
    // round the mark at turned angles. The baby sat in the rack; the forks and spoons did not stay in it.
    for (let i = 0; i < CUTLERY_COUNT; i++) {
      const angle = hash01(index, i) * Math.PI * 2;
      const radius = CUTLERY_SCATTER_M * Math.sqrt(hash01(index, i + 10));
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const turn = hash01(index, i + 20) * Math.PI;
      pushQuad(positions, indices, x, z, CUTLERY_WIDTH_M, CUTLERY_LENGTH_M, turn);
      // The bowl (a spoon's) or the tines (a fork's): a wider square at the piece's head.
      const headX = x - Math.sin(turn) * (CUTLERY_LENGTH_M / 2);
      const headZ = z + Math.cos(turn) * (CUTLERY_LENGTH_M / 2);
      pushQuad(positions, indices, headX, headZ, CUTLERY_BOWL_M, CUTLERY_BOWL_M, turn);
    }
  } else if (gag === 'dishes_on_floor') {
    // Sharp white shards (story 9.7): a scalene triangle each, flung round the mark.
    for (let i = 0; i < SHARD_COUNT; i++) {
      const angle = hash01(index, i) * Math.PI * 2;
      const radius = SHARD_SCATTER_M * Math.sqrt(hash01(index, i + 10));
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const turn = hash01(index, i + 20) * Math.PI * 2;
      const size = SHARD_SIZE_M * (0.6 + 0.8 * hash01(index, i + 30));
      const corner = (arm: number, along: number): [number, number] => [
        x + Math.cos(turn + arm) * size * along,
        z + Math.sin(turn + arm) * size * along,
      ];
      const [ax, az] = corner(0, 1);
      const [bx, bz] = corner(2.1, 0.6 + 0.5 * hash01(index, i + 40));
      const [cx, cz] = corner(4.0, 0.5 + 0.5 * hash01(index, i + 50));
      pushTriangle(positions, indices, [ax, az, bx, bz, cx, cz]);
    }
  } else if (gag === 'pan_concert') {
    // Pans and their lids (story 9.7): round grey discs, the first the biggest, fallen all around.
    for (let i = 0; i < PAN_COUNT; i++) {
      const angle = hash01(index, i) * Math.PI * 2;
      const radius = PAN_SCATTER_M * Math.sqrt(hash01(index, i + 10));
      pushDisc(
        positions,
        indices,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        i % 2 === 0 ? PAN_RADIUS_M : LID_RADIUS_M,
        DISC_POINTS,
        0,
        0,
      );
    }
  } else if (gag === 'peelings_everywhere') {
    // Peelings (story 9.7): thin long scraps, turned every which way.
    for (let i = 0; i < PEELING_COUNT; i++) {
      const angle = hash01(index, i) * Math.PI * 2;
      const radius = PEELING_SCATTER_M * Math.sqrt(hash01(index, i + 10));
      pushQuad(
        positions,
        indices,
        Math.cos(angle) * radius,
        Math.sin(angle) * radius,
        PEELING_WIDTH_M * (0.7 + 0.6 * hash01(index, i + 20)),
        PEELING_LENGTH_M * (0.7 + 0.6 * hash01(index, i + 30)),
        hash01(index, i + 40) * Math.PI,
      );
    }
  } else if (gag === 'soil_on_rug') {
    // Soil (story 9.7): an irregular dark patch, and crumbs spread beyond it.
    pushDisc(positions, indices, 0, 0, SOIL_RADIUS_M, PUDDLE_POINTS, PUDDLE_WOBBLE_PCT, index);
    for (let i = 0; i < SOIL_CRUMB_COUNT; i++) {
      const angle = hash01(index, i + 50) * Math.PI * 2;
      const reach = SOIL_CRUMB_REACH_M * (0.7 + 0.3 * hash01(index, i + 60));
      pushQuad(
        positions,
        indices,
        Math.cos(angle) * reach,
        Math.sin(angle) * reach,
        SOIL_CRUMB_M,
        SOIL_CRUMB_M,
        hash01(index, i + 70) * Math.PI,
      );
    }
  } else if (gag === 'coffee_spilled') {
    // Coffee (story 9.7): one wobbly puddle, rounder and smoother than the soil's patch, with no crumbs.
    pushDisc(
      positions,
      indices,
      0,
      0,
      COFFEE_RADIUS_M,
      PUDDLE_POINTS,
      PUDDLE_WOBBLE_PCT / 2,
      index + 7,
    );
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
  sync(marks: readonly MischiefMark[], photoCamera: DecalView): void;
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
  cover: DecalCover,
  toon: ToonMaterialCache,
): MischiefDecals {
  const meshes: Mesh[] = [];
  const point = { xM: 0, zM: 0 };
  // The game camera and the end photo's (`feel.fx.photoCamera`, tunable): a mark is seen from both.
  const views: DecalView[] = [GAME_VIEW, GAME_VIEW];
  // How many decals of each gag are drawn: a list of colours turns on the gag's own marks, not on the whole list.
  const drawnOf = new Map<string, number>();
  const materialOf = (gag: string): MeshToonMaterial => {
    const rank = drawnOf.get(gag) ?? 0;
    drawnOf.set(gag, rank + 1);
    return toon.get(new Color(decalColorOf(gag, rank)));
  };
  const clear = (): void => {
    drawnOf.clear();
    for (const mesh of meshes) {
      parent.remove(mesh);
      mesh.geometry.dispose();
    }
    meshes.length = 0;
  };
  return {
    sync(marks, photoCamera) {
      if (marks.length < meshes.length) clear();
      views[1] = photoCamera;
      for (let i = meshes.length; i < marks.length; i++) {
        const mark = marks[i] as MischiefMark;
        const mesh = new Mesh(createDecalGeometry(mark.gag, i), materialOf(mark.gag));
        mesh.name = `mischief_decal_${i}`;
        visibleDecalPoint(mark.xM, mark.zM, cover, views, point);
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
