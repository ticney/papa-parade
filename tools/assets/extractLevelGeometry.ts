import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseNodeName, REQUIRED_ANCHOR_IDS, REQUIRED_ZONE_IDS } from '@content/levelNodeNames';
import { type LevelGeometry, LevelGeometrySchema } from '@content/schemas/levelGeometry';
import { DEFAULT_LEVEL_ID, NAV_CELL_M } from '@shared/constants';
import { log } from '@shared/log';
import { err, ok, type Result } from '@shared/result';
import { parseGlb } from './glb.ts';
import { geometryPath, glbPath } from './paths.ts';

/** A validation, not a game number: how far an anchor may be from the nearest walkable cell, in metres. */
export const ANCHOR_MAX_DISTANCE_TO_WALKABLE_M = 1;

/** A box rotated by anything but a multiple of 90° about Y is refused; this is the slack on that test. */
const AXIS_EPSILON = 1e-4;
/** Everything is rounded to 1 mm before it is tested and written, so the file is identical everywhere. */
const MM = 1000;
/** The floor must rest at y = 0, within 1 mm. */
const FLOOR_TOLERANCE_M = 0.001;

type Vec3 = [number, number, number];
/** Column-major 4x4, as glTF writes it. */
type Mat4 = number[];

interface GltfNode {
  name?: string;
  mesh?: number;
  children?: number[];
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface GltfAccessor {
  min?: number[];
  max?: number[];
}
export interface GltfJson {
  extensionsUsed?: string[];
  scene?: number;
  scenes?: { nodes?: number[] }[];
  nodes?: GltfNode[];
  meshes?: { primitives?: { attributes?: { POSITION?: number } }[] }[];
  accessors?: GltfAccessor[];
}

export interface ExtractOptions {
  id: string;
  /** The schema only accepts `NAV_CELL_M`. */
  cellM: typeof NAV_CELL_M;
}

const round = (value: number): number => Math.round(value * MM) / MM + 0; // + 0: no "-0"

const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += (a[k * 4 + row] as number) * (b[col * 4 + k] as number);
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function localMatrix(node: GltfNode): Mat4 {
  if (node.matrix !== undefined && node.matrix.length === 16) return [...node.matrix];
  const [tx = 0, ty = 0, tz = 0] = node.translation ?? [];
  const [qx = 0, qy = 0, qz = 0, qw = 1] = node.rotation ?? [];
  const [sx = 1, sy = 1, sz = 1] = node.scale ?? [];
  const xx = qx * qx;
  const yy = qy * qy;
  const zz = qz * qz;
  const xy = qx * qy;
  const xz = qx * qz;
  const yz = qy * qz;
  const wx = qw * qx;
  const wy = qw * qy;
  const wz = qw * qz;
  return [
    (1 - 2 * (yy + zz)) * sx,
    2 * (xy + wz) * sx,
    2 * (xz - wy) * sx,
    0,
    2 * (xy - wz) * sy,
    (1 - 2 * (xx + zz)) * sy,
    2 * (yz + wx) * sy,
    0,
    2 * (xz + wy) * sz,
    2 * (yz - wx) * sz,
    (1 - 2 * (xx + yy)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}

const transformPoint = (m: Mat4, [x, y, z]: Vec3): Vec3 => [
  (m[0] as number) * x + (m[4] as number) * y + (m[8] as number) * z + (m[12] as number),
  (m[1] as number) * x + (m[5] as number) * y + (m[9] as number) * z + (m[13] as number),
  (m[2] as number) * x + (m[6] as number) * y + (m[10] as number) * z + (m[14] as number),
];

interface Aabb {
  min: Vec3;
  max: Vec3;
}

function aabbOfPoints(points: Vec3[]): Aabb {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const point of points) {
    for (const axis of [0, 1, 2] as const) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  }
  return { min, max };
}

function cornersOf(box: Aabb): Vec3[] {
  const corners: Vec3[] = [];
  for (const x of [box.min[0], box.max[0]]) {
    for (const y of [box.min[1], box.max[1]]) {
      for (const z of [box.min[2], box.max[2]]) corners.push([x, y, z]);
    }
  }
  return corners;
}

interface ResolvedNode {
  name: string;
  node: GltfNode;
  world: Mat4;
}

/** Nodes of the default scene with their world matrix, parents first. */
function resolveNodes(gltf: GltfJson): ResolvedNode[] {
  const nodes = gltf.nodes ?? [];
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, index) => index);
  const resolved: ResolvedNode[] = [];
  const visited = new Set<number>();
  const visit = (index: number, parent: Mat4): void => {
    const node = nodes[index];
    if (node === undefined || visited.has(index)) return;
    visited.add(index);
    const world = multiply(parent, localMatrix(node));
    resolved.push({ name: node.name ?? `node_${index}`, node, world });
    for (const child of node.children ?? []) visit(child, world);
  };
  for (const root of roots) visit(root, IDENTITY);
  return resolved;
}

