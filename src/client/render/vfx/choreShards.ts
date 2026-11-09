import { CHORE_SHARDS_MAX } from '@shared/constants';
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  Mesh,
  type MeshToonMaterial,
  type Object3D,
} from 'three';
import type { ToonMaterialCache } from '../materials/toonMaterial.ts';
import {
  DECAL_LIFT_M,
  type DecalCover,
  type DecalView,
  GAME_VIEW,
  visibleDecalPoint,
} from './mischiefDecals.ts';

// The shards of the plates a chore broke (story 9.6, FR76: « assiette cassée »): the sim counts them
// (`ChoreInstance.beatsMissed` × the def's `missBrokenObjects`, Mama's Soupir reads the same count), the
// client draws a handful of porcelain splinters per plate on the floor in front of the station, until the
// level ends and, since the photo renders the frozen `World` through the same scene, on the end photo.
// Provisional art (E7 draws the final one). Not physics props: they do not roll and nobody steps on them.
// One mesh per station, rebuilt only when its count changes (never per frame), no randomness: the offsets
// are a function of the station's and the plate's index.

/** The porcelain of a broken plate: a delft blue-white, which shows on the cream floor (a white one vanishes on it). */
const PORCELAIN_COLOR = 0x8fb8dc;
/** The cluster lies this far in front of the station (towards the camera), in metres. */
const FRONT_M = 0.8;
/** The plates lie in rows of this many, this far apart (along the row, then from row to row), in metres. */
const PLATES_PER_ROW = 6;
const PLATE_SPACING_M = 0.4;
const ROW_SPACING_M = 0.4;
/** The splinters of one plate: how many, how big (a side) and how far from the plate's centre, in metres. */
const SPLINTERS_PER_PLATE = 4;
const SPLINTER_M = 0.16;
const SPLINTER_REACH_M = 0.17;

/** What the client needs of a planned chore to draw its shards: where its station stands, and what a miss breaks. */
export interface ChoreStationSpec {
  /** The chore's def id (`content/chores/<id>.json`): which loop Papa plays at it (story 7.12, D2). */
  readonly defId: string;
  readonly xM: number;
  readonly zM: number;
  /** The def's `missBrokenObjects`, 0 for a chore that breaks nothing (the cooking). */
  readonly missBrokenObjects: number;
}

/** How many plates a chore has broken, held to {@link CHORE_SHARDS_MAX}: `beatsMissed × missBrokenObjects`. Pure. */
export function shardCountOf(beatsMissed: number, missBrokenObjects: number): number {
  return Math.min(CHORE_SHARDS_MAX, Math.max(0, beatsMissed) * Math.max(0, missBrokenObjects));
}