/** The local-space box of a mesh node: the union of its POSITION accessors' min/max. */
function localBox(gltf: GltfJson, node: GltfNode): Aabb | null {
  if (node.mesh === undefined) return null;
  const primitives = gltf.meshes?.[node.mesh]?.primitives ?? [];
  const boxes: Aabb[] = [];
  for (const primitive of primitives) {
    const accessor = gltf.accessors?.[primitive.attributes?.POSITION ?? -1];
    const { min, max } = accessor ?? {};
    if (min?.length === 3 && max?.length === 3) {
      boxes.push({ min: min as Vec3, max: max as Vec3 });
    }
  }
  if (boxes.length === 0) return null;
  return aabbOfPoints(boxes.flatMap(cornersOf));
}

/**
 * The world AABB of a box node, or the problem with it. Only a rotation about Y by a multiple of
 * 90° and a positive uniform scale keep an AABB exact (D3).
 */
function worldBox(gltf: GltfJson, resolved: ResolvedNode): Result<Aabb, string> {
  const box = localBox(gltf, resolved.node);
  if (box === null) {
    return err(`"${resolved.name}": no mesh with POSITION min/max, so it has no box`);
  }
  const m = resolved.world;
  const column = (c: number): Vec3 => [
    m[c * 4] as number,
    m[c * 4 + 1] as number,
    m[c * 4 + 2] as number,
  ];
  const lengths = [0, 1, 2].map((c) => Math.hypot(...column(c)));
  const [sx = 0, sy = 0, sz = 0] = lengths;
  if (Math.abs(sx - sy) > AXIS_EPSILON || Math.abs(sx - sz) > AXIS_EPSILON) {
    return err(
      `"${resolved.name}": non-uniform scale (${sx.toFixed(3)}, ${sy.toFixed(3)}, ${sz.toFixed(3)}): apply the scale in Blender`,
    );
  }
  const [x, y, z] = [column(0), column(1), column(2)].map((c) => c.map((v) => v / sx) as Vec3) as [
    Vec3,
    Vec3,
    Vec3,
  ];
  const det =
    x[0] * (y[1] * z[2] - y[2] * z[1]) -
    x[1] * (y[0] * z[2] - y[2] * z[0]) +
    x[2] * (y[0] * z[1] - y[1] * z[0]);
  if (det < 0)
    return err(`"${resolved.name}": negative scale (mirrored): apply the scale in Blender`);
  const isAxisAligned = (v: Vec3): boolean =>
    v.filter((c) => Math.abs(c) > AXIS_EPSILON).length === 1;
  if (Math.abs(y[1] - 1) > AXIS_EPSILON || !isAxisAligned(x) || !isAxisAligned(z)) {
    return err(
      `"${resolved.name}": rotated by something other than a multiple of 90° about Y (its box would be wrong)`,
    );
  }
  return ok(aabbOfPoints(cornersOf(box).map((corner) => transformPoint(m, corner))));
}

const roundVec = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];
const centerOf = (b: Aabb): Vec3 =>
  roundVec([0, 1, 2].map((a) => (b.min[a as 0] + b.max[a as 0]) / 2) as Vec3);
const halfOf = (b: Aabb): Vec3 =>
  roundVec([0, 1, 2].map((a) => (b.max[a as 0] - b.min[a as 0]) / 2) as Vec3);

/** Half-open interval test on mm-rounded values, so the result never depends on float noise. */
const inside = (v: number, min: number, max: number): boolean => v >= min && v < max;

interface Footprint {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
const footprintOf = (b: Aabb): Footprint => ({
  minX: round(b.min[0]),
  maxX: round(b.max[0]),
  minZ: round(b.min[2]),
  maxZ: round(b.max[2]),
});

function buildNav(floor: Footprint, blocks: Footprint[], cellM: number): LevelGeometry['nav'] {
  const cols = Math.max(1, Math.ceil((floor.maxX - floor.minX) / cellM - 1e-9));
  const rowCount = Math.max(1, Math.ceil((floor.maxZ - floor.minZ) / cellM - 1e-9));
  const rows: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const z = round(floor.minZ + (r + 0.5) * cellM);
    let row = '';
    for (let c = 0; c < cols; c++) {
      const x = round(floor.minX + (c + 0.5) * cellM);
      const isFloor = inside(x, floor.minX, floor.maxX) && inside(z, floor.minZ, floor.maxZ);
      const isBlocked = blocks.some((b) => inside(x, b.minX, b.maxX) && inside(z, b.minZ, b.maxZ));
      row += isFloor && !isBlocked ? '1' : '0';
    }
    rows.push(row);
  }
  return { originM: [floor.minX, floor.minZ], cols, rowCount, rows };
}

/** Walkable cells of the 4-neighbour region of `start` (`[col, row]`). */
function floodFill(nav: LevelGeometry['nav'], start: [number, number]): Set<number> {
  const seen = new Set<number>();
  const key = (c: number, r: number): number => r * nav.cols + c;
  const stack: [number, number][] = [start];
  while (stack.length > 0) {
    const [c, r] = stack.pop() as [number, number];
    if (c < 0 || r < 0 || c >= nav.cols || r >= nav.rowCount) continue;
    if (nav.rows[r]?.[c] !== '1' || seen.has(key(c, r))) continue;
    seen.add(key(c, r));
    stack.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]);
  }
  return seen;
}

/** The walkable cell nearest to an x/z point, with its distance in metres. */
function nearestWalkable(
  nav: LevelGeometry['nav'],
  cellM: number,
  x: number,
  z: number,
): { cell: [number, number]; distanceM: number } | null {
  let best: { cell: [number, number]; distanceM: number } | null = null;
  for (let r = 0; r < nav.rowCount; r++) {
    for (let c = 0; c < nav.cols; c++) {
      if (nav.rows[r]?.[c] !== '1') continue;
      const cx = nav.originM[0] + (c + 0.5) * cellM;
      const cz = nav.originM[1] + (r + 0.5) * cellM;
      const distanceM = Math.hypot(cx - x, cz - z);
      if (best === null || distanceM < best.distanceM) best = { cell: [c, r], distanceM };
    }
  }
  return best;
}

/**
 * The level geometry the sim needs, from the JSON of the raw `.glb` the Blender export wrote.
 * Reads node transforms and accessor `min`/`max` only, never the binary buffers (D3). Every
 * problem is collected, each naming the node; the geometry is returned only when there are none.
 */