/** A fraction in [0, 1) from two integers: the same shards every time, with no `Math.random` (the scene is replayable). */
function hash01(a: number, b: number): number {
  let h = (Math.imul(a + 1, 0x9e3779b1) ^ Math.imul(b + 1, 0x85ebca6b)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  return (h >>> 0) / 4294967296;
}

/** A triangle lying flat, wound so that its front face looks up whichever way the three points come. */
function pushTriangle(
  positions: number[],
  indices: number[],
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
): void {
  const base = positions.length / 3;
  for (const [x, z] of [p0, p1, p2]) positions.push(x, 0, z);
  // The y of (p1 - p0) x (p2 - p0): positive when the points run counter-clockwise seen from above.
  const upward = (p1[1] - p0[1]) * (p2[0] - p0[0]) - (p1[0] - p0[0]) * (p2[1] - p0[1]);
  if (upward > 0) indices.push(base, base + 1, base + 2);
  else indices.push(base, base + 2, base + 1);
}

/**
 * The geometry of the shards of `plates` plates of station `stationIndex`, around the cluster's own origin,
 * lying flat: the plates in rows, each a few splinters round its slot. The same for the same inputs.
 */
export function createShardsGeometry(stationIndex: number, plates: number): BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let plate = 0; plate < plates; plate++) {
    const row = Math.floor(plate / PLATES_PER_ROW);
    const inRow = Math.min(PLATES_PER_ROW, plates - row * PLATES_PER_ROW);
    const column = plate % PLATES_PER_ROW;
    const cx = (column - (inRow - 1) / 2) * PLATE_SPACING_M;
    const cz = row * ROW_SPACING_M;
    for (let s = 0; s < SPLINTERS_PER_PLATE; s++) {
      const seed = stationIndex * 1000 + plate * 10 + s;
      const around = hash01(seed, 1) * Math.PI * 2;
      const reach = SPLINTER_REACH_M * Math.sqrt(hash01(seed, 2));
      const x = cx + Math.cos(around) * reach;
      const z = cz + Math.sin(around) * reach;
      const turn = hash01(seed, 3) * Math.PI * 2;
      const size = SPLINTER_M * (0.7 + 0.6 * hash01(seed, 4));
      pushTriangle(
        positions,
        indices,
        [x + Math.cos(turn) * size, z + Math.sin(turn) * size],
        [x + Math.cos(turn + 2.2) * size * 0.8, z + Math.sin(turn + 2.2) * size * 0.8],
        [x + Math.cos(turn + 4.1) * size * 0.6, z + Math.sin(turn + 4.1) * size * 0.6],
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

export interface ChoreShards {
  /**
   * Draws the plates each chore has broken: `beatsMissed` of each (index-aligned with the stations given at
   * creation). A mesh is rebuilt only when its chore's count changes, so most frames do nothing and allocate
   * nothing. `photoCamera` is the end photo's view, so that a cluster is put where both cameras see it.
   */
  sync(chores: readonly Readonly<{ beatsMissed: number }>[], photoCamera: DecalView): void;
  /** How many plates are drawn, over every station. */
  readonly plateCount: number;
  /** Removes every shard (a restart). */
  clear(): void;
  dispose(): void;
}

/**
 * The shards of a level, under `parent` (the content root: a shake moves them with the room). Lit through the
 * toon materials like the other decals. A station whose chore breaks nothing draws none.
 */
export function createChoreShards(
  parent: Object3D,
  cover: DecalCover,
  toon: ToonMaterialCache,
  stations: readonly ChoreStationSpec[],
): ChoreShards {
  const meshes: (Mesh | null)[] = stations.map(() => null);
  const drawn: number[] = stations.map(() => 0);
  const point = { xM: 0, zM: 0 };
  const views: DecalView[] = [GAME_VIEW, GAME_VIEW];
  const material: MeshToonMaterial = toon.get(new Color(PORCELAIN_COLOR));
  const remove = (i: number): void => {
    const mesh = meshes[i];
    if (mesh === null || mesh === undefined) return;
    parent.remove(mesh);
    mesh.geometry.dispose();
    meshes[i] = null;
    drawn[i] = 0;
  };
  const clear = (): void => {
    for (let i = 0; i < meshes.length; i++) remove(i);
  };
  return {
    sync(chores, photoCamera) {
      views[1] = photoCamera;
      for (let i = 0; i < stations.length; i++) {
        const station = stations[i] as ChoreStationSpec;
        if (station.missBrokenObjects <= 0) continue;
        const plates = shardCountOf(chores[i]?.beatsMissed ?? 0, station.missBrokenObjects);
        if (plates === drawn[i]) continue;
        remove(i);
        if (plates === 0) continue;
        const mesh = new Mesh(createShardsGeometry(i, plates), material);
        mesh.name = `chore_shards_${i}`;
        // In front of the station, towards the game camera, then out of whatever would hide it from either view.
        const yaw = (views[0] as DecalView).yawDeg;
        const towardX = Math.sin((yaw * Math.PI) / 180);
        const towardZ = Math.cos((yaw * Math.PI) / 180);
        visibleDecalPoint(
          station.xM + towardX * FRONT_M,
          station.zM + towardZ * FRONT_M,
          cover,
          views,
          point,
        );
        mesh.position.set(point.xM, DECAL_LIFT_M, point.zM);
        mesh.receiveShadow = false;
        mesh.castShadow = false;
        parent.add(mesh);
        meshes[i] = mesh;
        drawn[i] = plates;
      }
    },
    get plateCount() {
      let total = 0;
      for (const count of drawn) total += count;
      return total;
    },
    clear,
    dispose: clear,
  };
}