export function extractLevelGeometry(
  gltf: GltfJson,
  options: ExtractOptions,
): Result<LevelGeometry, string[]> {
  const problems: string[] = [];
  if (gltf.extensionsUsed?.includes('EXT_meshopt_compression')) {
    return err([
      'the file is already optimised by gltfpack (EXT_meshopt_compression): re-export from Blender first',
    ]);
  }

  const colliders: LevelGeometry['colliders'] = [];
  const anchors: LevelGeometry['anchors'] = [];
  const zones: LevelGeometry['zones'] = [];
  const props: LevelGeometry['props'] = [];
  const blocks: Footprint[] = [];
  const visualBoxes: Aabb[] = [];
  const floors: Aabb[] = [];
  const seen = new Set<string>();

  for (const resolved of resolveNodes(gltf)) {
    const parsed = parseNodeName(resolved.name);
    if (!parsed.ok) {
      problems.push(parsed.error);
      continue;
    }
    const { kind, id, subKind } = parsed.value;
    if (kind !== 'visual' && kind !== 'navFloor') {
      const unique = `${kind}:${id}`;
      if (seen.has(unique)) problems.push(`"${resolved.name}": duplicate id "${id}"`);
      seen.add(unique);
    }

    if (kind === 'anchor') {
      anchors.push({ id, positionM: roundVec(transformPoint(resolved.world, [0, 0, 0])) });
      continue;
    }
    if (kind === 'visual') {
      // A visual may be rotated, mirrored or scaled any way: the bounds only need a conservative
      // box of its transformed corners (only a node the sim reads needs the strict `worldBox`). An
      // empty group has no box and just does not count towards the bounds.
      const local = localBox(gltf, resolved.node);
      if (local !== null) {
        visualBoxes.push(
          aabbOfPoints(cornersOf(local).map((corner) => transformPoint(resolved.world, corner))),
        );
      }
      continue;
    }
    const box = worldBox(gltf, resolved);
    if (!box.ok) {
      problems.push(box.error);
      continue;
    }
    const b = box.value;
    if (kind === 'col') colliders.push({ id, centerM: centerOf(b), halfExtentsM: halfOf(b) });
    else if (kind === 'navFloor') floors.push(b);
    else if (kind === 'navBlock') blocks.push(footprintOf(b));
    else if (kind === 'zone') {
      zones.push({
        id,
        kind: subKind as LevelGeometry['zones'][number]['kind'],
        centerM: centerOf(b),
        halfExtentsM: halfOf(b),
      });
    } else if (kind === 'prop') {
      props.push({ id, kind: subKind as string, centerM: centerOf(b), halfExtentsM: halfOf(b) });
    }
  }

  if (floors.length !== 1) problems.push(`expected exactly one NAV_floor, found ${floors.length}`);
  for (const required of REQUIRED_ANCHOR_IDS) {
    if (!anchors.some((anchor) => anchor.id === required))
      problems.push(`missing the required anchor "ANCHOR_${required}"`);
  }
  for (const required of REQUIRED_ZONE_IDS) {
    if (!zones.some((zone) => zone.id === required))
      problems.push(`missing the required zone "ZONE_<kind>_${required}"`);
  }
  if (visualBoxes.length === 0) problems.push('no visual mesh: the level would show nothing');

  const floor = floors[0];
  if (floor !== undefined && Math.abs(floor.max[1]) > FLOOR_TOLERANCE_M) {
    problems.push(
      `"NAV_floor": its top face must rest at y = 0 (it is at y = ${round(floor.max[1])})`,
    );
  }
  if (problems.length > 0 || floor === undefined) return err(problems);

  const nav = buildNav(footprintOf(floor), blocks, options.cellM);

  // Reachability: fail here, not in the sim (story 1.7's A* depends on it).
  const papa = anchors.find((anchor) => anchor.id === 'papa_spawn');
  const papaCell =
    papa === undefined
      ? null
      : nearestWalkable(nav, options.cellM, papa.positionM[0], papa.positionM[2]);
  const region = papaCell === null ? new Set<number>() : floodFill(nav, papaCell.cell);
  const checks: { label: string; x: number; z: number; mustBeOn: boolean }[] = [
    ...anchors.map((a) => ({
      label: `ANCHOR_${a.id}`,
      x: a.positionM[0],
      z: a.positionM[2],
      mustBeOn: a.id === 'papa_spawn' || a.id === 'baby_spawn',
    })),
    ...zones
      .filter((z) => z.id === 'behind_sofa')
      .map((z) => ({
        label: `ZONE_${z.kind}_${z.id}`,
        x: z.centerM[0],
        z: z.centerM[2],
        mustBeOn: false,
      })),
  ];
  for (const check of checks) {
    const near = nearestWalkable(nav, options.cellM, check.x, check.z);
    if (near === null || near.distanceM > ANCHOR_MAX_DISTANCE_TO_WALKABLE_M) {
      problems.push(
        `"${check.label}": no walkable cell within ${ANCHOR_MAX_DISTANCE_TO_WALKABLE_M} m`,
      );
      continue;
    }
    if (check.mustBeOn) {
      const c = Math.floor((check.x - nav.originM[0]) / options.cellM);
      const r = Math.floor((check.z - nav.originM[1]) / options.cellM);
      if (nav.rows[r]?.[c] !== '1')
        problems.push(`"${check.label}": must stand on a walkable cell`);
    }
    if (!region.has(near.cell[1] * nav.cols + near.cell[0])) {
      problems.push(
        `"${check.label}": cannot be reached from ANCHOR_papa_spawn (separate walkable region)`,
      );
    }
  }

  const bounds = aabbOfPoints(visualBoxes.flatMap(cornersOf));
  const byId = <T extends { id: string }>(list: T[]): T[] =>
    [...list].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const geometry: LevelGeometry = {
    id: options.id,
    cellM: options.cellM,
    boundsMinM: roundVec(bounds.min),
    boundsMaxM: roundVec(bounds.max),
    colliders: byId(colliders),
    nav,
    anchors: byId(anchors),
    zones: byId(zones),
    props: byId(props),
  };
  const checked = LevelGeometrySchema.safeParse(geometry);
  if (!checked.success) {
    problems.push(
      ...checked.error.issues.map((issue) => `geometry: ${issue.path.join('.')}: ${issue.message}`),
    );
  }
  return problems.length > 0 ? err(problems) : ok(geometry);
}

/** What `assets:extract` writes: 2-space JSON, vectors on one line, trailing newline. */
export function renderGeometry(geometry: LevelGeometry): string {
  const spread = JSON.stringify(geometry, null, 2);
  // `[\n 1,\n 2\n]` of numbers only becomes `[1, 2]`; the nav rows (strings) stay one per line.
  const compact = spread.replace(
    /\[\s*(-?\d[^[\]"]*?)\s*\]/g,
    (_, inner: string) => `[${inner.replace(/\s*\n\s*/g, ' ')}]`,
  );
  return `${compact}\n`;
}

async function main(): Promise<void> {
  const id = process.argv[2] ?? DEFAULT_LEVEL_ID;
  const source = glbPath(id);
  const bytes = await readFile(source).catch((cause: unknown) => {
    log.error('assets', `cannot read ${source}: run \`npm run assets:export\` first`, cause);
    return null;
  });
  if (bytes === null) {
    process.exitCode = 1;
    return;
  }
  let json: unknown;
  try {
    json = parseGlb(new Uint8Array(bytes)).json;
  } catch (cause) {
    log.error('assets', `${source}: ${cause instanceof Error ? cause.message : String(cause)}`);
    process.exitCode = 1;
    return;
  }
  const result = extractLevelGeometry(json as GltfJson, { id, cellM: NAV_CELL_M });
  if (!result.ok) {
    for (const problem of result.error) log.error('assets', problem);
    log.error('assets', `${result.error.length} problem(s): geometry not written`);
    process.exitCode = 1;
    return;
  }
  const target = geometryPath(id);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, renderGeometry(result.value));
  log.info('assets', 'level geometry written', {
    target,
    colliders: result.value.colliders.length,
    anchors: result.value.anchors.length,
    navCells: `${result.value.nav.cols}x${result.value.nav.rowCount}`,
  });
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
